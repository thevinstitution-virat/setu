"use client";

import Link from "next/link";
import { useState } from "react";
import { errText, send, Toggle, useFetch } from "@/components/admin/AdminKit";
import { formatINR } from "@/lib/money";
import type { ReportSettings } from "@/lib/report-settings";

type Today = { sales: number; orders: number; orderValue: number; collected: number; cash: number; delivered: number; failed: number; outstanding: number; overdue: number; waiting: number };

const hourLabel = (h: number) => `${h % 12 === 0 ? 12 : h % 12}:00 ${h < 12 ? "am" : "pm"}`;
const rs = (p: number) => formatINR(p, { whole: true });

/** The evening message to the owner: on/off, the hour, a preview of today and "Send it now". */
export default function SummaryCard({ canEdit }: { canEdit: boolean }) {
  const { data, error, setData } = useFetch<{ settings: ReportSettings; today: Today }>("/api/admin/reports/summary");
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);

  async function save(patch: Partial<ReportSettings>) {
    if (!data) return;
    setBusy(true);
    setNote(null);
    try {
      await send("/api/admin/settings", "PATCH", { reports: patch });
      setData({ ...data, settings: { ...data.settings, ...patch } });
      setNote("Saved");
    } catch (e) {
      setNote(errText(e));
    } finally {
      setBusy(false);
    }
  }

  async function sendNow() {
    setBusy(true);
    setNote(null);
    try {
      await send("/api/admin/reports/summary", "POST");
      setNote("Sent. Check the bell (and WhatsApp, if it is on for this message).");
    } catch (e) {
      setNote(errText(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="card p-4 space-y-3">
      <div>
        <h2 className="font-heading font-bold text-[var(--ink)]">Daily summary to the owner</h2>
        <p className="text-xs text-[var(--muted)] mt-0.5">One message every evening with the day&apos;s sales, money and deliveries.</p>
      </div>
      {error && <p className="text-sm text-[var(--risk-text)]">{error}</p>}
      {!data && !error && <p className="text-sm text-[var(--muted)]">Loading…</p>}
      {data && (
        <>
          <div className="rounded-2xl bg-[var(--success-tint)]/60 border border-[var(--line)] p-3 text-sm leading-relaxed text-[var(--ink)]">
            <p className="font-bold">Today so far</p>
            <p>
              Invoiced {rs(data.today.sales)}. New orders: {data.today.orders}, worth {rs(data.today.orderValue)}. Collected {rs(data.today.collected)} (cash {rs(data.today.cash)}). Delivered {data.today.delivered}, not delivered {data.today.failed}. Outstanding {rs(data.today.outstanding)}, of which {rs(data.today.overdue)} overdue. Waiting to be confirmed: {data.today.waiting}.
            </p>
          </div>
          {canEdit ? (
            <div className="space-y-3">
              <Toggle checked={data.settings.dailySummary} disabled={busy} onChange={(v) => save({ dailySummary: v })} label="Send it every day" hint="To every owner (admin) account: in the app and on push." />
              <label className="flex items-center justify-between gap-3 text-sm">
                <span>Time</span>
                <select className="input !w-auto !py-1.5" value={data.settings.summaryHour} disabled={busy || !data.settings.dailySummary} onChange={(e) => save({ summaryHour: Number(e.target.value) })}>
                  {Array.from({ length: 24 }, (_, h) => (
                    <option key={h} value={h}>
                      {hourLabel(h)}
                    </option>
                  ))}
                </select>
              </label>
              <p className="text-xs text-[var(--muted)]">
                WhatsApp: turn it on for &ldquo;Daily summary (owner)&rdquo; in{" "}
                <Link href="/admin/settings#messages" className="font-bold text-[var(--accent-text)]">
                  Messages
                </Link>{" "}
                (needs your WhatsApp channel set up).
              </p>
              <div className="flex items-center gap-3">
                <button className="btn btn-outline btn-sm" disabled={busy} onClick={sendNow}>
                  Send it now
                </button>
                {note && <span className="text-xs text-[var(--muted)]">{note}</span>}
              </div>
            </div>
          ) : (
            <p className="text-xs text-[var(--muted)]">{data.settings.dailySummary ? `Sent every day at ${hourLabel(data.settings.summaryHour)}.` : "Turned off."}</p>
          )}
        </>
      )}
    </section>
  );
}
