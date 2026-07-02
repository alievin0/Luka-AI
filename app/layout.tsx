import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Luka — AI Agent",
  description:
    "Luka is an AI agent: shopping assistant, bilingual interview simulator with live body-language coaching, daily growth companion, and family-events extractor.",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="ar" dir="rtl">
      <body>{children}</body>
    </html>
  );
}
