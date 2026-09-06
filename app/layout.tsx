import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Batch OCR Manager",
  description: "Nhận diện biển số và CCCD từ nhiều ảnh"
};

export default function RootLayout({
  children
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="vi">
      <body>{children}</body>
    </html>
  );
}
