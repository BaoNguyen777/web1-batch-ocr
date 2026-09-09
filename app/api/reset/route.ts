import { NextResponse } from "next/server";
import { getSupabaseConfig, storageObjectUrl, supabaseHeaders } from "@/lib/supabase";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const secret = process.env.CRON_SECRET?.trim();
  if (!secret) return NextResponse.json({ success: false, error: "CRON_SECRET is not configured." }, { status: 503 });
  if (request.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 });
  }

  try {
    const { url, bucket } = getSupabaseConfig();
    const headers = supabaseHeaders();
    const query = new URL(`${url}/rest/v1/plate_records`);
    query.searchParams.set("select", "id,image_path");
    query.searchParams.set("limit", "5000");

    const findResponse = await fetch(query, { headers, cache: "no-store" });
    if (!findResponse.ok) {
      return NextResponse.json({ success: false, error: `Database HTTP ${findResponse.status}` }, { status: 502 });
    }

    const records = (await findResponse.json()) as Array<{ id: string; image_path: string | null }>;
    let deletedImages = 0;
    const failedImages: string[] = [];

    for (const record of records) {
      if (!record.image_path) continue;
      const response = await fetch(storageObjectUrl(bucket, record.image_path), {
        method: "DELETE",
        headers,
        cache: "no-store",
      });
      if (response.ok || response.status === 404) {
        deletedImages += 1;
      } else {
        failedImages.push(record.image_path);
        console.error("[plate reset] Storage delete failed", response.status, record.image_path);
      }
    }

    if (failedImages.length) {
      return NextResponse.json({
        success: false,
        error: "Một số ảnh không thể xóa nên dữ liệu DB chưa được reset.",
        deletedImages,
        failedImages: failedImages.length,
        totalRecords: records.length,
      }, { status: 502 });
    }

    const deleteUrl = new URL(`${url}/rest/v1/plate_records`);
    deleteUrl.searchParams.set("id", "not.is.null");
    const deleteResponse = await fetch(deleteUrl, { method: "DELETE", headers, cache: "no-store" });

    if (!deleteResponse.ok) {
      return NextResponse.json({ success: false, error: `Database delete HTTP ${deleteResponse.status}` }, { status: 502 });
    }

    return NextResponse.json({
      success: true,
      deletedRecords: records.length,
      deletedImages,
      message: "Đã reset toàn bộ dữ liệu biển số và ảnh đã lưu.",
    });
  } catch (error) {
    console.error("[plate reset]", error);
    return NextResponse.json({ success: false, error: error instanceof Error ? error.message : "Reset failed" }, { status: 500 });
  }
}
