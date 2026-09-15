"use client";

import { Download, FileImage, LoaderCircle, Play, RotateCcw, UploadCloud, X } from "lucide-react";
import { ChangeEvent, DragEvent, useMemo, useRef, useState } from "react";
import { RecognitionItem, RecognizeResponse } from "@/types/recognition";

const MAX_FILES = 200;
const CONCURRENCY = 3;
const GATES = [
  { code: "1A", name: "Cổng 1A" }, { code: "3", name: "Cổng 3" }, { code: "4A", name: "Cổng 4A" },
  { code: "VG1", name: "VG1" }, { code: "V2", name: "Cổng V2" }, { code: "V3", name: "Cổng V3" },
  { code: "V3A", name: "V3A" }, { code: "VG4", name: "VG4" }, { code: "V4A", name: "V4A" },
  { code: "V5", name: "Cổng V5" }, { code: "V5A", name: "V5A" }, { code: "V5B", name: "V5B" },
  { code: "V6", name: "Cổng V6" }, { code: "1D", name: "Cổng 1D" },
] as const;

function createItem(file: File): RecognitionItem {
  return { id: crypto.randomUUID(), file, preview: URL.createObjectURL(file), licensePlate: "", confidence: 0, status: "pending" };
}
function csvEscape(value: string | number) { const text = String(value ?? ""); return `"${text.replace(/"/g, '""')}"`; }

