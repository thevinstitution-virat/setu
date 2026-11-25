"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef } from "react";

const TABS = [
  { href: "/admin/books", label: "Accounts" },
  { href: "/admin/books/final", label: "Final accounts" },
  { href: "/admin/books/purchases", label: "Purchases" },
  { href: "/admin/books/payments", label: "Payments" },
  { href: "/admin/books/payables", label: "Payables" },
  { href: "/admin/books/claims", label: "Claims" },
  { href: "/admin/books/vouchers", label: "Vouchers" },
  { href: "/admin/books/gst", label: "GST" },
  { href: "/admin/books/tds", label: "TDS" },
  { href: "/admin/books/cashbook", label: "Cash & bank books" },
  { href: "/admin/books/stock", label: "Stock" },
  { href: "/admin/books/suppliers", label: "Suppliers" },
  { href: "/admin/books/banks", label: "Bank accounts" },
  { href: "/admin/books/ledger", label: "Ledger" },
  { href: "/admin/books/daybook", label: "Day book" },
  { href: "/admin/books/opening", label: "Opening balances" },
  { href: "/admin/books/switch", label: "Move books here" },
  { href: "/admin/books/year-end", label: "Year end" },
  { href: "/admin/books/check", label: "Check my books" },
];

export default function BooksNav() {
  const path = usePathname();
  const tab = [...TABS].reverse().find((t) => (t.href === "/admin/books" ? path === t.href : path.startsWith(t.href)));
  const nav = useRef<HTMLElement>(null);
  // On a phone most tabs are off-screen: bring the open one into view.
  useEffect(() => {
    const el = nav.current?.querySelector<HTMLElement>('[aria-current="page"]');
    if (nav.current && el) nav.current.scrollLeft = el.offsetLeft - nav.current.offsetLeft - (nav.current.clientWidth - el.clientWidth) / 2;
  }, [path]);
  return (
    <nav ref={nav} className="flex gap-1.5 overflow-x-auto pb-1" aria-label="Books">
      {TABS.map((t) => (
        <Link
          key={t.href}
          href={t.href}
          aria-current={t === tab ? "page" : undefined}
          className={`shrink-0 rounded-full px-3.5 py-1.5 text-sm font-semibold ${t === tab ? "bg-gradient-to-br from-mor to-[var(--mor-mid)] text-white" : "bg-black/5 text-foreground/70 hover:bg-black/10"}`}
        >
          {t.label}
        </Link>
      ))}
    </nav>
  );
}
