import { NextResponse } from "next/server";

export const runtime = "nodejs";

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

    const aiUrl = process.env.AI_API_URL;
    if (!aiUrl) {
      return NextResponse.json(
        {
          success: false,
          error: "Chưa cấu hình AI_API_URL trên Vercel/.env.local."
        },
        { status: 500 }
      );
    }

    const form = new FormData();
    form.append("file", file, file.name);

    const headers: HeadersInit = {};
    if (process.env.AI_API_KEY) {
      headers["x-api-key"] = process.env.AI_API_KEY;
    }

    const aiResponse = await fetch(`${aiUrl.replace(/\/$/, "")}/recognize`, {
      method: "POST",
      headers,
      body: form,
      cache: "no-store"
    });

    const payload = await aiResponse.json().catch(() => null);

    if (!aiResponse.ok) {
      return NextResponse.json(
        {
          success: false,
          error:
            payload?.detail ||
            payload?.error ||
            `AI server trả về HTTP ${aiResponse.status}.`
        },
        { status: aiResponse.status }
      );
    }

    return NextResponse.json({
      success: true,
      data: {
        licensePlate:
          payload?.licensePlate ??
          payload?.license_plate ??
          payload?.data?.licensePlate ??
          payload?.data?.license_plate ??
          "",
        cccd:
          payload?.cccd ??
          payload?.citizenId ??
          payload?.citizen_id ??
          payload?.data?.cccd ??
          "",
        confidence:
          Number(
            payload?.confidence ??
            payload?.data?.confidence ??
            0
          ) || 0
      }
    });
  } catch (error) {
    console.error(error);
    return NextResponse.json(
      { success: false, error: "Không thể kết nối AI server." },
      { status: 500 }
    );
  }
}