export default function BatchUploader() {
  const inputRef = useRef<HTMLInputElement>(null);
  const [items, setItems] = useState<RecognitionItem[]>([]);
  const [gate, setGate] = useState<string>("");
  const [dragging, setDragging] = useState(false);
  const [running, setRunning] = useState(false);
  const [resetting, setResetting] = useState(false);

  const selectedGate = GATES.find((item) => item.code === gate);
  const stats = useMemo(() => ({
    total: items.length, done: items.filter((item) => item.status === "done").length,
    error: items.filter((item) => item.status === "error").length, processing: items.filter((item) => item.status === "processing").length
  }), [items]);

  function addFiles(fileList: FileList | File[]) {
    const images = Array.from(fileList).filter((file) => file.type.startsWith("image/"));
    setItems((current) => [...current, ...images.slice(0, Math.max(0, MAX_FILES - current.length)).map(createItem)]);
  }
  function onInput(event: ChangeEvent<HTMLInputElement>) { if (event.target.files) addFiles(event.target.files); event.target.value = ""; }
  function onDrop(event: DragEvent<HTMLDivElement>) { event.preventDefault(); setDragging(false); addFiles(event.dataTransfer.files); }
  function patchItem(id: string, patch: Partial<RecognitionItem>) { setItems((current) => current.map((item) => item.id === id ? { ...item, ...patch } : item)); }

  async function recognizeOne(item: RecognitionItem) {
    patchItem(item.id, { status: "processing", error: undefined });
    try {
      const form = new FormData();
      form.append("file", item.file);
      form.append("gate", gate);
      const response = await fetch("/api/recognize", { method: "POST", body: form });
      const payload = (await response.json()) as RecognizeResponse;
      const plate = payload.data?.licensePlate?.trim().toUpperCase() || "";
      if (!response.ok || !payload.success || !plate) throw new Error(payload.error || payload.data?.storageError || "Không nhận diện được biển số.");
      patchItem(item.id, { status: "done", licensePlate: plate, confidence: payload.data?.plateConfidence || payload.data?.confidence || 0, error: undefined });
    } catch (error) {
      patchItem(item.id, { status: "error", error: error instanceof Error ? error.message : "Có lỗi xảy ra." });
    }
  }

  async function runAll() {
    if (running || resetting || !gate) return;
    const queue = items.filter((item) => item.status === "pending" || item.status === "error");
    if (!queue.length) return;
    setRunning(true); let cursor = 0;
    async function worker() { while (cursor < queue.length) await recognizeOne(queue[cursor++]); }
    try { await Promise.all(Array.from({ length: Math.min(CONCURRENCY, queue.length) }, () => worker())); } finally { setRunning(false); }
  }

  function removeItem(id: string) { setItems((current) => { const target = current.find((item) => item.id === id); if (target) URL.revokeObjectURL(target.preview); return current.filter((item) => item.id !== id); }); }
  function clearAll() { items.forEach((item) => URL.revokeObjectURL(item.preview)); setItems([]); }

  async function resetDatabase() {
    if (running || resetting) return;
    const confirmed = window.confirm("Reset toàn bộ dữ liệu test?\n\nThao tác này sẽ xóa các bản ghi trong plate_records và ảnh tương ứng trong Storage. Không thể hoàn tác.");
    if (!confirmed) return;
    setResetting(true);
    try {
      const response = await fetch("/api/reset", { method: "POST", headers: { Authorization: `Bearer ${window.prompt("Nhập CRON_SECRET để xác nhận reset:") || ""}` } });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok || !payload.success) throw new Error(payload.error || "Reset thất bại.");
      clearAll(); window.alert(`Reset thành công!\nĐã xóa ${payload.deletedRecords ?? 0} bản ghi và ${payload.deletedImages ?? 0} ảnh.`);
    } catch (error) { window.alert(error instanceof Error ? error.message : "Reset thất bại."); }
    finally { setResetting(false); }
  }

  function exportCsv() {
    const rows = [["STT", "Tên ảnh", "Cổng", "Biển số", "Độ tin cậy", "Trạng thái"], ...items.map((item, index) => [index + 1, item.file.name, selectedGate?.name || gate, item.licensePlate, item.confidence ? `${(item.confidence * 100).toFixed(2)}%` : "", item.status])];
    const csv = "\uFEFF" + rows.map((row) => row.map((cell) => csvEscape(cell)).join(",")).join("\r\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8" }); const url = URL.createObjectURL(blob); const anchor = document.createElement("a");
    anchor.href = url; anchor.download = `ket-qua-${gate || "xe"}-${new Date().toISOString().slice(0, 10)}.csv`; anchor.click(); URL.revokeObjectURL(url);
  }

  return (
    <main className="shell">
      <section className="hero"><div><div className="eyebrow">WEB 1 · MANAGER</div><h1>Nhập xe theo cổng</h1><p>Chọn cổng trước, sau đó tải ảnh xe để AI nhận diện và cấp quyền cho đúng cổng.</p></div><div className="hero-actions">
        <button className="button secondary" onClick={clearAll} disabled={!items.length || running || resetting}><RotateCcw size={18} /> Xóa danh sách</button>
        <button className="button secondary" onClick={resetDatabase} disabled={running || resetting}>{resetting ? <LoaderCircle className="spin" size={18} /> : <RotateCcw size={18} />}{resetting ? "Đang reset..." : "Reset dữ liệu"}</button>
        <button className="button primary" onClick={runAll} disabled={!items.length || !gate || running || resetting}>{running ? <LoaderCircle className="spin" size={18} /> : <Play size={18} />}{running ? "Đang xử lý..." : "Chạy nhận diện"}</button>
      </div></section>

      <section className="card" style={{ marginBottom: 18 }}>
        <label className="label" htmlFor="gate">Cổng</label>
        <select id="gate" className="field" value={gate} onChange={(event) => { setGate(event.target.value); if (items.length) setItems((current) => current.map((item) => ({ ...item, status: "pending", error: undefined }))); }} disabled={running}>
          <option value="">-- Chọn cổng trước khi nhập ảnh --</option>
          {GATES.map((item) => <option key={item.code} value={item.code}>{item.name}</option>)}
        </select>
        {selectedGate && <p className="hint">Batch hiện tại sẽ được lưu tại <strong>{selectedGate.name}</strong>. Mỗi biển số nhận diện thành công sẽ được cấp quyền cho cổng này.</p>}
      </section>

      <section className="stats"><div className="stat"><span>Tổng ảnh</span><strong>{stats.total}</strong></div><div className="stat"><span>Hoàn tất</span><strong>{stats.done}</strong></div><div className="stat"><span>Đang chạy</span><strong>{stats.processing}</strong></div><div className="stat"><span>Lỗi</span><strong>{stats.error}</strong></div></section>

      <section className={`dropzone ${dragging ? "dragging" : ""}`} onDragOver={(event) => { event.preventDefault(); setDragging(true); }} onDragLeave={() => setDragging(false)} onDrop={onDrop} onClick={() => gate ? inputRef.current?.click() : window.alert("Vui lòng chọn cổng trước.")}>
        <input ref={inputRef} type="file" accept="image/*" multiple hidden onChange={onInput} />
        <div className="drop-icon"><UploadCloud size={30} /></div><div><h2>Thả nhiều ảnh vào đây</h2><p>{gate ? `Ảnh sẽ thuộc ${selectedGate?.name} · tối đa ${MAX_FILES} ảnh/lần` : "Chọn cổng trước khi chọn ảnh"}</p></div>
      </section>

      {items.length > 0 && <section className="results"><div className="results-head"><div><h2>Kết quả · {selectedGate?.name || gate}</h2><p>Chỉ hiển thị biển số khi AI thực sự phát hiện được.</p></div><button className="button secondary" onClick={exportCsv}><Download size={18} /> Xuất CSV</button></div>
        <div className="table-wrap"><table><thead><tr><th>#</th><th>Ảnh</th><th>Cổng</th><th>Biển số</th><th>Độ tin cậy</th><th>Trạng thái</th><th /></tr></thead><tbody>{items.map((item, index) => <tr key={item.id}>
          <td>{index + 1}</td><td><div className="file-cell"><img src={item.preview} alt={item.file.name} /><div><strong>{item.file.name}</strong><span>{(item.file.size / 1024 / 1024).toFixed(2)} MB</span></div></div></td>
          <td>{selectedGate?.name || gate}</td><td><input className="field" value={item.licensePlate} placeholder="Không phát hiện" onChange={(event) => patchItem(item.id, { licensePlate: event.target.value.toUpperCase() })} /></td>
          <td>{item.confidence > 0 ? `${(item.confidence * 100).toFixed(1)}%` : "—"}</td><td><Status item={item} /></td><td><button className="icon-button" aria-label="Xóa ảnh" onClick={() => removeItem(item.id)} disabled={item.status === "processing"}><X size={17} /></button></td>
        </tr>)}</tbody></table></div></section>}
    </main>
  );
}

function Status({ item }: { item: RecognitionItem }) {
  if (item.status === "processing") return <span className="status processing"><LoaderCircle className="spin" size={14} /> Đang xử lý</span>;
  if (item.status === "done") return <span className="status done">Hoàn tất</span>;
  if (item.status === "error") return <span className="status error" title={item.error}>Lỗi</span>;
  return <span className="status pending">Chờ</span>;
}
