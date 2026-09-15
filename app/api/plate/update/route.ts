import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const GATE_CODES = new Set(["1A", "3", "4A", "VG1", "V2", "V3", "V3A", "VG4", "V4A", "V5", "V5A", "V5B", "V6", "1D"]);

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
function normalizePlate(value: string) {
  return value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toUpperCase().replace(/[^A-Z0-9]/g, "");
}
function safeFileName(name: string) {
  return name.replace(/[^a-zA-Z0-9._-]/g, "_").slice(-120) || "image.jpg";
}
function storageUrl(url: string, bucket: string, path: string) {
  return `${url}/storage/v1/object/${encodeURIComponent(bucket)}/${path}`;
}

export async function POST(request: Request) {
  try {
    const body = await request.json() as { recordId?: string; plate?: string };
    const recordId = String(body.recordId ?? "").trim();
    const displayPlate = String(body.plate ?? "").trim().toUpperCase();
    const plate = normalizePlate(displayPlate);
    if (!recordId) return NextResponse.json({ success: false, error: "Thiếu recordId." }, { status: 400 });
    if (plate.length < 5 || plate.length > 12) return NextResponse.json({ success: false, error: "Biển số không hợp lệ." }, { status: 400 });

    const { url, bucket } = config();
    const lookup = await fetch(`${url}/rest/v1/plate_records?id=eq.${encodeURIComponent(recordId)}&select=id,plate,gate_code,image_path,image_name`, { headers: headers(), cache: "no-store" });
    if (!lookup.ok) throw new Error(`Không đọc được bản ghi (${lookup.status}).`);
    const rows = await lookup.json() as Array<{ id: string; plate: string; gate_code: string | null; image_path: string | null; image_name: string | null }>;
    const record = rows[0];
    if (!record) return NextResponse.json({ success: false, error: "Không tìm thấy bản ghi cần cập nhật." }, { status: 404 });

    const gates = (record.gate_code ?? "").split(",").map((v) => v.trim().toUpperCase()).filter((v) => GATE_CODES.has(v));
    const oldPlate = normalizePlate(record.plate ?? "");
    const updatedAt = new Date().toISOString();
    let newImagePath = record.image_path || null;
    let copiedImage = false;

    // When the plate changes, persist the same original image under the corrected plate path.
    // This fixes the case where the DB plate is corrected but the Storage object still follows the old plate.
    if (oldPlate !== plate && record.image_path) {
      const oldImage = await fetch(storageUrl(url, bucket, record.image_path), { headers: headers(), cache: "no-store" });
      if (!oldImage.ok) throw new Error(`Không đọc được ảnh cũ trong Storage (${oldImage.status}).`);
      const imageBytes = await oldImage.arrayBuffer();
      const day = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Ho_Chi_Minh" }).format(new Date());
      const fileName = safeFileName(record.image_name || record.image_path.split("/").pop() || "image.jpg");
      const newPath = `${day}/${gates.join("-") || "unknown"}/${plate}_${recordId}_${fileName}`;
      const upload = await fetch(storageUrl(url, bucket, newPath), {
        method: "POST",
        headers: { ...headers(oldImage.headers.get("content-type") || "application/octet-stream"), "x-upsert": "true" },
        body: imageBytes,
      });
      if (!upload.ok) throw new Error(`Không lưu được ảnh sau khi sửa biển số (${upload.status}): ${(await upload.text()).slice(0, 250)}`);
      newImagePath = newPath;
      copiedImage = true;
    }

    const updateBody: Record<string, unknown> = { plate, display_plate: displayPlate, confidence: 1, status: "Đã sửa thủ công" };
    if (newImagePath) updateBody.image_path = newImagePath;
    const update = await fetch(`${url}/rest/v1/plate_records?id=eq.${encodeURIComponent(recordId)}`, {
      method: "PATCH", headers: { ...headers("application/json"), Prefer: "return=minimal" },
      body: JSON.stringify(updateBody), cache: "no-store",
    });
    if (!update.ok) {
      if (copiedImage && newImagePath && newImagePath !== record.image_path) {
        await fetch(storageUrl(url, bucket, newImagePath), { method: "DELETE", headers: headers(), cache: "no-store" }).catch(() => undefined);
      }
      throw new Error(`Cập nhật bản ghi thất bại (${update.status}): ${(await update.text()).slice(0, 250)}`);
    }

    for (const gate of gates) {
      const auth = await fetch(`${url}/rest/v1/authorized_plates?on_conflict=plate%2Cgate_code`, {
        method: "POST", headers: { ...headers("application/json"), Prefer: "resolution=merge-duplicates,return=minimal" },
        body: JSON.stringify({ plate, gate_code: gate, active: true, updated_at: updatedAt }), cache: "no-store",
      });
      if (!auth.ok) throw new Error(`Không cập nhật quyền tại cổng ${gate} (${auth.status}).`);
    }

    if (oldPlate && oldPlate !== plate && gates.length) {
      for (const gate of gates) {
        await fetch(`${url}/rest/v1/authorized_plates?plate=eq.${encodeURIComponent(oldPlate)}&gate_code=eq.${encodeURIComponent(gate)}`, {
          method: "DELETE", headers: headers(), cache: "no-store",
        }).catch(() => undefined);
      }
    }

    if (copiedImage && record.image_path && newImagePath && record.image_path !== newImagePath) {
      await fetch(storageUrl(url, bucket, record.image_path), { method: "DELETE", headers: headers(), cache: "no-store" }).catch(() => undefined);
    }

    return NextResponse.json({ success: true, data: { recordId, licensePlate: displayPlate, confidence: 1, imagePath: newImagePath } });
  } catch (error) {
    console.error("[plate update]", error);
    return NextResponse.json({ success: false, error: error instanceof Error ? error.message : "Không thể cập nhật biển số." }, { status: 500 });
  }
}
