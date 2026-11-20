"use client";

import { useState } from "react";
import Link from "next/link";
import { formatINR } from "@/lib/money";
import { ErrorBox, Toggle, errText, send, shortDate, useFetch } from "@/components/admin/AdminKit";
import type { AutomationKey, AutomationSettings } from "@/lib/automation-settings";

type Run = { id: string; feature: string; trigger: string; startedAt: string; finishedAt: string | null; made: number; error: string | null };
type Ai = { credits: number; costPaise: number; settings: { on: boolean; monthlyCredits: number | null }; available: boolean; message: string | null; model: string | null };
type Data = { settings: AutomationSettings; runs: Run[]; open: Record<string, number>; ai: Ai };

const RUN_LABEL: Record<string, string> = { visit_plan: "Visit plans", collections: "Collections", checks: "Checks", credit: "Credit review", reorder: "Reorder", expire: "Tidy up" };

/** Number box for one setting; whole numbers only, saved on blur. */
function NumberSetting({ label, hint, value, min, max, unit, disabled, onSave }: { label: string; hint?: string; value: number; min: number; max: number; unit?: string; disabled?: boolean; onSave: (v: number) => void }) {
  const [text, setText] = useState(String(value));
  const n = Number(text);
  const bad = !/^\d+$/.test(text) || n < min || n > max;
  return (
    <label className="flex items-center justify-between gap-3 text-sm">
      <span className="min-w-0">
        {label}
        {hint && <span className="block text-xs text-[var(--muted)]">{hint}</span>}
      </span>
      <span className="flex shrink-0 items-center gap-1.5">
        <input
          className={`input !w-24 !py-1.5 text-right tabular-nums ${bad ? "!border-[#a8281e]" : ""}`}
          inputMode="numeric"
          value={text}
          disabled={disabled}
          aria-invalid={bad}
          onChange={(e) => setText(e.target.value.trim())}
          onBlur={() => {
            if (!bad && n !== value) onSave(n);
          }}
        />
        {unit && <span className="w-10 text-xs text-[var(--muted)]">{unit}</span>}
      </span>
    </label>
  );
}

/** Monthly AI credit cap; empty = no cap. */
function CapSetting({ value, disabled, onSave }: { value: number | null; disabled?: boolean; onSave: (v: number | null) => void }) {
  const [text, setText] = useState(value === null ? "" : String(value));
  const bad = text !== "" && (!/^\d+$/.test(text) || Number(text) > 1_000_000);
  return (
    <label className="flex items-center justify-between gap-3 text-sm">
      <span className="min-w-0">
        Monthly cap
        <span className="block text-xs text-[var(--muted)]">Credits; empty = no cap. At the cap, features use their rules.</span>
      </span>
      <input
        className={`input !w-24 !py-1.5 text-right tabular-nums ${bad ? "!border-[#a8281e]" : ""}`}
        inputMode="numeric"
        value={text}
        disabled={disabled}
        aria-invalid={bad}
        onChange={(e) => setText(e.target.value.trim())}
        onBlur={() => {
          const v = text === "" ? null : Number(text);
          if (!bad && v !== value) onSave(v);
        }}
      />
    </label>
  );
}

