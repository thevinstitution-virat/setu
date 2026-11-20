"use client";

import Link from "next/link";
import Icon from "@/components/Icon";
import { formatINR } from "@/lib/money";
import { shortDate, useFetch } from "@/components/admin/AdminKit";

type Pending = {
  days: number;
  items: { id: string; orderNumber: string; totalAmount: number; deliveredAt: string | null; driver: string | null }[];
};

/** Home card: delivered orders still waiting for a rating. Tapping a star opens the order with it picked. */
export default function RatePrompt() {
  const { data } = useFetch<Pending>("/api/feedback");
  const items = data?.items ?? [];
  if (!items.length) return null;
  const [o, ...rest] = items;

  return (
    <section className="card p-4 space-y-3 border-2 !border-[var(--genda)]">
      <div>
        <p className="text-xs font-bold uppercase tracking-[0.1em] text-[var(--genda-text)]">Rate your delivery</p>
        <p className="font-bold text-sm mt-1">
          {o.orderNumber} · {formatINR(o.totalAmount)}
        </p>
        <p className="text-xs text-[var(--muted)]">
          Delivered{o.deliveredAt ? ` ${shortDate(o.deliveredAt)}` : ""}
          {o.driver ? ` by ${o.driver}` : ""}
        </p>
      </div>
      <div className="flex items-center gap-1">
        {[1, 2, 3, 4, 5].map((n) => (
          <Link
            key={n}
            href={`/retailer/orders/${o.id}?rate=1&stars=${n}`}
            aria-label={`${n} star${n === 1 ? "" : "s"}`}
            className="grid place-items-center h-11 w-11 rounded-xl text-ink/25 hover:text-[var(--genda)] transition"
          >
            <Icon name="star" className="h-8 w-8" />
          </Link>
        ))}
      </div>
      {rest.length > 0 && (
        <ul className="border-t border-[var(--line)] pt-2 space-y-1">
          {rest.map((r) => (
            <li key={r.id}>
              <Link href={`/retailer/orders/${r.id}?rate=1`} className="flex items-center justify-between gap-2 min-h-[40px] text-sm">
                <span className="min-w-0 truncate">
                  {r.orderNumber}
                  <span className="text-xs text-[var(--muted)]"> · {formatINR(r.totalAmount)}</span>
                </span>
                <span className="text-xs font-semibold text-[var(--kesar-text)] shrink-0">Rate</span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
