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
  try { parsed = new URL(normalized); } catch { throw new Error(`Invalid AI_API_URL configuration: ${value}`); }
  return parsed.toString().replace(/\/$/, "");
}

function aiHeaders(): HeadersInit {
  const headers: HeadersInit = {};
  const apiKey = process.env.AI_API_KEY?.trim();
  if (apiKey) headers["x-api-key"] = apiKey;
  return headers;
}

function supabaseConfig() {
  const url = process.env.SUPABASE_URL?.trim().replace(/\/$/, "");
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
  const bucket = process.env.SUPABASE_STORAGE_BUCKET?.trim() || "plate-images";
  if (!url || !key) throw new Error("Supabase is not configured. Add SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY to the Web1 deployment environment.");
  return { url, key, bucket };
}

function supabaseHeaders(contentType?: string): HeadersInit {
  const { key } = supabaseConfig();
  const headers: HeadersInit = { apikey: key, Authorization: `Bearer ${key}` };
  if (contentType) headers["Content-Type"] = contentType;
  return headers;
}

function normalizePlate(value: string) {
  return value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toUpperCase().replace(/[^A-Z0-9]/g, "");
}

function safeFileName(name: string) {
  return name.normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-zA-Z0-9._-]/g, "_").slice(-120) || "image.jpg";
}

async function checkSupabase() {
  const { url, bucket } = supabaseConfig();
  const headers = supabaseHeaders();

  const db = await fetch(`${url}/rest/v1/plate_records?select=id&limit=1`, { headers, cache: "no-store" });
  if (!db.ok) {
    const detail = await db.text();
    throw new Error(`Supabase database check failed (${db.status}): ${detail.slice(0, 200)}`);
  }

  const storage = await fetch(`${url}/storage/v1/bucket/${encodeURIComponent(bucket)}`, { headers, cache: "no-store" });
  if (!storage.ok) {
    const detail = await storage.text();
    throw new Error(`Supabase Storage check failed (${storage.status}): ${detail.slice(0, 200)}`);
  }
}

async function verifyStorageObject(url: string, bucket: string, imagePath: string) {
  const response = await fetch(`${url}/storage/v1/object/${encodeURIComponent(bucket)}/${imagePath}`, {
    method: "HEAD",
    headers: supabaseHeaders(),
    cache: "no-store",
  });
  return response.ok;
}

async function deleteStorageObject(url: string, bucket: string, imagePath: string) {
  await fetch(`${url}/storage/v1/object/${encodeURIComponent(bucket)}/${imagePath}`, {
    method: "DELETE",
    headers: supabaseHeaders(),
    cache: "no-store",
  }).catch(() => undefined);
}

async function savePlateRecord(file: File, plate: string, confidence: number, status: string) {
  const { url, bucket } = supabaseConfig();
  const day = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Ho_Chi_Minh" }).format(new Date());
  const id = crypto.randomUUID();
  const imagePath = `${day}/${normalizePlate(plate)}_${id}_${safeFileName(file.name)}`;
  const bytes = await file.arrayBuffer();

  const uploadResponse = await fetch(`${url}/storage/v1/object/${encodeURIComponent(bucket)}/${imagePath}`, {
    method: "POST",
    headers: { ...supabaseHeaders(file.type || "application/octet-stream"), "x-upsert": "false" },
    body: bytes,
    cache: "no-store"
  });

  if (!uploadResponse.ok) {
    const detail = await uploadResponse.text();
    throw new Error(`Image storage failed (${uploadResponse.status}): ${detail.slice(0, 300)}`);
  }

  const stored = await verifyStorageObject(url, bucket, imagePath);
  if (!stored) {
    await deleteStorageObject(url, bucket, imagePath);
    throw new Error("Image upload returned success, but Storage verification failed.");
  }

  const record = {
    id,
    plate: normalizePlate(plate),
    display_plate: plate,
    image_name: file.name,
    image_path: imagePath,
    confidence,
    status,
    created_at: new Date().toISOString()
  };

  const dbResponse = await fetch(`${url}/rest/v1/plate_records`, {
    method: "POST",
    headers: { ...supabaseHeaders("application/json"), Prefer: "return=minimal" },
    body: JSON.stringify(record),
    cache: "no-store"
  });

  if (!dbResponse.ok) {
    await deleteStorageObject(url, bucket, imagePath);
    const detail = await dbResponse.text();
    throw new Error(`Database save failed (${dbResponse.status}): ${detail.slice(0, 300)}`);
  }

  const verifyDb = await fetch(`${url}/rest/v1/plate_records?id=eq.${encodeURIComponent(id)}&select=id,image_path&limit=1`, {
    headers: supabaseHeaders(),
    cache: "no-store",
  });

  if (!verifyDb.ok) {
    await deleteStorageObject(url, bucket, imagePath);
    throw new Error(`Database verification failed (${verifyDb.status}).`);
  }

  const verifiedRows = await verifyDb.json().catch(() => []);
  if (!Array.isArray(verifiedRows) || verifiedRows.length !== 1 || verifiedRows[0]?.image_path !== imagePath) {
    await deleteStorageObject(url, bucket, imagePath);
    await fetch(`${url}/rest/v1/plate_records?id=eq.${encodeURIComponent(id)}`, {
      method: "DELETE",
      headers: supabaseHeaders(),
      cache: "no-store",
    }).catch(() => undefined);
    throw new Error("Database record was created but could not be verified.");
  }

  return { imagePath, recordId: id, storedAt: record.created_at };
}