export default function AutomationSettingsPage() {
  const { data, error, reload, setData } = useFetch<Data>("/api/admin/automation");
  const [note, setNote] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function save<K extends AutomationKey>(k: K, patch: Partial<AutomationSettings[K]>) {
    if (!data) return;
    const next = { ...data.settings[k], ...patch };
    setBusy(true);
    setNote(null);
    try {
      await send("/api/admin/settings", "PATCH", { automation: { [k]: next } });
      setData({ ...data, settings: { ...data.settings, [k]: next } });
      setNote("Saved");
    } catch (e) {
      setNote(errText(e));
    } finally {
      setBusy(false);
    }
  }

  async function saveAi(patch: Partial<Ai["settings"]>) {
    if (!data) return;
    const next = { ...data.ai.settings, ...patch };
    setBusy(true);
    setNote(null);
    try {
      await send("/api/admin/settings", "PATCH", { ai: next });
      setNote("Saved");
      reload();
    } catch (e) {
      setNote(errText(e));
    } finally {
      setBusy(false);
    }
  }

  async function runNow() {
    setBusy(true);
    setNote(null);
    try {
      const r = await send<{ results: { feature: string; made: number; error?: string }[] }>("/api/admin/automation", "POST", { feature: "all" });
      const made = r.results.filter((x) => x.feature !== "expire").reduce((a, x) => a + x.made, 0);
      const failed = r.results.filter((x) => x.error);
      setNote(failed.length ? `Ran, but ${failed.map((x) => RUN_LABEL[x.feature]).join(", ")} failed: ${failed[0].error}` : `Done: ${made} new suggestion${made === 1 ? "" : "s"}.`);
      reload();
    } catch (e) {
      setNote(errText(e));
    } finally {
      setBusy(false);
    }
  }

  const s = data?.settings;
  const openTotal = Object.values(data?.open ?? {}).reduce((a, b) => a + b, 0);

  return (
    <div className="space-y-5">
      <div className="page-head">
        <div className="min-w-0">
          <Link href="/admin/settings" className="text-xs font-bold text-[var(--kesar-text)]">
            ← Settings
          </Link>
          <h1 className="page-title">Automation</h1>
          <p className="page-sub">
            Plain maths on your own records, every morning at 6 (credit review on Mondays). Each one writes{" "}
            <Link href="/admin/suggestions" className="font-bold text-[var(--kesar-text)]">
              suggestions
            </Link>{" "}
            that someone accepts or rejects. Nothing that touches money or prices happens by itself.
          </p>
        </div>
        <div className="flex flex-col items-end gap-1">
          <button type="button" className="btn btn-primary btn-sm" disabled={busy || !data} onClick={runNow}>
            Run now
          </button>
          {openTotal > 0 && (
            <Link href="/admin/suggestions" className="text-xs font-bold text-[var(--kesar-text)]">
              {openTotal} to decide →
            </Link>
          )}
        </div>
      </div>

      {note && (
        <p className="text-sm text-[var(--muted)]" role="status">
          {note}
        </p>
      )}
      {error && <ErrorBox message={error} onRetry={reload} />}
      {!data && !error && <p className="text-sm text-[var(--muted)]">Loading…</p>}

      {s && (
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          <section className="card p-4 space-y-3">
            <h2 className="font-heading font-bold">Daily visit plan</h2>
            <p className="text-xs text-[var(--muted)]">Shops each sales agent should see today besides their beat: drifting away, usual order due, money overdue, a scheme about to end.</p>
            <Toggle checked={s.visitPlan.on} disabled={busy} onChange={(v) => save("visitPlan", { on: v })} label="Make visit plans" />
            <Toggle
              checked={s.visitPlan.auto}
              disabled={busy || !s.visitPlan.on}
              onChange={(v) => save("visitPlan", { auto: v })}
              label="Add them to the agents' day without asking"
              hint="Safe to switch on: a visit plan moves no money. Supervisors can still see what was added."
            />
            <NumberSetting label="Extra shops a day, at most" value={s.visitPlan.maxShops} min={1} max={20} disabled={busy || !s.visitPlan.on} onSave={(v) => save("visitPlan", { maxShops: v })} />
            <NumberSetting label="Only shops scoring at least" hint="0–100; 25 skips weak reasons on their own" value={s.visitPlan.minScore} min={0} max={100} disabled={busy || !s.visitPlan.on} onSave={(v) => save("visitPlan", { minScore: v })} />
          </section>

          <section className="card p-4 space-y-3">
            <h2 className="font-heading font-bold">Collections</h2>
            <p className="text-xs text-[var(--muted)]">After the WhatsApp reminders: a visit to collect, then stopping credit until the shop pays (and giving it back after).</p>
            <Toggle checked={s.collections.on} disabled={busy} onChange={(v) => save("collections", { on: v })} label="Follow up overdue money" />
            <NumberSetting label="Send the agent to collect after" value={s.collections.visitAfterDays} min={1} max={90} unit="days" disabled={busy || !s.collections.on} onSave={(v) => save("collections", { visitAfterDays: v })} />
            <NumberSetting label="Suggest stopping credit after" value={s.collections.stopAfterDays} min={7} max={180} unit="days" disabled={busy || !s.collections.on} onSave={(v) => save("collections", { stopAfterDays: v })} />
          </section>

          <section className="card p-4 space-y-3">
            <h2 className="font-heading font-bold">Credit review</h2>
            <p className="text-xs text-[var(--muted)]">Every Monday: a risk score for each credit shop from how late it pays, bounces and how often it orders, with a new limit when the old one no longer fits.</p>
            <Toggle checked={s.credit.on} disabled={busy} onChange={(v) => save("credit", { on: v })} label="Review credit limits weekly" />
          </section>

          <section className="card p-4 space-y-3">
            <h2 className="font-heading font-bold">Checks</h2>
            <p className="text-xs text-[var(--muted)]">Yesterday&apos;s records, looked over for things worth a question.</p>
            <Toggle checked={s.checks.on} disabled={busy} onChange={(v) => save("checks", { on: v })} label="Look for problems" />
            <NumberSetting label="Cash short at hand-over by" value={s.checks.cashShort / 100} min={0} max={100000} unit="₹" disabled={busy || !s.checks.on} onSave={(v) => save("checks", { cashShort: v * 100 })} />
            <NumberSetting label="Delivered farther than this from the shop" value={s.checks.farMetres} min={50} max={5000} unit="m" disabled={busy || !s.checks.on} onSave={(v) => save("checks", { farMetres: v })} />
            <NumberSetting label="Shop found closed, in 30 days" value={s.checks.closedTimes} min={2} max={10} unit="times" disabled={busy || !s.checks.on} onSave={(v) => save("checks", { closedTimes: v })} />
            <NumberSetting label="Discount on one order of at least" value={s.checks.discountPct} min={1} max={90} unit="%" disabled={busy || !s.checks.on} onSave={(v) => save("checks", { discountPct: v })} />
          </section>

          <section className="card p-4 space-y-3">
            <h2 className="font-heading font-bold">Usual order</h2>
            <p className="text-xs text-[var(--muted)]">Shops and agents see the products a shop buys most times, at the usual quantity, and add them all with one tap.</p>
            <Toggle checked={s.usualOrder.on} disabled={busy} onChange={(v) => save("usualOrder", { on: v })} label="Show the usual order" />
          </section>

          <section className="card p-4 space-y-3">
            <h2 className="font-heading font-bold">Trip planning</h2>
            <p className="text-xs text-[var(--muted)]">
              On{" "}
              <Link href="/admin/dispatch" className="font-bold text-[var(--kesar-text)]">
                Dispatch
              </Link>
              , &ldquo;Plan trips&rdquo; splits the day&apos;s ready orders across the free drivers, one side of town each, in route order.
            </p>
            <Toggle checked={s.tripPlan.on} disabled={busy} onChange={(v) => save("tripPlan", { on: v })} label="Allow trip planning" />
            <NumberSetting label="Drops on one trip, at most" hint="More orders than drivers × this makes bigger trips" value={s.tripPlan.maxDrops} min={3} max={100} disabled={busy || !s.tripPlan.on} onSave={(v) => save("tripPlan", { maxDrops: v })} />
          </section>

          <section className="card p-4 space-y-3">
            <h2 className="font-heading font-bold">Demand forecast</h2>
            <p className="text-xs text-[var(--muted)]">
              From 8 weeks of orders:{" "}
              <Link href="/admin/stock/forecast" className="font-bold text-[var(--kesar-text)]">
                the load sheet
              </Link>{" "}
              for tomorrow, and each morning one reorder suggestion per supplier (a draft purchase order once accepted). Needs stock tracking for reorders.
            </p>
            <Toggle checked={s.forecast.on} disabled={busy} onChange={(v) => save("forecast", { on: v })} label="Forecast demand and suggest reorders" />
            <Toggle
              checked={s.forecast.topUp}
              disabled={busy || !s.forecast.on}
              onChange={(v) => save("forecast", { topUp: v })}
              label="Load sheet: top up to the usual for that weekday"
              hint="Extra for spot sales and late orders. Off: load only what is booked."
            />
            <NumberSetting label="Order enough to last" hint="After the supplier's delivery time" value={s.forecast.coverDays} min={1} max={60} unit="days" disabled={busy || !s.forecast.on} onSave={(v) => save("forecast", { coverDays: v })} />
            <NumberSetting label="Stock should last" hint="Higher keeps more safety stock" value={s.forecast.serviceLevel} min={50} max={99} unit="% of days" disabled={busy || !s.forecast.on} onSave={(v) => save("forecast", { serviceLevel: v })} />
          </section>

          <section className="card p-4 space-y-3">
            <h2 className="font-heading font-bold">Orders by text and voice</h2>
            <p className="text-xs text-[var(--muted)]">
              Shops and agents type, paste or speak an order the way they&apos;d say it (&ldquo;5 peti nimbu, 2 jeera&rdquo;). It is matched to your products and becomes a cart they check before placing. Works without AI; with AI it reads messier messages.
            </p>
            <Toggle checked={s.orderText.on} disabled={busy} onChange={(v) => save("orderText", { on: v })} label="Type or speak your order" />
            <Toggle
              checked={s.orderText.whatsapp}
              disabled={busy || !s.orderText.on}
              onChange={(v) => save("orderText", { whatsapp: v })}
              label="Orders sent on WhatsApp"
              hint="A shop's message to the WhatsApp order number comes back as a link to check and place it. Nothing is ordered without the shop."
            />
          </section>

          <section className="card p-4 space-y-3">
            <h2 className="font-heading font-bold">Ask your business</h2>
            <p className="text-xs text-[var(--muted)]">
              On{" "}
              <Link href="/admin/reports/ask" className="font-bold text-[var(--kesar-text)]">
                Reports → Ask
              </Link>
              , ask in Hindi or English: &ldquo;who owes more than 20,000 for over 30 days?&rdquo;. Answers come from your reports, never made up.
            </p>
            <Toggle checked={s.ask.on} disabled={busy} onChange={(v) => save("ask", { on: v })} label="Allow questions" />
          </section>

          <section className="card p-4 space-y-3">
            <h2 className="font-heading font-bold">Photo checks</h2>
            <p className="text-xs text-[var(--muted)]">
              The same photo used twice and the same UTR on two payments are always caught, without AI. With AI, photos are also read: payment screenshots and cheques are compared with what was entered, and delivery and crate photos are looked at. Results are notes and checks; a person still verifies every payment.
            </p>
            <Toggle checked={s.photos.on} disabled={busy} onChange={(v) => save("photos", { on: v })} label="Read photos with AI" hint="Photos are sent to the AI provider. Names and phone numbers are never asked for." />
            <Toggle
              checked={s.photos.payments}
              disabled={busy || !s.photos.on}
              onChange={(v) => save("photos", { payments: v })}
              label="UPI screenshots and cheques"
              hint="Amount, UTR, date and status, shown in Payments → To verify."
            />
            <Toggle
              checked={s.photos.delivery}
              disabled={busy || !s.photos.on}
              onChange={(v) => save("photos", { delivery: v })}
              label="Delivery and crate pickup photos"
              hint="Blank photos or no shop or goods in them, and crate counts that differ, come to Suggestions → Checks."
            />
          </section>

          <section className="card p-4 space-y-3">
            <h2 className="font-heading font-bold">Shelf audits</h2>
            <p className="text-xs text-[var(--muted)]">
              At a visit, sales agents photograph the shop&apos;s shelf and save our facings, other brands&apos; and empty slots. With AI the counts are filled from the photo for the agent to check. See{" "}
              <Link href="/admin/reports/shelf" className="font-bold text-[var(--kesar-text)]">
                Reports → Shelf
              </Link>
              .
            </p>
            <Toggle checked={s.shelf.on} disabled={busy} onChange={(v) => save("shelf", { on: v })} label="Shelf audits at visits" />
          </section>
        </div>
      )}

      {data && (
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-[2fr_1fr]">
          <section className="card p-4 space-y-3 min-w-0">
            <h2 className="font-heading font-bold">Recent runs</h2>
            {data.runs.length ? (
              <div className="overflow-x-auto -mx-4">
                <table className="w-full text-sm" style={{ minWidth: 420 }}>
                  <thead>
                    <tr className="text-xs text-[var(--muted)] border-b border-[var(--line)]">
                      <th className="px-4 py-2 text-left font-semibold">When</th>
                      <th className="px-4 py-2 text-left font-semibold">What</th>
                      <th className="px-4 py-2 text-right font-semibold">New</th>
                      <th className="px-4 py-2 text-left font-semibold">Result</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[var(--line)]">
                    {data.runs.map((r) => (
                      <tr key={r.id}>
                        <td className="px-4 py-2 whitespace-nowrap">{shortDate(r.startedAt, true)}</td>
                        <td className="px-4 py-2">
                          {RUN_LABEL[r.feature] ?? r.feature}
                          {r.trigger === "manual" && <span className="text-xs text-[var(--muted)]"> · by hand</span>}
                        </td>
                        <td className="px-4 py-2 text-right tabular-nums">{r.made}</td>
                        <td className={`px-4 py-2 text-xs ${r.error ? "text-[#a8281e]" : "text-[var(--muted)]"}`}>{r.error ?? (r.finishedAt ? "Done" : "Running")}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <p className="text-sm text-[var(--muted)]">Nothing has run yet. Press Run now, or wait for 6 am.</p>
            )}
          </section>
          <section className="card p-4 space-y-3">
            <h2 className="font-heading font-bold">AI</h2>
            <p className="font-heading text-2xl font-bold tabular-nums">
              {data.ai.credits} credit{data.ai.credits === 1 ? "" : "s"} <span className="text-sm font-normal text-[var(--muted)]">this month</span>
            </p>
            <p className="text-xs text-[var(--muted)]">
              Provider cost {formatINR(data.ai.costPaise)}. Used by{" "}
              <Link href="/admin/products/assist" className="font-bold text-[var(--kesar-text)]">
                catalogue assist
              </Link>
              ; the automations above are plain maths and use none.
            </p>
            <p className={`rounded-xl px-3 py-2 text-xs ${data.ai.available ? "bg-[var(--mint-tint)]" : "bg-ink/5"}`} role="status">
              {data.ai.available ? `On${data.ai.model ? ` (${data.ai.model})` : ""}.` : data.ai.message}
            </p>
            <Toggle checked={data.ai.settings.on} disabled={busy} onChange={(v) => saveAi({ on: v })} label="Use AI where the plan allows" hint="Off: catalogue assist uses its built-in rules only." />
            <CapSetting value={data.ai.settings.monthlyCredits} disabled={busy || !data.ai.settings.on} onSave={(v) => saveAi({ monthlyCredits: v })} />
          </section>
        </div>
      )}
    </div>
  );
}
