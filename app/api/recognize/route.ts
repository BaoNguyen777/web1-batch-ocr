import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

function getAiUrl() {
  const value = process.env.AI_API_URL?.trim();

  if (!value) throw new Error("AI_API_URL is not configured on Vercel.");
  if (/localhost|127\.0\.0\.1|0\.0\.0\.0/i.test(value)) {
    throw new Error("AI_API_URL points to a local address. Use the public Railway URL.");
  }

  const normalized = /^https?:\/\//i.test(value) ? value : `https://${value}`;
  let parsed: URL;
  try {
    parsed = new URL(normalized);
  } catch {
    throw new Error(`Invalid AI_API_URL configuration: ${value}`);
  }

  return parsed.toString().replace(/\/$/, "");
}

function aiHeaders(): HeadersInit {
  const headers: HeadersInit = {};
  const apiKey = process.env.AI_API_KEY?.trim();
  if (apiKey) headers["x-api-key"] = apiKey;
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
      { success: response.ok, ai: payload },
      { status: response.ok ? 200 : response.status }
    );
  } catch (error) {
    console.error("[AI health]", error);
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error
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
    const targetUrl = `${aiUrl}/recognize`;

    const form = new FormData();
    form.append("file", file, file.name);

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 55_000);

    let response: Response;
    try {
      response = await fetch(targetUrl, {
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
      const detail =
        (payload?.detail as string | undefined) ||
        (payload?.error as string | undefined) ||
        `AI server trả về HTTP ${response.status}.`;

      return NextResponse.json(
        {
          success: false,
          error: detail,
          aiStatus: response.status,
          aiResponse: payload
        },
        { status: response.status }
      );
    }

    const nestedData = payload?.data && typeof payload.data === "object"
      ? (payload.data as Record<string, unknown>)
      : undefined;

    const licensePlate =
      (payload?.licensePlate as string | null | undefined) ??
      (payload?.license_plate as string | null | undefined) ??
      (nestedData?.licensePlate as string | null | undefined) ??
      (nestedData?.license_plate as string | null | undefined) ??
      null;

    const aiSuccess =
      typeof payload?.success === "boolean"
        ? payload.success
        : Boolean(licensePlate);

    return NextResponse.json({
      success: aiSuccess,
      data: {
        licensePlate:
          typeof licensePlate === "string" && licensePlate.trim()
            ? licensePlate.trim()
            : null,
        confidence: Number(
          payload?.confidence ?? nestedData?.confidence ?? 0
        ) || 0
      }
    });
  } catch (error) {
    console.error("[AI recognize]", error);
    const isTimeout = error instanceof Error && error.name === "AbortError";

    return NextResponse.json(
      {
        success: false,
        error: isTimeout
          ? "AI server xử lý quá lâu. Vui lòng thử lại."
          : error instanceof Error
            ? error.message
            : "Không thể kết nối AI server.",
        errorType: error instanceof Error ? error.name : typeof error
      },
      { status: isTimeout ? 504 : 500 }
    );
  }
}
