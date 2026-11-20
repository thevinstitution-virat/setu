"use client";

import Link from "next/link";
import Icon from "@/components/Icon";
import { formatINR } from "@/lib/money";
import type { TripSummary } from "@/lib/trips";
import { failLabel, type TripStatus } from "@/components/dispatch/kit";

const METHOD: Record<string, string> = { CASH: "Cash", UPI: "UPI", CHEQUE: "Cheque", BANK: "Bank transfer" };

/** Goods on the van, per product: loaded / delivered / coming back. Prints with the trip header. */
export function LoadSheet({ summary }: { summary: TripSummary }) {
  const rows = summary.products;
  const total = rows.reduce((a, r) => ({ loaded: a.loaded + r.loaded, delivered: a.delivered + r.delivered, returned: a.returned + r.returned }), {
    loaded: 0,
    delivered: 0,
    returned: 0,
  });
  return (
    <section className="card overflow-hidden print:break-inside-avoid">
      <div className="flex flex-wrap items-center justify-between gap-2 px-4 py-3.5 border-b border-[var(--line)]">
        <h2 className="font-heading font-bold">Load sheet</h2>
        {rows.length > 0 && (
          <button type="button" className="btn btn-quiet btn-sm print:hidden" onClick={() => window.print()}>
            <Icon name="file" className="h-4 w-4" /> Print
          </button>
        )}
      </div>
      {rows.length === 0 ? (
        <p className="p-6 text-center text-sm text-[var(--muted)]">Nothing loaded yet.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[420px] text-sm">
            <thead>
              <tr className="text-xs text-[var(--muted)] border-b border-[var(--line)]">
                <th className="text-left font-semibold px-4 py-2">Product</th>
                <th className="text-left font-semibold px-2 py-2">Unit</th>
                <th className="text-right font-semibold px-2 py-2">Loaded</th>
                <th className="text-right font-semibold px-2 py-2">Delivered</th>
                <th className="text-right font-semibold px-4 py-2">Back</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[var(--line)]">
              {rows.map((r) => (
                <tr key={r.productId}>
                  <td className="px-4 py-2 font-medium">{r.name}</td>
                  <td className="px-2 py-2 text-[var(--ink-2)]">{r.unit}</td>
                  <td className="px-2 py-2 text-right font-semibold">{r.loaded}</td>
                  <td className="px-2 py-2 text-right">{r.delivered}</td>
                  <td className={`px-4 py-2 text-right ${r.returned ? "font-semibold text-[var(--kesar-text)]" : ""}`}>{r.returned}</td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr className="border-t-2 border-[var(--line)] font-bold">
                <td className="px-4 py-2" colSpan={2}>
                  Total
                </td>
                <td className="px-2 py-2 text-right">{total.loaded}</td>
                <td className="px-2 py-2 text-right">{total.delivered}</td>
                <td className="px-4 py-2 text-right">{total.returned}</td>
              </tr>
            </tfoot>
          </table>
        </div>
      )}
    </section>
  );
}

/** Day close: what went out, what came back, money collected, crates. */
export function DayClose({ summary, status }: { summary: TripSummary; status: TripStatus }) {
  const methods = Object.entries(summary.collected).filter(([, v]) => v > 0);
  const collectedTotal = methods.reduce((a, [, v]) => a + v, 0);
  return (
    <section className="card overflow-hidden">
      <div className="px-4 py-3.5 border-b border-[var(--line)]">
        <h2 className="font-heading font-bold">{status === "CLOSED" ? "Day close" : "Day so far"}</h2>
        {status !== "CLOSED" && <p className="text-xs text-[var(--muted)]">Live figures. Frozen when the trip is closed.</p>}
      </div>
      <div className="p-4 space-y-4">
        <div className="grid grid-cols-3 gap-2 text-center">
          <Tile n={summary.delivered} label="Delivered" tone="bg-[var(--mint-tint)] text-[var(--mint-text)]" />
          <Tile n={summary.failed} label="Not delivered" tone={summary.failed ? "bg-[#fde4e1] text-[#a8281e]" : "bg-ink/5"} />
          <Tile n={summary.pending} label="Open" tone={summary.pending ? "bg-[var(--genda-tint)] text-[var(--genda-text)]" : "bg-ink/5"} />
        </div>

        <dl className="space-y-1.5 text-sm">
          <Row label="Value loaded" value={formatINR(summary.value.loaded)} />
          <Row label="Value delivered" value={formatINR(summary.value.delivered)} strong />
        </dl>

        <div className="space-y-1.5">
          <p className="text-xs font-extrabold uppercase tracking-[0.1em] text-[var(--ink-2)]">Collected by the driver</p>
          {methods.length === 0 ? (
            <p className="text-sm text-[var(--muted)]">Nothing collected on this trip yet.</p>
          ) : (
            <dl className="space-y-1.5 text-sm">
              {methods.map(([k, v]) => (
                <Row key={k} label={METHOD[k] ?? k} value={formatINR(v)} />
              ))}
              {methods.length > 1 && <Row label="Total" value={formatINR(collectedTotal)} strong />}
            </dl>
          )}
        </div>

        <div className="rounded-2xl bg-ink/5 p-3 space-y-1.5 text-sm">
          <Row label="Cash expected from this trip" value={formatINR(summary.cashExpected)} strong />
          <Row label="Driver's cash in hand now" value={formatINR(summary.cashInHand)} />
          {summary.cashInHand > 0 && (
            <Link href="/admin/cash" className="inline-flex items-center gap-1 text-sm font-bold text-[var(--kesar-text)] pt-1">
              Receive the cash <Icon name="arrow" className="h-4 w-4" />
            </Link>
          )}
        </div>

        {summary.returnables.length > 0 && (
          <div className="space-y-1.5">
            <p className="text-xs font-extrabold uppercase tracking-[0.1em] text-[var(--ink-2)]">Crates &amp; jars</p>
            <ul className="space-y-1 text-sm">
              {summary.returnables.map((r) => (
                <li key={r.returnableId} className="flex justify-between gap-2">
                  <span className="min-w-0 truncate">{r.name}</span>
                  <span className="shrink-0 text-[var(--ink-2)]">
                    {r.given} given · {r.taken} taken
                  </span>
                </li>
              ))}
            </ul>
          </div>
        )}

        {summary.failedStops.length > 0 && (
          <div className="space-y-1.5">
            <p className="text-xs font-extrabold uppercase tracking-[0.1em] text-[var(--ink-2)]">Not delivered</p>
            <ul className="space-y-1.5 text-sm">
              {summary.failedStops.map((f) => (
                <li key={f.orderNumber} className="min-w-0">
                  <p className="font-medium truncate">{f.outletName}</p>
                  <p className="text-xs text-[var(--muted)]">
                    {f.orderNumber} · {failLabel(f.reason)}
                  </p>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </section>
  );
}

function Tile({ n, label, tone }: { n: number; label: string; tone: string }) {
  return (
    <div className={`rounded-xl py-2.5 px-1 ${tone}`}>
      <p className="font-heading font-bold text-xl leading-none">{n}</p>
      <p className="text-[11px] mt-1 leading-tight opacity-80">{label}</p>
    </div>
  );
}

function Row({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <dt className="text-[var(--ink-2)] min-w-0">{label}</dt>
      <dd className={`shrink-0 ${strong ? "font-bold" : "font-semibold"}`}>{value}</dd>
    </div>
  );
}
