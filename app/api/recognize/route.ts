import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const GATES = [
  { code: "1A", name: "Cổng 1A" }, { code: "3", name: "Cổng 3" }, { code: "4A", name: "Cổng 4A" },
  { code: "VG1", name: "VG1" }, { code: "V2", name: "Cổng V2" }, { code: "V3", name: "Cổng V3" },
  { code: "V3A", name: "V3A" }, { code: "VG4", name: "VG4" }, { code: "V4A", name: "V4A" },
  { code: "V5", name: "Cổng V5" }, { code: "V5A", name: "V5A" }, { code: "V5B", name: "V5B" },
  { code: "V6", name: "Cổng V6" }, { code: "1D", name: "Cổng 1D" },
] as const;

function getGate(value: unknown) {
  const code = String(value ?? "").trim().toUpperCase();
  return GATES.find((gate) => gate.code === code) ?? null;
}

function getAiUrl() {
  const value = process.env.AI_API_URL?.trim();
  if (!value) throw new Error("AI_API_URL is not configured on Vercel.");
  if (/localhost|127\.0\.0\.1|0\.0\.0\.0/i.test(value)) throw new Error("AI_API_URL points to a local address. Use the public Railway URL.");
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
  const checks = await Promise.all([
    fetch(`${url}/rest/v1/plate_records?select=id&limit=1`, { headers, cache: "no-store" }),
    fetch(`${url}/rest/v1/gates?select=code&limit=1`, { headers, cache: "no-store" }),
    fetch(`${url}/rest/v1/authorized_plates?select=plate&limit=1`, { headers, cache: "no-store" }),
    fetch(`${url}/storage/v1/bucket/${encodeURIComponent(bucket)}`, { headers, cache: "no-store" }),
  ]);
  const [db, gates, authorized, storage] = checks;
  for (const [name, response] of [["plate_records", db], ["gates", gates], ["authorized_plates", authorized], ["Storage", storage]] as const) {
    if (!response.ok) {
      const detail = await response.text().catch(() => "");
      throw new Error(`Supabase ${name} check failed (${response.status}): ${detail.slice(0, 200)}`);
    }
  }
}

async function verifyStorageObject(url: string, bucket: string, imagePath: string) {
  const response = await fetch(`${url}/storage/v1/object/${encodeURIComponent(bucket)}/${imagePath}`, { method: "HEAD", headers: supabaseHeaders(), cache: "no-store" });
  return response.ok;
}

async function deleteStorageObject(url: string, bucket: string, imagePath: string) {
  await fetch(`${url}/storage/v1/object/${encodeURIComponent(bucket)}/${imagePath}`, { method: "DELETE", headers: supabaseHeaders(), cache: "no-store" }).catch(() => undefined);
}

