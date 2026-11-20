"use client";

import { useState } from "react";
import Link from "next/link";
import { ErrorBox, Toggle, shortDate, useFetch } from "@/components/admin/AdminKit";
import { FEEDBACK_TAGS } from "@/lib/engage-settings";
import { EngageNav, Pills, Stars, plural, tagGood, tagLabel } from "@/components/engage/admin/kit";

type Row = {
  id: string;
  rating: number;
  tags: string[];
  comment: string | null;
  createdAt: string;
  driverUserId: string | null;
  order: { id: string; orderNumber: string; totalAmount: number };
  retailer: { id: string; outletName: string };
  value: string;
};
type Data = {
  days: number;
  count: number;
  average: number | null;
  stars: number[];
  tags: Record<string, number>;
  drivers: { userId: string; name: string; count: number; average: number }[];
  rows: Row[];
};

const PERIODS = [
  { key: "7", label: "7 days" },
  { key: "30", label: "30 days" },
  { key: "90", label: "90 days" },
] as const;
type Period = (typeof PERIODS)[number]["key"];

const barColour = (n: number) => (n >= 4 ? "var(--mint)" : n === 3 ? "var(--genda)" : "var(--kesar)");
const avgTone = (a: number) => (a < 3 ? "text-[#a8281e]" : a < 4 ? "text-[var(--genda-text)]" : "text-[var(--mint-text)]");

