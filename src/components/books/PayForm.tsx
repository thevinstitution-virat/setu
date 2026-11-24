"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import Icon from "@/components/Icon";
import { errText, ErrorBox, Field, readRupees, SearchPick, send, useFetch } from "@/components/admin/AdminKit";
import { PAY_METHOD_LABEL, TDS_SECTIONS, type PayMethod } from "@/lib/pay-labels";
import { formatINR } from "@/lib/money";
import { showDay } from "@/components/books/fmt";
import { TdsHint, useProposal } from "@/components/books/TdsForms";

type Options = {
  banks: { id: string; name: string; isDefault: boolean }[];
  suppliers: {
    id: string;
    name: string;
    kind: string;
    tdsSection: string | null;
    bankName: string | null;
    bankAccountNo: string | null;
    bankIfsc: string | null;
  }[];
};
type Detail = {
  summary: { owed: number; overdue: number; unused: number };
  bills: {
    id: string;
    kind: string;
    number: string;
    date: string;
    dueDate: string;
    amount: number;
    paid: number;
    left: number;
    overdue: boolean;
  }[];
};

const todayIst = () => new Date(Date.now() + 5.5 * 3_600_000).toISOString().slice(0, 10);
const METHODS: PayMethod[] = ["BANK", "CHEQUE", "CASH"];

/**
 * Pay a supplier: how (bank, our cheque, cash), how much, any TDS kept back,
 * and which bills it settles. Ticked bills are settled first in the order
 * ticked; the rest goes to the oldest, and anything over is an advance.
 */
