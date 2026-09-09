import { NextResponse } from "next/server";
import { getSupabaseConfig, storageObjectUrl, supabaseHeaders } from "@/lib/supabase";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const secret = process.env.CRON_SECRET?.trim();
  if (!secret) {
    return NextResponse.json(
      { success: false, code: "CRON_NOT_CONFIGURED", error: "CRON_SECRET is not configured." },
      { status: 503 }
    );
  }

  if (request.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json(
      { success: false, code: "UNAUTHORIZED", error: "Unauthorized" },
      { status: 401 }
    );
  }

  let config: ReturnType<typeof getSupabaseConfig>;
  try {
    config = getSupabaseConfig();
  } catch {
    return NextResponse.json(
      {
        success: false,
        code: "SUPABASE_NOT_CONFIGURED",
        error: "Supabase is not configured.",
      },
      { status: 503 }
    );
  }

  const { url, bucket } = config;
  const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();

  try {
    const headers = supabaseHeaders();
    const query = new URL(`${url}/rest/v1/plate_records`);
    query.searchParams.set("created_at", `lt.${cutoff}`);
    query.searchParams.set("select", "id,image_path");
    query.searchParams.set("limit", "500");

    const findResponse = await fetch(query, { headers, cache: "no-store" });
    if (!findResponse.ok) {
      const detail = await findResponse.text().catch(() => "");
      console.error("[plate cleanup] query failed", findResponse.status, detail);
      return NextResponse.json(
        { success: false, code: "SUPABASE_QUERY_FAILED", error: `Database HTTP ${findResponse.status}` },
        { status: 502 }
      );
    }

    const oldRecords = (await findResponse.json()) as Array<{
      id: string;
      image_path: string | null;
    }>;

    let deletedImages = 0;
    const failedImageIds: string[] = [];

    for (const record of oldRecords) {
      if (!record.image_path) continue;

      const response = await fetch(storageObjectUrl(bucket, record.image_path), {
        method: "DELETE",
        headers,
        cache: "no-store",
      });

      if (response.ok || response.status === 404) {
        deletedImages += 1;
      } else {
        failedImageIds.push(record.id);
        console.error("[plate cleanup] Storage delete failed", response.status, record.image_path);
      }
    }

    const idsToDelete = oldRecords
      .filter((record) => !failedImageIds.includes(record.id))
      .map((record) => record.id);

    if (idsToDelete.length) {
      const deleteUrl = new URL(`${url}/rest/v1/plate_records`);
      deleteUrl.searchParams.set("id", `in.(${idsToDelete.join(",")})`);

      const deleteResponse = await fetch(deleteUrl, {
        method: "DELETE",
        headers,
        cache: "no-store",
      });

      if (!deleteResponse.ok) {
        const detail = await deleteResponse.text().catch(() => "");
        console.error("[plate cleanup] Database delete failed", deleteResponse.status, detail);
        return NextResponse.json(
          { success: false, code: "DATABASE_DELETE_FAILED", error: `Database delete HTTP ${deleteResponse.status}` },
          { status: 502 }
        );
      }
    }

    return NextResponse.json({
      success: true,
      deletedRecords: idsToDelete.length,
      deletedImages,
      retryNextRun: failedImageIds.length > 0,
      failedImages: failedImageIds.length,
      cutoff,
    });
  } catch (error) {
    console.error("[plate cleanup]", error);
    return NextResponse.json(
      {
        success: false,
        code: "CLEANUP_FAILED",
        error: error instanceof Error ? error.message : "Cleanup failed",
      },
      { status: 500 }
    );
  }
}
