import { NextRequest, NextResponse } from "next/server";

const AI_API_URL = process.env.AI_API_URL;
const AI_API_KEY = process.env.AI_API_KEY;

export async function GET() {
  try {
    const response = await fetch(`${AI_API_URL}/health`, {
      method: "GET",
    });

    const data = await response.json();

    return NextResponse.json(data);
  } catch (error) {
    return NextResponse.json(
      {
        success: false,
        message: "Cannot connect to AI server",
        error: String(error),
      },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    const formData = await request.formData();

    const response = await fetch(`${AI_API_URL}/predict`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${AI_API_KEY}`,
      },
      body: formData,
    });

    const data = await response.json();

    return NextResponse.json(data, {
      status: response.status,
    });
  } catch (error) {
    return NextResponse.json(
      {
        success: false,
        message: "Cannot connect to AI server",
        error: String(error),
      },
      { status: 500 }
    );
  }
}