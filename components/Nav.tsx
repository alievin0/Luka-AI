"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const LINKS = [
  { href: "/", label: "التسوّق", emoji: "🛍️" },
  { href: "/interview", label: "محاكي المقابلات", emoji: "🎤" },
  { href: "/coach", label: "مرافقي اليومي", emoji: "🌱" },
  { href: "/monitor", label: "المراقبة اليومية", emoji: "🧘" },
  { href: "/events", label: "مناسبات العائلة", emoji: "📅" },
];

export default function Nav() {
  const pathname = usePathname();
  return (
    <nav className="flex flex-wrap items-center gap-1">
      {LINKS.map((l) => {
        const active = pathname === l.href;
        return (
          <Link
            key={l.href}
            href={l.href}
            className={`rounded-full px-3 py-1.5 text-sm font-medium transition ${
              active
                ? "bg-brand-600 text-white"
                : "text-slate-600 hover:bg-slate-100"
            }`}
          >
            <span className="me-1">{l.emoji}</span>
            {l.label}
          </Link>
        );
      })}
    </nav>
  );
}
