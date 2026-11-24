"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const TABS = [
  { href: "/admin/books", label: "Accounts" },
  { href: "/admin/books/purchases", label: "Purchases" },
  { href: "/admin/books/payments", label: "Payments" },
  { href: "/admin/books/payables", label: "Payables" },
  { href: "/admin/books/suppliers", label: "Suppliers" },
  { href: "/admin/books/banks", label: "Bank accounts" },
  { href: "/admin/books/ledger", label: "Ledger" },
  { href: "/admin/books/daybook", label: "Day book" },
  { href: "/admin/books/check", label: "Check my books" },
];

export default function BooksNav() {
  const path = usePathname();
  const tab = [...TABS].reverse().find((t) => (t.href === "/admin/books" ? path === t.href : path.startsWith(t.href)));
  return (
    <nav className="flex gap-1.5 overflow-x-auto pb-1" aria-label="Books">
      {TABS.map((t) => (
        <Link
          key={t.href}
          href={t.href}
          aria-current={t === tab ? "page" : undefined}
          className={`shrink-0 rounded-full px-3.5 py-1.5 text-sm font-semibold ${t === tab ? "bg-gradient-to-br from-mor to-[#0c3634] text-white" : "bg-black/5 text-foreground/70 hover:bg-black/10"}`}
        >
          {t.label}
        </Link>
      ))}
    </nav>
  );
}