export default function RatingsPage() {
  const [days, setDays] = useState<Period>("30");
  const [onlyComments, setOnlyComments] = useState(false);
  const [limit, setLimit] = useState(50);
  const { data, error, reload } = useFetch<Data>(`/api/admin/feedback?days=${days}`);

  const max = data ? Math.max(1, ...data.stars) : 1;
  const tagKeys = Object.keys(FEEDBACK_TAGS);
  const tagRows = data
    ? [...new Set([...tagKeys, ...Object.keys(data.tags)])].map((t) => ({ t, n: data.tags[t] ?? 0 })).filter((x) => x.n > 0).sort((a, b) => b.n - a.n)
    : [];
  const driverName = (id: string | null) => (id ? (data?.drivers.find((d) => d.userId === id)?.name ?? "") : "");
  const rows = (data?.rows ?? []).filter((r) => !onlyComments || r.comment);

  return (
    <div className="space-y-5 pb-16">
      <div className="page-head">
        <div className="min-w-0">
          <p className="page-kick">Engage</p>
          <h1 className="page-title">Delivery ratings</h1>
          <p className="page-sub">How shops rate their deliveries, 1 to 5 stars, with what went well or badly.</p>
        </div>
      </div>
      <EngageNav />

      <Pills items={PERIODS} value={days} onChange={setDays} label="Period" />
      {error && <ErrorBox message={error} onRetry={reload} />}
      {!data && !error && <p className="text-sm text-[var(--muted)]">Loading…</p>}

      {data && data.count === 0 && (
        <div className="card p-6 text-center space-y-1">
          <p className="text-sm font-semibold">No ratings in the last {plural(data.days, "day")}</p>
          <p className="text-sm text-[var(--muted)]">Shops can rate a delivery from their order page once it is delivered.</p>
        </div>
      )}

      {data && data.count > 0 && (
        <>
          <div className="grid gap-3 lg:grid-cols-[260px_minmax(0,1fr)_minmax(0,1fr)]">
            <div className="card p-5 min-w-0">
              <p className={`font-heading text-5xl font-bold leading-none ${avgTone(data.average ?? 0)}`}>{data.average ?? "—"}</p>
              <Stars value={data.average ?? 0} className="text-2xl mt-2 block" />
              <p className="stat-lbl mt-1">
                Average of {plural(data.count, "rating")} in {plural(data.days, "day")}
              </p>
            </div>

            <div className="card p-4 min-w-0 space-y-1.5">
              <p className="font-heading font-bold mb-1">Stars</p>
              {[5, 4, 3, 2, 1].map((n) => {
                const v = data.stars[n - 1] ?? 0;
                return (
                  <div key={n} className="flex items-center gap-2 text-sm">
                    <span className="w-7 shrink-0 font-semibold">{n}★</span>
                    <div className="h-2.5 flex-1 overflow-hidden rounded-full bg-black/5">
                      <div className="h-full rounded-full" style={{ width: `${(v / max) * 100}%`, background: barColour(n) }} />
                    </div>
                    <span className="w-16 shrink-0 text-right text-xs text-[var(--muted)]">
                      {v} · {Math.round((v / data.count) * 100)}%
                    </span>
                  </div>
                );
              })}
            </div>

            <div className="card p-4 min-w-0">
              <p className="font-heading font-bold mb-2">What shops said</p>
              {tagRows.length === 0 ? (
                <p className="text-sm text-[var(--muted)]">No tags picked.</p>
              ) : (
                <div className="flex flex-wrap gap-1.5">
                  {tagRows.map(({ t, n }) => (
                    <span key={t} className={`chip !py-1 !px-2.5 ${tagGood(t) ? "chip-mint" : "chip-kesar"}`}>
                      {tagLabel(t)} <b className="ml-1">{n}</b>
                    </span>
                  ))}
                </div>
              )}
            </div>
          </div>

          <section className="card overflow-hidden">
            <div className="px-4 py-3 border-b border-[var(--line)]">
              <h2 className="font-heading font-bold">By driver</h2>
              <p className="text-xs text-[var(--muted)]">Lowest average first. Deliveries marked by the office have no driver.</p>
            </div>
            {data.drivers.length === 0 ? (
              <p className="px-4 py-4 text-sm text-[var(--muted)]">No rated delivery had a driver.</p>
            ) : (
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-[11px] font-bold uppercase tracking-[0.08em] text-[var(--muted)]">
                    <th className="px-4 py-2 font-bold">Driver</th>
                    <th className="px-2 py-2 font-bold text-right">Ratings</th>
                    <th className="px-4 py-2 font-bold text-right">Average</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[var(--line)]">
                  {data.drivers.map((d) => (
                    <tr key={d.userId}>
                      <td className="px-4 py-2.5 font-medium break-words">{d.name || "Former driver"}</td>
                      <td className="px-2 py-2.5 text-right">{d.count}</td>
                      <td className={`px-4 py-2.5 text-right font-bold whitespace-nowrap ${avgTone(d.average)}`}>{d.average}★</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </section>

          <section className="card overflow-hidden">
            <div className="flex flex-wrap items-center justify-between gap-2 px-4 py-3 border-b border-[var(--line)]">
              <h2 className="font-heading font-bold">Latest ratings</h2>
              <Toggle checked={onlyComments} onChange={setOnlyComments} label="Only with a comment" />
            </div>
            {rows.length === 0 ? (
              <p className="px-4 py-4 text-sm text-[var(--muted)]">No rating with a comment in this period.</p>
            ) : (
              <ul className="divide-y divide-[var(--line)]">
                {rows.slice(0, limit).map((r) => (
                  <li key={r.id} className={`px-4 py-3 space-y-1 ${r.rating <= 2 ? "bg-[#fde4e1]/40" : ""}`}>
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <p className="min-w-0 font-bold break-words">
                        <Link href={`/admin/khata/${r.retailer.id}`} className="hover:underline">
                          {r.retailer.outletName}
                        </Link>
                      </p>
                      <Stars value={r.rating} />
                    </div>
                    <p className="text-xs text-[var(--muted)]">
                      Order {r.order.orderNumber} · {r.value}
                      {driverName(r.driverUserId) && ` · driver ${driverName(r.driverUserId)}`} · {shortDate(r.createdAt, true)}
                    </p>
                    {r.tags.length > 0 && (
                      <div className="flex flex-wrap gap-1">
                        {r.tags.map((t) => (
                          <span key={t} className={`chip !py-0.5 !px-2 !text-[11.5px] ${tagGood(t) ? "chip-mint" : "chip-kesar"}`}>
                            {tagLabel(t)}
                          </span>
                        ))}
                      </div>
                    )}
                    {r.comment && <p className="text-sm text-[var(--ink-2)] whitespace-pre-wrap break-words">“{r.comment}”</p>}
                  </li>
                ))}
              </ul>
            )}
            {rows.length > limit && (
              <div className="border-t border-[var(--line)] px-4 py-3">
                <button type="button" className="btn btn-quiet btn-xs" onClick={() => setLimit((n) => n + 50)}>
                  Show more ({rows.length - limit} left)
                </button>
              </div>
            )}
          </section>
        </>
      )}
    </div>
  );
}
