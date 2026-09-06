# Web 1 - Batch OCR biển số & CCCD

## Chức năng
- Kéo/thả nhiều ảnh.
- Tối đa 200 ảnh/lần ở UI.
- Chạy queue với concurrency = 3.
- Gọi `/api/recognize` trên Vercel.
- Route Vercel forward ảnh sang AI server thật.
- Hiển thị/sửa biển số + CCCD.
- Xuất CSV UTF-8 mở được trong Excel.

## Chạy local

```bash
npm install
copy .env.example .env.local
npm run dev
```

Sửa `.env.local`:

```env
AI_API_URL=http://127.0.0.1:8000
AI_API_KEY=
```

AI server phải có endpoint:

```http
POST /recognize
Content-Type: multipart/form-data
file=<image>
```

Một trong các JSON response sau đều được Web 1 đọc:

```json
{
  "licensePlate": "43A-123.45",
  "cccd": "012345678901",
  "confidence": 0.96
}
```

hoặc:

```json
{
  "data": {
    "licensePlate": "43A-123.45",
    "cccd": "012345678901",
    "confidence": 0.96
  }
}
```

## Deploy Vercel

1. Push project lên GitHub.
2. Import repository vào Vercel.
3. Project Settings -> Environment Variables.
4. Thêm `AI_API_URL`.
5. Nếu AI server dùng secret, thêm `AI_API_KEY`.
6. Redeploy.

Lưu ý: `best.pt`, YOLO và PaddleOCR nên chạy ở AI server riêng.
