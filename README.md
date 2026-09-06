# Web 1 — Batch OCR biển số & CCCD

Web app Next.js dùng để upload nhiều ảnh, gửi từng ảnh qua API proxy và nhận kết quả từ AI server.

## Luồng hệ thống

```text
Browser
  ↓ POST /api/recognize
Next.js / Vercel
  ↓ POST /recognize + x-api-key
AI Server / FastAPI
  ↓
YOLO best.pt → detect biển số
PaddleOCR → đọc ký tự + CCCD 12 số
```

## Tính năng

- Kéo/thả nhiều ảnh.
- Tối đa 200 ảnh/lần ở UI.
- Queue concurrency = 3.
- Hiển thị và chỉnh sửa biển số + CCCD.
- Xuất CSV UTF-8 cho Excel.
- API proxy giữ `AI_API_KEY` ở server, không expose key cho browser.
- Có health check qua `/api/recognize` (GET).

## Local

```bash
npm install
copy .env.example .env.local
npm run dev
```

`.env.local`:

```env
AI_API_URL=http://127.0.0.1:8000
AI_API_KEY=
```

## Vercel

Không dùng `127.0.0.1` hoặc `localhost` cho `AI_API_URL` trên Vercel. Hãy dùng URL public của AI server, ví dụ:

```env
AI_API_URL=https://your-ai-server.example.com
AI_API_KEY=your-secret
```

Sau khi thêm Environment Variables, redeploy project.

## AI server contract

```http
POST /recognize
Content-Type: multipart/form-data
x-api-key: your-secret
file=<image>
```

Response:

```json
{
  "licensePlate": "43A-123.45",
  "cccd": "012345678901",
  "confidence": 0.96,
  "plateConfidence": 0.94,
  "cccdConfidence": 0.9,
  "detections": []
}
```

AI server cũng hỗ trợ `POST /recognize/batch` cho nhiều file, nhưng Web 1 hiện dùng queue từng ảnh để dễ kiểm soát lỗi và timeout.

## Lưu ý production

- Không commit `.env`, API key hoặc dữ liệu ảnh/CCCD.
- `best.pt` là model detect biển số; CCCD hiện được lấy bằng OCR toàn ảnh + heuristic 12 chữ số.
- Nếu cần nhận diện CCCD chính xác hơn, nên huấn luyện detector vùng CCCD riêng.
- Vercel chỉ đóng vai trò frontend/API proxy; YOLO + PaddleOCR nên chạy trên máy chủ Python riêng.