export default function PayForm({ options: o, initialSupplier }: { options: Options; initialSupplier: string | null }) {
  const router = useRouter();
  const [supplierId, setSupplierId] = useState<string | null>(initialSupplier && o.suppliers.some((s) => s.id === initialSupplier) ? initialSupplier : null);
  const [date, setDate] = useState(todayIst());
  const [method, setMethod] = useState<PayMethod>("BANK");
  const [bankId, setBankId] = useState(o.banks[0]?.id ?? "");
  const [amount, setAmount] = useState("");
  const [typed, setTyped] = useState(false);
  const [tds, setTds] = useState("");
  const [section, setSection] = useState(() => o.suppliers.find((x) => x.id === initialSupplier)?.tdsSection ?? "");
  const [tdsNote, setTdsNote] = useState("");
  const [reference, setReference] = useState("");
  const [chequeNo, setChequeNo] = useState("");
  const [chequeDate, setChequeDate] = useState("");
  const [picked, setPicked] = useState<string[]>([]);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const supplier = o.suppliers.find((s) => s.id === supplierId) ?? null;
  const { data: d, error, reload } = useFetch<Detail>(supplierId ? `/api/admin/books/suppliers/${supplierId}` : null);
  const bills = useMemo(() => (d && supplierId ? d.bills : []), [d, supplierId]);


  const tdsP = readRupees(tds);
  const tdsN = typeof tdsP === "number" ? tdsP : 0;
  const pickedSum = picked.reduce((a, id) => a + (bills.find((b) => b.id === id)?.left ?? 0), 0);
  // Until the amount is typed by hand, it follows the ticked bills (less TDS).
  const amountText = typed ? amount : pickedSum ? String(Math.max(0, pickedSum - tdsN) / 100) : "";
  const amountP = readRupees(amountText);


  const paid = typeof amountP === "number" ? amountP : 0;
  const settles = paid + tdsN;
  const proposal = useProposal({ section: section.trim(), base: settles || null, date, basis: "PAYMENT", supplierId });
  const tdsDiffers = !!proposal && proposal.known && proposal.tds !== tdsN;
  const openTotal = bills.reduce((a, b) => a + b.left, 0);
  const advance = Math.max(0, settles - openTotal);
  const toggle = (id: string) => setPicked((p) => (p.includes(id) ? p.filter((x) => x !== id) : [...p, id]));

  async function save() {
    setErr(null);
    if (!supplierId) return setErr("Choose the supplier");
    if (amountP === "bad" || !amountP) return setErr("Enter the amount paid in rupees");
    if (tdsP === "bad") return setErr("Write the TDS in rupees");
    if (tdsN && !section.trim()) return setErr("Pick the TDS section");
    if (tdsDiffers && !tdsNote.trim()) return setErr("Say why the TDS is different from what the app works out");
    if (method === "CHEQUE" && !chequeNo.trim()) return setErr("Enter the cheque number");
    if (method !== "CASH" && !bankId) return setErr("Add a bank account first (Books → Bank accounts)");
    setBusy(true);
    try {
      const r = await send<{ payment: { id: string } }>("/api/admin/books/payments", "POST", {
        supplierId,
        date,
        method,
        bankAccountId: method === "CASH" ? null : bankId,
        amount: amountP,
        tds: tdsN,
        tdsSection: tdsN ? section : null,
        tdsNote: tdsDiffers ? tdsNote.trim() : null,
        reference: method === "BANK" ? reference : null,
        cheque: method === "CHEQUE" ? { number: chequeNo, date: chequeDate || date } : null,
        billIds: picked,
        note,
      });
      router.push(`/admin/books/payments/${r.payment.id}`);
      router.refresh();
    } catch (e) {
      setErr(errText(e));
      setBusy(false);
    }
  }

  const chip = (on: boolean) => `rounded-full px-3.5 py-1.5 text-sm font-semibold ${on ? "bg-ink text-white" : "bg-black/5 text-foreground/70"}`;

  return (
    <div className="space-y-4">
      <Link href="/admin/books/payments" className="inline-flex items-center gap-1 text-sm font-bold text-[var(--ink-2)]">
        <Icon name="arrow" className="h-4 w-4 rotate-180" /> Payments
      </Link>

      <section className="card p-4 sm:p-5 space-y-4">
        <h2 className="font-heading text-xl font-bold text-[var(--ink)]">Pay a supplier</h2>
        <Field label="Supplier">
          <SearchPick
            options={o.suppliers.map((s) => ({
              id: s.id,
              label: s.name,
              sub: s.kind === "GOODS" ? "Company" : s.kind === "SERVICES" ? "Services" : "Other",
            }))}
            value={supplierId}
            onChange={(id) => {
              setSupplierId(id);
              setPicked([]);
              setTyped(false);
              setAmount("");
              setSection(o.suppliers.find((x) => x.id === id)?.tdsSection ?? "");
            }}
            placeholder="Search suppliers"
          />
        </Field>
        {supplier && d && (
          <p className="text-sm">
            We owe them <span className="font-bold tabular-nums">{formatINR(Math.max(0, d.summary.owed))}</span>
            {d.summary.overdue > 0 && <span className="text-[#a8281e]"> · {formatINR(d.summary.overdue)} past due</span>}
            {d.summary.owed < 0 && <span className="text-[var(--muted)]"> · paid ahead {formatINR(-d.summary.owed)}</span>}
          </p>
        )}

        <div className="flex flex-wrap gap-2" role="radiogroup" aria-label="Paid by">
          {METHODS.map((m) => (
            <button key={m} type="button" role="radio" aria-checked={method === m} className={chip(method === m)} onClick={() => setMethod(m)}>
              {PAY_METHOD_LABEL[m]}
            </button>
          ))}
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Date paid">
            <input type="date" className="input" value={date} max={todayIst()} onChange={(e) => setDate(e.target.value)} />
          </Field>
          {method !== "CASH" && (
            <Field label={method === "CHEQUE" ? "Cheque on our bank" : "From our bank"}>
              {o.banks.length ? (
                <select className="input" value={bankId} onChange={(e) => setBankId(e.target.value)}>
                  {o.banks.map((b) => (
                    <option key={b.id} value={b.id}>
                      {b.name}
                      {b.isDefault ? " (default)" : ""}
                    </option>
                  ))}
                </select>
              ) : (
                <p className="text-sm text-[#a8281e]">
                  No bank account yet.{" "}
                  <Link href="/admin/books/banks" className="underline">
                    Add one
                  </Link>
                  .
                </p>
              )}
            </Field>
          )}
          {method === "BANK" && (
            <Field label="UTR / reference" hint="Helps match the bank statement later.">
              <input className="input" value={reference} maxLength={60} onChange={(e) => setReference(e.target.value)} />
            </Field>
          )}
          {method === "CHEQUE" && (
            <>
              <Field label="Cheque number">
                <input className="input" inputMode="numeric" value={chequeNo} maxLength={20} onChange={(e) => setChequeNo(e.target.value)} />
              </Field>
              <Field label="Cheque date" hint="Blank = the date paid. A later date for a post-dated cheque.">
                <input type="date" className="input" value={chequeDate} onChange={(e) => setChequeDate(e.target.value)} />
              </Field>
            </>
          )}
        </div>
        {method === "BANK" && supplier?.bankAccountNo && (
          <p className="text-xs text-[var(--muted)]">
            Their bank: {supplier.bankName} ····
            {supplier.bankAccountNo.slice(-4)} {supplier.bankIfsc ?? ""}
          </p>
        )}
      </section>

      {supplier && (
        <section className="card p-0 overflow-hidden">
          <div className="px-4 pt-4">
            <h3 className="font-heading font-bold text-[var(--ink)]">Which bills does it pay?</h3>
            <p className="text-xs text-[var(--muted)]">Tick bills to pay them first. The rest goes to the oldest bills; anything over is kept as an advance.</p>
          </div>
          {error ? (
            <div className="p-4">
              <ErrorBox message={error} onRetry={reload} />
            </div>
          ) : !d ? (
            <p className="p-4 text-sm text-[var(--muted)]">Loading bills…</p>
          ) : bills.length ? (
            <ul className="divide-y divide-[var(--line)] mt-2">
              {bills.map((b) => {
                const on = picked.includes(b.id);
                return (
                  <li key={b.id}>
                    <label className={`flex items-center gap-3 px-4 py-2.5 cursor-pointer ${on ? "bg-[var(--kesar-tint)]" : ""}`}>
                      <input type="checkbox" className="h-4 w-4 shrink-0" checked={on} onChange={() => toggle(b.id)} />
                      <span className="min-w-0 flex-1">
                        <span className="font-semibold">{b.number}</span>
                        {b.kind === "OPENING" && <span className="chip !text-[10px] ml-1">Old books</span>}
                        <span className={`block text-xs ${b.overdue ? "text-[#a8281e]" : "text-[var(--muted)]"}`}>
                          {showDay(b.date)} · due {showDay(b.dueDate)}
                          {on ? ` · ${picked.indexOf(b.id) + 1}` : ""}
                        </span>
                      </span>
                      <span className="tabular-nums font-semibold text-right">{formatINR(b.left)}</span>
                    </label>
                  </li>
                );
              })}
            </ul>
          ) : (
            <p className="p-4 text-sm text-[var(--muted)]">No open bills: the whole payment is kept as an advance.</p>
          )}
        </section>
      )}

      <section className="card p-4 sm:p-5 space-y-3">
        <div className="grid gap-3 sm:grid-cols-3">
          <Field label="Amount paid (₹)" hint={picked.length && !typed ? "From the ticked bills" : undefined}>
            <input
              className="input"
              inputMode="decimal"
              value={amountText}
              onChange={(e) => {
                setTyped(true);
                setAmount(e.target.value);
              }}
            />
          </Field>
          <Field label="TDS kept back (₹)" hint="Optional. The bills are settled by the amount plus TDS.">
            <input className="input" inputMode="decimal" value={tds} onChange={(e) => setTds(e.target.value)} />
          </Field>
          <Field label="TDS section" hint={tdsN ? undefined : "If TDS applies"}>
            <input className="input uppercase" list="tds-sections" value={section} maxLength={12} onChange={(e) => setSection(e.target.value.toUpperCase())} />
            <datalist id="tds-sections">
              {TDS_SECTIONS.map((t) => (
                <option key={t.code} value={t.code}>
                  {t.label}
                </option>
              ))}
            </datalist>
          </Field>
        </div>
        <TdsHint p={proposal} current={tdsN} onUse={(v) => setTds(v ? String(v / 100) : "")} />
        {tdsDiffers && (
          <Field label="Why is the TDS different?" hint="Kept with the payment, for the CA. For example: lower-deduction certificate, or already deducted on the bill.">
            <input className="input" value={tdsNote} maxLength={300} onChange={(e) => setTdsNote(e.target.value)} />
          </Field>
        )}
        <Field label="Note (optional)">
          <input className="input" value={note} maxLength={300} onChange={(e) => setNote(e.target.value)} />
        </Field>
        {settles > 0 && (
          <dl className="text-sm space-y-1 tabular-nums max-w-sm">
            <div className="flex justify-between">
              <dt className="text-[var(--muted)]">Settles bills of</dt>
              <dd>{formatINR(settles)}</dd>
            </div>
            {tdsN > 0 && (
              <div className="flex justify-between">
                <dt className="text-[var(--muted)]">of which TDS to deposit</dt>
                <dd>{formatINR(tdsN)}</dd>
              </div>
            )}
            {advance > 0 && (
              <div className="flex justify-between font-semibold">
                <dt>Kept as an advance</dt>
                <dd>{formatINR(advance)}</dd>
              </div>
            )}
          </dl>
        )}
        {err && <p className="text-sm text-[#a8281e]">{err}</p>}
      </section>

      <div className="sticky bottom-[5.5rem] md:bottom-3 z-10">
        <div className="card p-3 shadow-xl flex items-center justify-between gap-3">
          <div className="min-w-0">
            <p className="font-heading font-bold text-lg leading-tight tabular-nums">{formatINR(paid)}</p>
            <p className="text-xs text-[var(--muted)] truncate">
              {PAY_METHOD_LABEL[method]}
              {supplier ? ` to ${supplier.name}` : ""}
            </p>
          </div>
          <button type="button" className="btn btn-mor shrink-0" disabled={busy || !supplierId || !paid} onClick={save}>
            <Icon name="check" className="h-4 w-4" /> {busy ? "Saving…" : "Save payment"}
          </button>
        </div>
      </div>
    </div>
  );
}
