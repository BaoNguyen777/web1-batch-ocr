import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Backward-compatible endpoint. The frontend should use /api/recognize.
export async function GET() {
  try {
    const aiUrl = process.env.AI_API_URL?.trim()?.replace(/\/$/, "");
    if (!aiUrl) throw new Error("AI_API_URL is not configured.");

    const response = await fetch(`${aiUrl}/health`, {
      headers: process.env.AI_API_KEY
        ? { "x-api-key": process.env.AI_API_KEY }
        : undefined,
      cache: "no-store"
    });

    const data = await response.json().catch(() => null);
    return NextResponse.json(data ?? { success: response.ok }, {
      status: response.status
    });
  } catch (error) {
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : "Cannot connect to AI server."
      },
      { status: 503 }
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    const aiUrl = process.env.AI_API_URL?.trim()?.replace(/\/$/, "");
    if (!aiUrl) {
      return NextResponse.json(
        { success: false, error: "AI_API_URL chưa được cấu hình." },
        { status: 500 }
      );
    }

    const incoming = await request.formData();
    const file = incoming.get("file");
    if (!(file instanceof File)) {
      return NextResponse.json(
        { success: false, error: "Không tìm thấy ảnh." },
        { status: 400 }
      );
    }

    const formData = new FormData();
    formData.append("file", file, file.name);

    const response = await fetch(`${aiUrl}/recognize`, {
      method: "POST",
      headers: process.env.AI_API_KEY
        ? { "x-api-key": process.env.AI_API_KEY }
        : undefined,
      body: formData,
      cache: "no-store"
    });

    const data = await response.json().catch(() => null);
    return NextResponse.json(data ?? { success: false }, {
      status: response.status
    });
  } catch (error) {
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : "Cannot connect to AI server."
      },
      { status: 503 }
    );
  }
}
