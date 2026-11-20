import Link from "next/link";
import type { ReactNode } from "react";
import { formatINR } from "@/lib/money";

/** Pieces shared by the report pages (server-safe: no hooks). */

export const rs = (p: number | null | undefined) => (p == null ? "–" : p < 0 ? `−${formatINR(-p, { whole: true })}` : formatINR(p, { whole: true }));
export const pct = (v: number | null | undefined) => (v == null ? "–" : `${v}%`);
export const num = (v: number | null | undefined) => (v == null ? "–" : v.toLocaleString("en-IN"));

/** Short rupees for tight spaces: ₹4.2L, ₹1.3Cr, ₹950. */
export function rsShort(p: number) {
  const r = p / 100;
  const a = Math.abs(r);
  const sign = r < 0 ? "−" : "";
  if (a >= 1e7) return `${sign}₹${(a / 1e7).toFixed(1)}Cr`;
  if (a >= 1e5) return `${sign}₹${(a / 1e5).toFixed(1)}L`;
  if (a >= 1e3) return `${sign}₹${(a / 1e3).toFixed(1)}k`;
  return `${sign}₹${Math.round(a)}`;
}

export function Change({ value, invert = false }: { value: number | null; invert?: boolean }) {
  if (value === null) return <span className="text-xs text-[var(--muted)]">no earlier figure</span>;
  const up = value > 0;
  const good = invert ? !up : up;
  const flat = value === 0;
  return (
    <span className={`text-xs font-bold ${flat ? "text-[var(--muted)]" : good ? "text-[var(--mint-text)]" : "text-[#a8281e]"}`}>
      {flat ? "→" : up ? "▲" : "▼"} {Math.abs(value)}% <span className="font-normal text-[var(--muted)]">vs before</span>
    </span>
  );
}

export function Kpi({ label, value, sub, change, invert, href }: { label: string; value: string; sub?: ReactNode; change?: number | null; invert?: boolean; href?: string }) {
  const body = (
    <>
      <p className="text-xs font-semibold text-[var(--muted)]">{label}</p>
      <p className="font-heading text-2xl font-bold text-[var(--ink)] mt-1 tabular-nums">{value}</p>
      <div className="mt-1 min-h-4 space-x-2">
        {change !== undefined && <Change value={change} invert={invert} />}
        {sub && <span className="text-xs text-[var(--muted)]">{sub}</span>}
      </div>
    </>
  );
  return href ? (
    <Link href={href} className="card p-4 block hover:border-[var(--kesar)] transition-colors">
      {body}
    </Link>
  ) : (
    <div className="card p-4">{body}</div>
  );
}

export function Section({ title, sub, action, children, className = "" }: { title: string; sub?: string; action?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section className={`card p-4 space-y-3 ${className}`}>
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="font-heading font-bold text-[var(--ink)]">{title}</h2>
          {sub && <p className="text-xs text-[var(--muted)] mt-0.5">{sub}</p>}
        </div>
        {action}
      </div>
      {children}
    </section>
  );
}

export function Empty({ children }: { children: ReactNode }) {
  return <p className="text-sm text-[var(--muted)] py-2">{children}</p>;
}

/** Horizontal bars, one hue, longest first; label and value in ink, never the bar colour. */
export function ShareBars({ rows, format = rs }: { rows: { label: string; value: number; note?: string; href?: string }[]; format?: (v: number) => string }) {
  const max = Math.max(1, ...rows.map((r) => Math.abs(r.value)));
  if (!rows.length) return <Empty>Nothing in this period.</Empty>;
  return (
    <ul className="space-y-2.5">
      {rows.map((r) => {
        const label = r.href ? (
          <Link href={r.href} className="hover:text-[var(--kesar-text)]">
            {r.label}
          </Link>
        ) : (
          r.label
        );
        return (
          <li key={r.label} className="group" title={`${r.label}: ${format(r.value)}${r.note ? ` · ${r.note}` : ""}`}>
            <div className="flex items-baseline justify-between gap-3 text-sm">
              <span className="truncate text-[var(--ink)]">{label}</span>
              <span className="shrink-0 tabular-nums font-semibold text-[var(--ink)]">
                {format(r.value)}
                {r.note && <span className="ml-1.5 text-xs font-normal text-[var(--muted)]">{r.note}</span>}
              </span>
            </div>
            <div className="mt-1 h-2 rounded-full bg-black/5">
              <div className="h-2 rounded-full bg-mor group-hover:bg-[var(--kesar)] transition-colors" style={{ width: `${Math.max(1, (Math.max(0, r.value) / max) * 100)}%` }} />
            </div>
          </li>
        );
      })}
    </ul>
  );
}

