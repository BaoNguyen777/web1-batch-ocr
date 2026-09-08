"use client";

import {
  Download,
  FileImage,
  LoaderCircle,
  Play,
  RotateCcw,
  UploadCloud,
  X
} from "lucide-react";
import {
  ChangeEvent,
  DragEvent,
  useMemo,
  useRef,
  useState
} from "react";
import {
  RecognitionItem,
  RecognizeResponse
} from "@/types/recognition";

const MAX_FILES = 200;
const CONCURRENCY = 3;

function createItem(file: File): RecognitionItem {
  return {
    id: crypto.randomUUID(),
    file,
    preview: URL.createObjectURL(file),
    licensePlate: "",
    confidence: 0,
    status: "pending"
  };
}

function csvEscape(value: string | number) {
  const text = String(value ?? "");
  return `"${text.replace(/"/g, '""')}"`;
}

export default function BatchUploader() {
  const inputRef = useRef<HTMLInputElement>(null);
  const [items, setItems] = useState<RecognitionItem[]>([]);
  const [dragging, setDragging] = useState(false);
  const [running, setRunning] = useState(false);

  const stats = useMemo(() => {
    const done = items.filter((item) => item.status === "done").length;
    const error = items.filter((item) => item.status === "error").length;
    const processing = items.filter((item) => item.status === "processing").length;

    return {
      total: items.length,
      done,
      error,
      processing
    };
  }, [items]);

  function addFiles(fileList: FileList | File[]) {
    const images = Array.from(fileList).filter((file) =>
      file.type.startsWith("image/")
    );

    setItems((current) => {
      const remaining = Math.max(0, MAX_FILES - current.length);
      return [...current, ...images.slice(0, remaining).map(createItem)];
    });
  }

  function onInput(event: ChangeEvent<HTMLInputElement>) {
    if (event.target.files) addFiles(event.target.files);
    event.target.value = "";
  }

  function onDrop(event: DragEvent<HTMLDivElement>) {
    event.preventDefault();
    setDragging(false);
    addFiles(event.dataTransfer.files);
  }

  function patchItem(id: string, patch: Partial<RecognitionItem>) {
    setItems((current) =>
      current.map((item) => (item.id === id ? { ...item, ...patch } : item))
    );
  }

  async function recognizeOne(item: RecognitionItem) {
    patchItem(item.id, {
      status: "processing",
      error: undefined
    });

    try {
      const form = new FormData();
      form.append("file", item.file);

      const response = await fetch("/api/recognize", {
        method: "POST",
        body: form
      });

      const payload = (await response.json()) as RecognizeResponse;
      const plate = payload.data?.licensePlate?.trim().toUpperCase() || "";

      // A successful request without a detected plate is still a completed item.
      // Keep the plate empty instead of showing a fake/default number.
      if (!response.ok || (payload.success === false && !payload.data)) {
        throw new Error(payload.error || "Nhận diện thất bại.");
      }

      patchItem(item.id, {
        status: "done",
        licensePlate: plate,
        confidence: payload.data?.confidence || 0,
        error: undefined
      });
    } catch (error) {
      patchItem(item.id, {
        status: "error",
        error: error instanceof Error ? error.message : "Có lỗi xảy ra."
      });
    }
  }

  async function runAll() {
    if (running) return;

    const queue = items.filter(
      (item) => item.status === "pending" || item.status === "error"
    );

    if (!queue.length) return;

    setRunning(true);
    let cursor = 0;

    async function worker() {
      while (cursor < queue.length) {
        const current = queue[cursor++];
        await recognizeOne(current);
      }
    }

    try {
      await Promise.all(
        Array.from(
          { length: Math.min(CONCURRENCY, queue.length) },
          () => worker()
        )
      );
    } finally {
      setRunning(false);
    }
  }

  function removeItem(id: string) {
    setItems((current) => {
      const target = current.find((item) => item.id === id);
      if (target) URL.revokeObjectURL(target.preview);
      return current.filter((item) => item.id !== id);
    });
  }

  function clearAll() {
    items.forEach((item) => URL.revokeObjectURL(item.preview));
    setItems([]);
  }

  function exportCsv() {
    const rows = [
      ["STT", "Tên ảnh", "Biển số", "Độ tin cậy", "Trạng thái"],
      ...items.map((item, index) => [
        index + 1,
        item.file.name,
        item.licensePlate,
        item.confidence ? `${(item.confidence * 100).toFixed(2)}%` : "",
        item.status
      ])
    ];

    const csv =
      "\uFEFF" +
      rows
        .map((row) => row.map((cell) => csvEscape(cell)).join(","))
        .join("\r\n");

    const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `ket-qua-bien-so-${new Date().toISOString().slice(0, 10)}.csv`;
    anchor.click();
    URL.revokeObjectURL(url);
  }

  return (
    <main className="shell">
      <section className="hero">
        <div>
          <div className="eyebrow">WEB 1 · MANAGER</div>
          <h1>Batch OCR biển số</h1>
          <p>Thả nhiều ảnh, chạy AI, kiểm tra kết quả và xuất CSV.</p>
        </div>

        <div className="hero-actions">
          <button
            className="button secondary"
            onClick={clearAll}
            disabled={!items.length || running}
          >
            <RotateCcw size={18} />
            Xóa tất cả
          </button>

          <button
            className="button primary"
            onClick={runAll}
            disabled={!items.length || running}
          >
            {running ? <LoaderCircle className="spin" size={18} /> : <Play size={18} />}
            {running ? "Đang xử lý..." : "Chạy nhận diện"}
          </button>
        </div>
      </section>

      <section className="stats">
        <div className="stat"><span>Tổng ảnh</span><strong>{stats.total}</strong></div>
        <div className="stat"><span>Hoàn tất</span><strong>{stats.done}</strong></div>
        <div className="stat"><span>Đang chạy</span><strong>{stats.processing}</strong></div>
        <div className="stat"><span>Lỗi</span><strong>{stats.error}</strong></div>
      </section>

      <section
        className={`dropzone ${dragging ? "dragging" : ""}`}
        onDragOver={(event) => {
          event.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={onDrop}
        onClick={() => inputRef.current?.click()}
      >
        <input
          ref={inputRef}
          type="file"
          accept="image/*"
          multiple
          hidden
          onChange={onInput}
        />
        <div className="drop-icon"><UploadCloud size={30} /></div>
        <div>
          <h2>Thả nhiều ảnh vào đây</h2>
          <p>hoặc bấm để chọn ảnh · tối đa {MAX_FILES} ảnh/lần</p>
        </div>
      </section>

      {items.length > 0 && (
        <section className="results">
          <div className="results-head">
            <div>
              <h2>Kết quả</h2>
              <p>Chỉ hiển thị biển số khi AI thực sự phát hiện được.</p>
            </div>

            <button className="button secondary" onClick={exportCsv} disabled={!items.length}>
              <Download size={18} />
              Xuất CSV
            </button>
          </div>

          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>#</th>
                  <th>Ảnh</th>
                  <th>Biển số</th>
                  <th>Độ tin cậy</th>
                  <th>Trạng thái</th>
                  <th />
                </tr>
              </thead>

              <tbody>
                {items.map((item, index) => (
                  <tr key={item.id}>
                    <td>{index + 1}</td>
                    <td>
                      <div className="file-cell">
                        <img src={item.preview} alt={item.file.name} />
                        <div>
                          <strong>{item.file.name}</strong>
                          <span>{(item.file.size / 1024 / 1024).toFixed(2)} MB</span>
                        </div>
                      </div>
                    </td>
                    <td>
                      <input
                        className="field"
                        value={item.licensePlate}
                        placeholder="Không phát hiện"
                        onChange={(event) =>
                          patchItem(item.id, {
                            licensePlate: event.target.value.toUpperCase()
                          })
                        }
                      />
                    </td>
                    <td>
                      {item.confidence > 0
                        ? `${(item.confidence * 100).toFixed(1)}%`
                        : "—"}
                    </td>
                    <td><Status item={item} /></td>
                    <td>
                      <button
                        className="icon-button"
                        aria-label="Xóa ảnh"
                        onClick={() => removeItem(item.id)}
                        disabled={item.status === "processing"}
                      >
                        <X size={17} />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}
    </main>
  );
}

function Status({ item }: { item: RecognitionItem }) {
  if (item.status === "processing") {
    return (
      <span className="status processing">
        <LoaderCircle className="spin" size={14} />
        Đang xử lý
      </span>
    );
  }

  if (item.status === "done") {
    return <span className="status done">Hoàn tất</span>;
  }

  if (item.status === "error") {
    return <span className="status error" title={item.error}>Lỗi</span>;
  }

  return <span className="status pending">Chờ</span>;
}
