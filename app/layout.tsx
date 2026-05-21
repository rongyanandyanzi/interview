import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Voice Mock Interview",
  description: "AI voice mock interviews from a job description"
};

export default function RootLayout({
  children
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="zh-CN">
      <body>{children}</body>
    </html>
  );
}
