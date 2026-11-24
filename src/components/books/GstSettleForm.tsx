"use client";

import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import Icon from "@/components/Icon";
import { errText, Field, readRupees, rupeeText, send } from "@/components/admin/AdminKit";
import { formatINR } from "@/lib/money";
import { addHeads, HEAD_LABEL, HEADS, headsTotal, setOff, usedTotal, type Heads } from "@/lib/gst-math";

const todayIst = () => new Date(Date.now() + 5.5 * 3_600_000).toISOString().slice(0, 10);

/** Settle a month: the credit brought forward (first month only), then how and when the cash was paid. */
export default function GstSettleForm({
  period,
  label,
  from,
  liab,
  rcm,
  itc,
  opening,
  askOpening,
  inputAtStart,
  banks,
}: {
  period: string;
  label: string;
  from: string;
  liab: Heads;
  rcm: Heads;
  itc: Heads;
  opening: Heads;
  askOpening: boolean;
  inputAtStart: number | null;
  banks: { id: string; name: string; isDefault: boolean }[];
}) {
  const router = useRouter();
  const [open, setOpen] = useState<Record<keyof Heads, string>>({ igst: rupeeText(opening.igst), cgst: rupeeText(opening.cgst), sgst: rupeeText(opening.sgst) });
  const [paidOn, setPaidOn] = useState(todayIst());
  const [bank, setBank] = useState(banks.find((b) => b.isDefault)?.id ?? banks[0]?.id ?? "");
  const [challan, setChallan] = useState("");
  const [arn, setArn] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const openP = useMemo(() => {
    const out: Heads = { igst: 0, cgst: 0, sgst: 0 };
    for (const h of HEADS) {
      const v = readRupees(open[h]);
      if (v === "bad") return null;
      out[h] = v ?? 0;
    }
    return out;
  }, [open]);
  const s = useMemo(() => (openP ? setOff({ liab, rcm, credit: addHeads(openP, itc) }) : null), [openP, liab, rcm, itc]);
  const cash = s ? headsTotal(s.cash) : 0;

  async function save() {
    setErr(null);
    if (!openP) return setErr("The credit brought forward is not a number");
    setBusy(true);
    try {
      await send("/api/admin/books/gst/settle", "POST", { period, opening: askOpening ? openP : null, paidOn, bankAccountId: cash ? bank : null, challan, arn });
      router.refresh();
    } catch (e) {
      setErr(errText(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-3">
      {askOpening && (
        <div className="space-y-2">
          <p className="text-sm text-[var(--ink-2)]">
            The first month settled here: enter the electronic credit ledger&apos;s balance on the GST portal at the start of {label}.
            {inputAtStart !== null && <> The GST input account in the books then: {formatINR(inputAtStart)}.</>}
          </p>
          <div className="grid grid-cols-3 gap-2">
            {HEADS.map((h) => (
              <Field key={h} label={`${HEAD_LABEL[h]} credit (₹)`}>
                <input className="input text-right" inputMode="decimal" value={open[h]} onChange={(e) => setOpen((o) => ({ ...o, [h]: e.target.value }))} />
              </Field>
            ))}
          </div>
        </div>
      )}
      {s && (
        <p className="text-sm rounded-lg bg-black/[0.03] px-3 py-2 tabular-nums">
          From credit {formatINR(usedTotal(s.use))} · in cash <span className="font-semibold">{formatINR(cash)}</span> · credit carried forward {formatINR(headsTotal(s.close))}
        </p>
      )}
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Paid on">
          <input type="date" className="input" value={paidOn} min={from} max={todayIst()} onChange={(e) => setPaidOn(e.target.value)} />
        </Field>
        {cash > 0 && (
          <Field label="From bank">
            <select className="input" value={bank} onChange={(e) => setBank(e.target.value)}>
              {banks.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.name}
                </option>
              ))}
            </select>
          </Field>
        )}
        {cash > 0 && (
          <Field label="Challan number (CIN or CPIN)">
            <input className="input" value={challan} maxLength={30} onChange={(e) => setChallan(e.target.value)} />
          </Field>
        )}
        <Field label="ARN of the filed return (optional)">
          <input className="input" value={arn} maxLength={30} onChange={(e) => setArn(e.target.value)} />
        </Field>
      </div>
      {err && <p className="text-sm text-[#a8281e]">{err}</p>}
      <button type="button" className="btn btn-mor btn-sm" disabled={busy || !s} onClick={save}>
        <Icon name="check" className="h-4 w-4" /> {busy ? "Saving…" : cash ? `Settle ${label}: ${formatINR(cash)} paid` : `Settle ${label}`}
      </button>
      <p className="text-xs text-[var(--muted)]">
        Posts: Dr GST output (the tax), Cr GST input (credit used){cash ? ", Cr the bank (cash paid)" : ""}. Months are settled in order; the credit left is brought into next month.
      </p>
    </div>
  );
}