async function savePlateRecord(file: File, plate: string, confidence: number, status: string, gate: { code: string; name: string }) {
  const { url, bucket } = supabaseConfig();
  const day = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Ho_Chi_Minh" }).format(new Date());
  const id = crypto.randomUUID();
  const normalizedPlate = normalizePlate(plate);
  const imagePath = `${day}/${gate.code}/${normalizedPlate}_${id}_${safeFileName(file.name)}`;
  const bytes = await file.arrayBuffer();

  const uploadResponse = await fetch(`${url}/storage/v1/object/${encodeURIComponent(bucket)}/${imagePath}`, {
    method: "POST", headers: { ...supabaseHeaders(file.type || "application/octet-stream"), "x-upsert": "false" }, body: bytes, cache: "no-store"
  });
  if (!uploadResponse.ok) {
    const detail = await uploadResponse.text();
    throw new Error(`Image storage failed (${uploadResponse.status}): ${detail.slice(0, 300)}`);
  }
  if (!(await verifyStorageObject(url, bucket, imagePath))) {
    await deleteStorageObject(url, bucket, imagePath);
    throw new Error("Image upload returned success, but Storage verification failed.");
  }

  const createdAt = new Date().toISOString();
  const record = { id, plate: normalizedPlate, display_plate: plate, image_name: file.name, image_path: imagePath, confidence, status, gate_code: gate.code, gate_name: gate.name, created_at: createdAt };
  const dbResponse = await fetch(`${url}/rest/v1/plate_records`, {
    method: "POST", headers: { ...supabaseHeaders("application/json"), Prefer: "return=minimal" }, body: JSON.stringify(record), cache: "no-store"
  });
  if (!dbResponse.ok) {
    await deleteStorageObject(url, bucket, imagePath);
    const detail = await dbResponse.text();
    throw new Error(`Database save failed (${dbResponse.status}): ${detail.slice(0, 300)}`);
  }

  const authResponse = await fetch(`${url}/rest/v1/authorized_plates?on_conflict=plate%2Cgate_code`, {
    method: "POST",
    headers: { ...supabaseHeaders("application/json"), Prefer: "resolution=merge-duplicates,return=minimal" },
    body: JSON.stringify({ plate: normalizedPlate, gate_code: gate.code, active: true, updated_at: createdAt }),
    cache: "no-store"
  });
  if (!authResponse.ok) {
    await deleteStorageObject(url, bucket, imagePath);
    await fetch(`${url}/rest/v1/plate_records?id=eq.${encodeURIComponent(id)}`, { method: "DELETE", headers: supabaseHeaders(), cache: "no-store" }).catch(() => undefined);
    const detail = await authResponse.text();
    throw new Error(`Authorization save failed (${authResponse.status}): ${detail.slice(0, 300)}`);
  }
  return { imagePath, recordId: id, storedAt: createdAt };
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
    const gate = getGate(incoming.get("gate"));
    if (!(file instanceof File)) return NextResponse.json({ success: false, error: "Không tìm thấy ảnh." }, { status: 400 });
    if (!file.type.startsWith("image/")) return NextResponse.json({ success: false, error: "Chỉ hỗ trợ file ảnh." }, { status: 400 });
    if (!gate) return NextResponse.json({ success: false, error: "Vui lòng chọn cổng trước khi nhận diện." }, { status: 400 });

    try { await checkSupabase(); } catch (error) {
      const message = error instanceof Error ? error.message : "Supabase is unavailable.";
      console.error("[Supabase preflight]", error);
      return NextResponse.json({ success: false, error: message, errorType: "SUPABASE_PREFLIGHT_FAILED" }, { status: 503 });
    }

    const aiUrl = getAiUrl();
    const form = new FormData();
    form.append("file", file, file.name);
    form.append("type", "plate");
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 55_000);
    let response: Response;
    try { response = await fetch(`${aiUrl}/api/ai`, { method: "POST", headers: aiHeaders(), body: form, cache: "no-store", signal: controller.signal }); }
    finally { clearTimeout(timeout); }

    const payload = await parsePayload(response);
    if (!response.ok) {
      const detail = (payload?.detail as string | undefined) || (payload?.error as string | undefined) || `AI server trả về HTTP ${response.status}.`;
      return NextResponse.json({ success: false, error: detail, aiStatus: response.status, aiResponse: payload }, { status: response.status });
    }

    const nestedResult = payload?.result && typeof payload.result === "object" ? payload.result as Record<string, unknown> : undefined;
    const licensePlate = (nestedResult?.licensePlate as string | null | undefined) ?? (payload?.licensePlate as string | null | undefined) ?? null;
    const confidence = Number(nestedResult?.confidence ?? payload?.confidence ?? 0) || 0;
    const plateConfidence = Number(nestedResult?.plateConfidence ?? payload?.plateConfidence ?? 0) || 0;
    const aiSuccess = payload?.success === true && typeof licensePlate === "string" && Boolean(licensePlate.trim());

    let storage: { imagePath: string; recordId: string; storedAt: string } | null = null;
    let storageError: string | null = null;
    if (aiSuccess && licensePlate) {
      try { storage = await savePlateRecord(file, licensePlate, plateConfidence || confidence, "Đã nhận diện", gate); }
      catch (error) { storageError = error instanceof Error ? error.message : "Không thể lưu ảnh."; console.error("[plate storage]", error); }
    }

    return NextResponse.json({ success: aiSuccess, data: {
      licensePlate: licensePlate?.trim() || null, confidence, plateConfidence,
      gate: gate.code, gateName: gate.name, imagePath: storage?.imagePath ?? null,
      recordId: storage?.recordId ?? null, storedAt: storage?.storedAt ?? null, storageError
    }});
  } catch (error) {
    console.error("[AI recognize]", error);
    const isTimeout = error instanceof Error && error.name === "AbortError";
    return NextResponse.json({ success: false, error: isTimeout ? "AI server xử lý quá lâu. Vui lòng thử lại." : error instanceof Error ? error.message : "Không thể kết nối AI server.", errorType: error instanceof Error ? error.name : typeof error }, { status: isTimeout ? 504 : 500 });
  }
}
