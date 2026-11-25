"use client";

import Link from "next/link";
import Icon from "@/components/Icon";
import { useFetch } from "@/components/admin/AdminKit";

type Alerts = { reorder: number; expiringSoon: number; expired: number };

/**
 * Compact stock alerts for the owner's dashboard. Hidden while stock
 * tracking is off, when there is nothing to flag, or when the user can't see stock.
 */
export default function StockAlertStrip() {
  const { data } = useFetch<{ alerts: Alerts | null }>("/api/stock/alerts");
  const a = data?.alerts;
  if (!a || (!a.reorder && !a.expiringSoon && !a.expired)) return null;
  const items = [
    { n: a.reorder, text: a.reorder === 1 ? "product to reorder" : "products to reorder", href: "/admin/stock?filter=low", tone: "chip-genda" },
    { n: a.expiringSoon, text: a.expiringSoon === 1 ? "batch expiring soon" : "batches expiring soon", href: "/admin/stock?filter=expiring", tone: "chip-genda" },
    { n: a.expired, text: a.expired === 1 ? "expired batch" : "expired batches", href: "/admin/stock?filter=expired", tone: "!bg-[var(--risk-tint)] !text-[var(--risk-text)] !border-transparent" },
  ].filter((i) => i.n > 0);
  return (
    <div className="card p-3 flex flex-wrap items-center gap-2" role="status">
      <span className="flex items-center gap-1.5 text-sm font-bold text-[var(--ink)] mr-1">
        <Icon name="stock" className="h-4 w-4" /> Stock
      </span>
      {items.map((i) => (
        <Link key={i.href} href={i.href} className={`chip ${i.tone} min-h-[40px] !px-3.5 hover:brightness-95`}>
          {i.n} {i.text}
        </Link>
      ))}
    </div>
  );
}
