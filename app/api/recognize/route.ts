import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

function getAiUrl() {
  const value = process.env.AI_API_URL?.trim();

  if (!value) {
    throw new Error("AI_API_URL is not configured.");
  }

  if (/localhost|127\.0\.0\.1|0\.0\.0\.0/i.test(value)) {
    throw new Error(
      "AI_API_URL points to a local address. On Vercel, use the public URL of the deployed AI server."
    );
  }

  return value.replace(/\/$/, "");
}

function aiHeaders(): HeadersInit {
  const headers: HeadersInit = {};
  const apiKey = process.env.AI_API_KEY?.trim();

  if (apiKey) {
    headers["x-api-key"] = apiKey;
  }

  return headers;
}

async function parsePayload(response: Response) {
  const text = await response.text();

  if (!text) return null;

  try {
    return JSON.parse(text) as Record<string, unknown>;
  } catch {
    return { error: text };
  }
}

export async function GET() {
  try {
    const aiUrl = getAiUrl();
    const response = await fetch(`${aiUrl}/health`, {
      method: "GET",
      headers: aiHeaders(),
      cache: "no-store"
    });

    const payload = await parsePayload(response);

    return NextResponse.json(
      {
        success: response.ok,
        ai: payload
      },
      { status: response.ok ? 200 : response.status }
    );
  } catch (error) {
    console.error("[AI health]", error);
    return NextResponse.json(
      {
        success: false,
        error:
          error instanceof Error
            ? error.message
            : "Cannot connect to AI server."
      },
      { status: 503 }
    );
  }
}

export async function POST(request: Request) {
  try {
    const incoming = await request.formData();
    const file = incoming.get("file");

    if (!(file instanceof File)) {
      return NextResponse.json(
        { success: false, error: "Không tìm thấy ảnh." },
        { status: 400 }
      );
    }

    if (!file.type.startsWith("image/")) {
      return NextResponse.json(
        { success: false, error: "Chỉ hỗ trợ file ảnh." },
        { status: 400 }
      );
    }

    const aiUrl = getAiUrl();
    const form = new FormData();
    form.append("file", file, file.name);

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 55_000);

    let response: Response;
    try {
      response = await fetch(`${aiUrl}/recognize`, {
        method: "POST",
        headers: aiHeaders(),
        body: form,
        cache: "no-store",
        signal: controller.signal
      });
    } finally {
      clearTimeout(timeout);
    }

    const payload = await parsePayload(response);

    if (!response.ok) {
      return NextResponse.json(
        {
          success: false,
          error:
            (payload?.detail as string | undefined) ||
            (payload?.error as string | undefined) ||
            `AI server trả về HTTP ${response.status}.`
        },
        { status: response.status }
      );
    }

    return NextResponse.json({
      success: true,
      data: {
        licensePlate:
          (payload?.licensePlate as string | undefined) ??
          (payload?.license_plate as string | undefined) ??
          ((payload?.data as Record<string, unknown> | undefined)?.licensePlate as string | undefined) ??
          ((payload?.data as Record<string, unknown> | undefined)?.license_plate as string | undefined) ??
          "",
        cccd:
          (payload?.cccd as string | undefined) ??
          (payload?.citizenId as string | undefined) ??
          (payload?.citizen_id as string | undefined) ??
          ((payload?.data as Record<string, unknown> | undefined)?.cccd as string | undefined) ??
          "",
        confidence:
          Number(
            payload?.confidence ??
              (payload?.data as Record<string, unknown> | undefined)?.confidence ??
              0
          ) || 0
      }
    });
  } catch (error) {
    console.error("[AI recognize]", error);

    const isTimeout =
      error instanceof Error && error.name === "AbortError";

    return NextResponse.json(
      {
        success: false,
        error: isTimeout
          ? "AI server xử lý quá lâu. Vui lòng thử lại."
          : error instanceof Error
            ? error.message
            : "Không thể kết nối AI server."
      },
      { status: isTimeout ? 504 : 503 }
    );
  }
}
