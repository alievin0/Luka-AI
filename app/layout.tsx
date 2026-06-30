import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Luka — AI Shopping Agent",
  description:
    "Luka is an AI shopping assistant that helps you find products, compare options, and build a cart.",
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
