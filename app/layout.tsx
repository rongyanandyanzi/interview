import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "模拟面试",
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