/**
 * Net sales per day as columns (one series, so no legend: the section title
 * names it). Each column has a hover tooltip; a table of the same numbers is
 * in the CSV download. Long periods are summed into weeks.
 */
export function DayColumns({ days }: { days: { day: string; net: number }[] }) {
  const weekly = days.length > 62;
  const points: { label: string; title: string; value: number }[] = [];
  if (weekly) {
    for (let i = 0; i < days.length; i += 7) {
      const chunk = days.slice(i, i + 7);
      const v = chunk.reduce((a, d) => a + d.net, 0);
      points.push({ label: chunk[0].day, title: `Week from ${dayLabel(chunk[0].day)}: ${rs(v)}`, value: v });
    }
  } else {
    for (const d of days) points.push({ label: d.day, title: `${dayLabel(d.day)}: ${rs(d.net)}`, value: d.net });
  }
  const max = Math.max(1, ...points.map((p) => p.value));
  const total = points.reduce((a, p) => a + p.value, 0);
  if (!total) return <Empty>No sales in this period.</Empty>;
  const W = 640;
  const H = 160;
  const gap = 2;
  const bw = Math.max(2, (W - gap * (points.length - 1)) / points.length);
  const ticks = [0, Math.round(points.length / 2), points.length - 1].filter((v, i, a) => a.indexOf(v) === i);
  return (
    <figure>
      <svg viewBox={`0 0 ${W} ${H + 22}`} className="w-full h-auto" role="img" aria-label={`Net sales ${weekly ? "per week" : "per day"}, highest ${rs(max)}`}>
        <line x1="0" x2={W} y1={H} y2={H} stroke="var(--line)" />
        <line x1="0" x2={W} y1={H / 2} y2={H / 2} stroke="var(--line)" strokeDasharray="3 4" />
        <text x="0" y={H / 2 - 4} fontSize="11" fill="var(--muted)">
          {rsShort(max / 2)}
        </text>
        {points.map((p, i) => {
          const h = p.value > 0 ? Math.max(3, (p.value / max) * (H - 8)) : 0;
          const x = i * (bw + gap);
          return (
            <g key={p.label} className="group">
              <title>{p.title}</title>
              <rect x={x} y={0} width={bw} height={H} fill="transparent" />
              {h > 0 && <rect x={x} y={H - h} width={bw} height={h} rx={Math.min(4, bw / 2)} className="fill-mor group-hover:fill-[var(--kesar)]" />}
            </g>
          );
        })}
        {ticks.map((i) => (
          <text key={i} x={Math.min(W - 40, i * (bw + gap))} y={H + 16} fontSize="11" fill="var(--muted)">
            {dayLabel(points[i].label)}
          </text>
        ))}
      </svg>
      <figcaption className="sr-only">Hover a column to see the amount. The CSV download has every {weekly ? "week" : "day"}.</figcaption>
    </figure>
  );
}

export const dayLabel = (d: string) => new Date(`${d}T00:00:00Z`).toLocaleDateString("en-IN", { day: "numeric", month: "short", timeZone: "UTC" });

/** Simple responsive table: columns scroll sideways on a phone. */
export function Table({ head, rows, align }: { head: string[]; rows: ReactNode[][]; align?: ("l" | "r")[] }) {
  if (!rows.length) return <Empty>Nothing in this period.</Empty>;
  const cls = (i: number) => (align?.[i] === "r" ? "text-right tabular-nums" : "text-left");
  return (
    <div className="overflow-x-auto -mx-4">
      <table className="w-full text-sm" style={{ minWidth: head.length * 105 }}>
        <thead>
          <tr className="text-xs text-[var(--muted)] border-b border-[var(--line)]">
            {head.map((h, i) => (
              <th key={h} className={`px-4 py-2 font-semibold whitespace-nowrap ${cls(i)}`}>
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-[var(--line)]">
          {rows.map((r, j) => (
            <tr key={j} className="hover:bg-black/[0.02]">
              {r.map((c, i) => (
                <td key={i} className={`px-4 py-2.5 ${cls(i)} ${i === 0 ? "font-medium text-[var(--ink)]" : ""}`}>
                  {c}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function ErrorCard({ message }: { message: string }) {
  return <p className="card p-4 text-sm text-[#a8281e]">{message}</p>;
}
