"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import Icon from "@/components/Icon";
import { errText, Field, readRupees, send } from "@/components/admin/AdminKit";
import { formatINR } from "@/lib/money";

type Row = { key: number; number: string; date: string; dueDate: string; amount: string; paid: string };
let seq = 1;
const blank = (): Row => ({ key: seq++, number: "", date: "", dueDate: "", amount: "", paid: "" });
const todayIst = () => new Date(Date.now() + 5.5 * 3_600_000).toISOString().slice(0, 10);

/** What we owed this supplier when moving from the old books, bill by bill, and any advance paid to them. Once. */
export default function OpeningSupplierBills({ supplierId, name }: { supplierId: string; name: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [rows, setRows] = useState<Row[]>([blank()]);
  const [advance, setAdvance] = useState("");
  const [asOf, setAsOf] = useState(todayIst());
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const set = (key: number, p: Partial<Row>) => setRows((rs) => rs.map((r) => (r.key === key ? { ...r, ...p } : r)));

  const parsed = rows
    .filter((r) => r.number || r.amount)
    .map((r) => ({ r, amount: readRupees(r.amount), paid: readRupees(r.paid) }));
  const dues = parsed.reduce((a, x) => a + (typeof x.amount === "number" ? x.amount : 0) - (typeof x.paid === "number" ? x.paid : 0), 0);

  async function save() {
    setErr(null);
    const adv = readRupees(advance);
    if (adv === "bad") return setErr("Write the advance in rupees");
    const bills = [];
    for (const x of parsed) {
      if (x.amount === "bad" || x.amount === null) return setErr(`${x.r.number || "A row"}: write the amount in rupees`);
      if (x.paid === "bad") return setErr(`${x.r.number}: write the paid amount in rupees`);
      bills.push({ number: x.r.number, date: x.r.date, dueDate: x.r.dueDate || null, amount: x.amount, paid: x.paid ?? 0 });
    }
    setBusy(true);
    try {
      await send(`/api/admin/books/suppliers/${supplierId}/opening`, "POST", { asOf, bills, advance: adv ?? 0 });
      setOpen(false);
      router.refresh();
    } catch (e) {
      setErr(errText(e));
    } finally {
      setBusy(false);
    }
  }

  if (!open) {
    return (
      <section className="card p-4 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h3 className="font-heading font-bold text-[var(--ink)]">Moving from the old books?</h3>
          <p className="text-xs text-[var(--muted)]">Enter the bills of {name} still unpaid on the day you start, so payments can be set against them. Done once.</p>
        </div>
        <button type="button" className="btn btn-outline btn-sm" onClick={() => setOpen(true)}>
          Enter opening bills
        </button>
      </section>
    );
  }

  return (
    <section className="card p-4 space-y-4">
      <div>
        <h3 className="font-heading font-bold text-[var(--ink)]">Opening bills of {name}</h3>
        <p className="text-xs text-[var(--muted)]">Each unpaid bill from the old books, with any part already paid. Due dates left blank follow the supplier&apos;s credit days.</p>
      </div>
      <Field label="Balance as on" hint="Usually the day before you start using these books.">
        <input type="date" className="input max-w-xs" value={asOf} max={todayIst()} onChange={(e) => setAsOf(e.target.value)} />
      </Field>
      <div className="space-y-3">
        {rows.map((r, i) => (
          <div key={r.key} className="grid gap-2 grid-cols-2 md:grid-cols-[minmax(0,1.3fr)_repeat(4,minmax(0,1fr))_auto] items-end rounded-xl border border-[var(--line)] p-3">
            <Field label="Their bill no">
              <input className="input" value={r.number} maxLength={40} onChange={(e) => set(r.key, { number: e.target.value })} />
            </Field>
            <Field label="Bill date">
              <input type="date" className="input" value={r.date} onChange={(e) => set(r.key, { date: e.target.value })} />
            </Field>
            <Field label="Due date">
              <input type="date" className="input" value={r.dueDate} onChange={(e) => set(r.key, { dueDate: e.target.value })} />
            </Field>
            <Field label="Bill amount (₹)">
              <input className="input" inputMode="decimal" value={r.amount} onChange={(e) => set(r.key, { amount: e.target.value })} />
            </Field>
            <Field label="Already paid (₹)">
              <input className="input" inputMode="decimal" value={r.paid} onChange={(e) => set(r.key, { paid: e.target.value })} />
            </Field>
            {rows.length > 1 ? (
              <button type="button" className="btn btn-quiet btn-xs mb-1" aria-label={`Remove row ${i + 1}`} onClick={() => setRows((rs) => rs.filter((x) => x.key !== r.key))}>
                <Icon name="x" className="h-3.5 w-3.5" />
              </button>
            ) : (
              <span />
            )}
          </div>
        ))}
        <button type="button" className="btn btn-outline btn-xs" onClick={() => setRows((rs) => [...rs, blank()])}>
          <Icon name="plus" className="h-3.5 w-3.5" /> Add a bill
        </button>
      </div>
      <Field label="Advance we had paid them (₹)" hint="Money with them not yet set against any bill. Optional.">
        <input className="input max-w-xs" inputMode="decimal" value={advance} onChange={(e) => setAdvance(e.target.value)} />
      </Field>
      <p className="text-sm">
        Still to pay on these bills: <span className="font-bold tabular-nums">{formatINR(Math.max(0, dues))}</span>
      </p>
      {err && <p className="text-sm text-[#a8281e]">{err}</p>}
      <div className="flex justify-end gap-2">
        <button type="button" className="btn btn-quiet btn-sm" onClick={() => setOpen(false)}>
          Cancel
        </button>
        <button type="button" className="btn btn-mor btn-sm" disabled={busy} onClick={save}>
          {busy ? "Saving…" : "Save opening bills"}
        </button>
      </div>
    </section>
  );
}
