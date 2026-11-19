"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

/**
 * Sub-navigation for Admin → Stock (Phase 5). Every stock page renders this
 * under its title so the section reads as one place.
 */
const LINKS = [
  { href: "/admin/stock", label: "Stock" },
  { href: "/admin/stock/receive", label: "Receive goods" },
  { href: "/admin/stock/purchase-orders", label: "Purchase orders" },
  { href: "/admin/stock/reorder", label: "Reorder" },
  { href: "/admin/stock/purchases", label: "Goods received" },
  { href: "/admin/stock/suppliers", label: "Suppliers" },
  { href: "/admin/stock/history", label: "History" },
  { href: "/admin/stock/places", label: "Places" },
] as const;

export default function StockNav() {
  const path = usePathname();
  const active = (href: string) => (href === "/admin/stock" ? path === href : path === href || path.startsWith(`${href}/`));
  return (
    <nav aria-label="Stock" className="-mx-4 overflow-x-auto px-4 sm:mx-0 sm:px-0">
      <ul className="flex w-max gap-1.5 pb-1">
        {LINKS.map((l) => (
          <li key={l.href}>
            <Link
              href={l.href}
              aria-current={active(l.href) ? "page" : undefined}
              className={`inline-flex h-9 items-center whitespace-nowrap rounded-full border px-3.5 text-sm font-medium transition-colors ${
                active(l.href) ? "border-[var(--kesar)] bg-[var(--kesar)] text-white" : "border-foreground/15 bg-white/60 text-foreground/75 hover:bg-white"
              }`}
            >
              {l.label}
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  );
}
