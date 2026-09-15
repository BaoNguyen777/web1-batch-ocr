import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const GATES = [
  { code: "1A", name: "Cổng 1A" }, { code: "3", name: "Cổng 3" }, { code: "4A", name: "Cổng 4A" },
  { code: "VG1", name: "VG1" }, { code: "V2", name: "Cổng V2" }, { code: "V3", name: "Cổng V3" },
  { code: "V3A", name: "V3A" }, { code: "VG4", name: "VG4" }, { code: "V4A", name: "Cổng V4A" },
  { code: "V5", name: "Cổng V5" }, { code: "V5A", name: "Cổng V5A" }, { code: "V5B", name: "Cổng V5B" },
  { code: "V6", name: "Cổng V6" }, { code: "1D", name: "Cổng 1D" },
] as const;

type Gate = (typeof GATES)[number];

function config() {
  const url = process.env.SUPABASE_URL?.trim().replace(/\/$/, "");
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
  const bucket = process.env.SUPABASE_STORAGE_BUCKET?.trim() || "plate-images";
  if (!url || !key) throw new Error("Supabase is not configured.");
  return { url, key, bucket };
}

function headers(contentType?: string): HeadersInit {
  const { key } = config();
  const result: HeadersInit = { apikey: key, Authorization: `Bearer ${key}` };
  if (contentType) result["Content-Type"] = contentType;
  return result;
}

async function sb(url: string, init: RequestInit) {
  return fetch(url, { ...init, cache: "no-store" });
}

function normalizePlate(value: string) {
  return value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toUpperCase().replace(/[^A-Z0-9]/g, "");
}

function safeFileName(name: string) {
  return name.normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-zA-Z0-9._-]/g, "_").slice(-120) || "image.jpg";
}

function getGates(values: FormDataEntryValue[]) {
  const codes = [...new Set(values.map((v) => String(v).trim().toUpperCase()).filter(Boolean))];
  return codes.map((code) => GATES.find((gate) => gate.code === code)).filter(Boolean) as Gate[];
}

async function removeObject(url: string, bucket: string, path: string) {
  await sb(`${url}/storage/v1/object/${encodeURIComponent(bucket)}/${path}`, { method: "DELETE", headers: headers() }).catch(() => undefined);
}

export async function POST(request: Request) {
  let uploadedPath = "";
  try {
    const form = await request.formData();
    const file = form.get("file");
    const rawPlate = String(form.get("plate") ?? "").trim().toUpperCase();
    const gates = getGates(form.getAll("gate"));

    if (!(file instanceof File) || !file.type.startsWith("image/")) {
      return NextResponse.json({ success: false, error: "Không tìm thấy file ảnh hợp lệ." }, { status: 400 });
    }
    const plate = normalizePlate(rawPlate);
    if (plate.length < 5 || plate.length > 12) {
      return NextResponse.json({ success: false, error: "Biển số không hợp lệ. Hãy nhập lại biển số xe." }, { status: 400 });
    }
    if (!gates.length) {
      return NextResponse.json({ success: false, error: "Vui lòng chọn ít nhất một cổng." }, { status: 400 });
    }

    const { url, bucket } = config();
    const id = crypto.randomUUID();
    const createdAt = new Date().toISOString();
    const day = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Ho_Chi_Minh" }).format(new Date());
    const gateCodes = gates.map((g) => g.code);
    const gateNames = gates.map((g) => g.name);
    const path = `${day}/${gateCodes.join("-")}/${plate}_${id}_${safeFileName(file.name)}`;
    uploadedPath = path;

    const upload = await sb(`${url}/storage/v1/object/${encodeURIComponent(bucket)}/${path}`, {
      method: "POST",
      headers: { ...headers(file.type || "application/octet-stream"), "x-upsert": "false" },
      body: await file.arrayBuffer(),
    });
    if (!upload.ok) throw new Error(`Image storage failed (${upload.status}): ${(await upload.text()).slice(0, 250)}`);

    // plate_records.gate_code is a foreign key to gates.code, so it must contain ONE valid gate.
    // Keep all selected gates in the authorization table instead.
    const primaryGate = gates[0];
    const record = {
      id, plate, display_plate: rawPlate, image_name: file.name, image_path: path,
      confidence: 1, status: "Đã cập nhật thủ công", gate_code: primaryGate.code,
      gate_name: primaryGate.name, created_at: createdAt,
    };
    const db = await sb(`${url}/rest/v1/plate_records`, {
      method: "POST", headers: { ...headers("application/json"), Prefer: "return=minimal" }, body: JSON.stringify(record),
    });
    if (!db.ok) throw new Error(`Database save failed (${db.status}): ${(await db.text()).slice(0, 250)}`);

    try {
      for (const gate of gates) {
        const auth = await sb(`${url}/rest/v1/authorized_plates?on_conflict=plate%2Cgate_code`, {
          method: "POST",
          headers: { ...headers("application/json"), Prefer: "resolution=merge-duplicates,return=minimal" },
          body: JSON.stringify({ plate, gate_code: gate.code, active: true, updated_at: createdAt }),
        });
        if (!auth.ok) throw new Error(`Authorization save failed for ${gate.name} (${auth.status}).`);
      }
    } catch (error) {
      await sb(`${url}/rest/v1/plate_records?id=eq.${encodeURIComponent(id)}`, { method: "DELETE", headers: headers() }).catch(() => undefined);
      throw error;
    }

    return NextResponse.json({
      success: true,
      data: {
        recordId: id,
        imagePath: path,
        licensePlate: rawPlate,
        confidence: 1,
        status: "Đã cập nhật thủ công",
        gates: gateCodes,
        gateNames,
      },
    });
  } catch (error) {
    if (uploadedPath) {
      try { const { url, bucket } = config(); await removeObject(url, bucket, uploadedPath); } catch { /* best effort */ }
    }
    console.error("[manual plate]", error);
    return NextResponse.json({ success: false, error: error instanceof Error ? error.message : "Không thể lưu biển số thủ công." }, { status: 500 });
  }
}