async function parsePayload(response: Response) {
  const text = await response.text();
  if (!text) return null;
  try { return JSON.parse(text) as Record<string, unknown>; } catch { return { error: text }; }
}

export async function GET() {
  try {
    const aiUrl = getAiUrl();
    const response = await fetch(`${aiUrl}/health`, { method: "GET", headers: aiHeaders(), cache: "no-store" });
    const payload = await parsePayload(response);
    return NextResponse.json({ success: response.ok, ai: payload }, { status: response.ok ? 200 : response.status });
  } catch (error) {
    console.error("[AI health]", error);
    return NextResponse.json({ success: false, error: error instanceof Error ? error.message : "Cannot connect to AI server." }, { status: 503 });
  }
}

export async function POST(request: Request) {
  try {
    const incoming = await request.formData();
    const file = incoming.get("file");
    if (!(file instanceof File)) return NextResponse.json({ success: false, error: "Không tìm thấy ảnh." }, { status: 400 });
    if (!file.type.startsWith("image/")) return NextResponse.json({ success: false, error: "Chỉ hỗ trợ file ảnh." }, { status: 400 });

    // Fail fast before calling AI so a broken Supabase deployment never produces a misleading result.
    try {
      await checkSupabase();
    } catch (error) {
      const message = error instanceof Error ? error.message : "Supabase is unavailable.";
      console.error("[Supabase preflight]", error);
      return NextResponse.json({ success: false, error: message, errorType: "SUPABASE_PREFLIGHT_FAILED" }, { status: 503 });
    }

    const aiUrl = getAiUrl();
    const form = new FormData();
    form.append("file", file, file.name);
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 55_000);

    let response: Response;
    try {
      response = await fetch(`${aiUrl}/recognize`, { method: "POST", headers: aiHeaders(), body: form, cache: "no-store", signal: controller.signal });
    } finally { clearTimeout(timeout); }

    const payload = await parsePayload(response);
    if (!response.ok) {
      const detail = (payload?.detail as string | undefined) || (payload?.error as string | undefined) || `AI server trả về HTTP ${response.status}.`;
      return NextResponse.json({ success: false, error: detail, aiStatus: response.status, aiResponse: payload }, { status: response.status });
    }

    const nestedData = payload?.data && typeof payload.data === "object" ? payload.data as Record<string, unknown> : undefined;
    const licensePlate = (payload?.licensePlate as string | null | undefined) ?? (payload?.license_plate as string | null | undefined) ?? (nestedData?.licensePlate as string | null | undefined) ?? (nestedData?.license_plate as string | null | undefined) ?? null;
    const confidence = Number(payload?.confidence ?? nestedData?.confidence ?? 0) || 0;
    const plateConfidence = Number(payload?.plateConfidence ?? nestedData?.plateConfidence ?? 0) || 0;
    const aiSuccess = typeof payload?.success === "boolean" ? payload.success : Boolean(licensePlate);

    let storage: { imagePath: string; recordId: string; storedAt: string } | null = null;
    let storageError: string | null = null;

    if (aiSuccess && licensePlate) {
      try {
        storage = await savePlateRecord(file, licensePlate, plateConfidence || confidence, "Đã nhận diện");
      } catch (error) {
        storageError = error instanceof Error ? error.message : "Không thể lưu ảnh.";
        console.error("[plate storage]", error);
      }
    }

    return NextResponse.json({
      success: aiSuccess,
      data: {
        licensePlate: typeof licensePlate === "string" && licensePlate.trim() ? licensePlate.trim() : null,
        confidence,
        plateConfidence,
        imagePath: storage?.imagePath ?? null,
        recordId: storage?.recordId ?? null,
        storedAt: storage?.storedAt ?? null,
        storageError
      }
    });
  } catch (error) {
    console.error("[AI recognize]", error);
    const isTimeout = error instanceof Error && error.name === "AbortError";
    return NextResponse.json({ success: false, error: isTimeout ? "AI server xử lý quá lâu. Vui lòng thử lại." : error instanceof Error ? error.message : "Không thể kết nối AI server.", errorType: error instanceof Error ? error.name : typeof error }, { status: isTimeout ? 504 : 500 });
  }
}
