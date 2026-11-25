"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import Icon from "@/components/Icon";
import { errText, Field, readRupees, SearchPick, send } from "@/components/admin/AdminKit";
import { CLAIM_TYPE_HINT, CLAIM_TYPE_LABEL, CLAIM_TYPES } from "@/lib/claim-labels";
import type { ClaimType } from "@/generated/prisma/enums";
import { formatINR } from "@/lib/money";
import { showDay } from "@/components/books/fmt";

type Options = { companies: { id: string; name: string; gstin: string | null }[] };
type Line = { key: number; productId: string | null; description: string; quantity: string; rate: string; evidence: string };
type Basis = {
  lines: { productId: string | null; description: string; quantity: number; rate: number; evidence: string | null }[];
  stock: { productId: string; name: string; qty: number; cost: number | null }[];
  noCost: string[];
  products: number;
  overlaps: { id: string; number: string; from: string | null; to: string | null; amount: number }[];
};
type Cut = { productId: string; name: string; qty: number; oldRate: string; newRate: string };

let seq = 1;
const blank = (): Line => ({ key: seq++, productId: null, description: "", quantity: "1", rate: "", evidence: "" });
const todayIst = () => new Date(Date.now() + 5.5 * 3_600_000).toISOString().slice(0, 10);
/** Last month, first to last day: the usual claim period. */
function lastMonth() {
  const t = new Date(`${todayIst()}T00:00:00Z`);
  const first = new Date(Date.UTC(t.getUTCFullYear(), t.getUTCMonth() - 1, 1));
  const last = new Date(Date.UTC(t.getUTCFullYear(), t.getUTCMonth(), 0));
  return { from: first.toISOString().slice(0, 10), to: last.toISOString().slice(0, 10) };
}
const rupeesText = (p: number) => String(p / 100);

/**
 * Raise a claim on a company. "Fill from our records" brings in what the app
 * already knows (schemes given, goods gone bad, stock on the day of a rate
 * cut); every line can be changed or removed before raising.
 */
export default function ClaimForm({ options: o, initialCompany, initialType }: { options: Options; initialCompany: string | null; initialType: ClaimType | null }) {
  const router = useRouter();
  const lm = lastMonth();
  const [companyId, setCompanyId] = useState<string | null>(initialCompany && o.companies.some((c) => c.id === initialCompany) ? initialCompany : null);
  const [type, setType] = useState<ClaimType>(initialType ?? "SCHEME");
  const [date, setDate] = useState(todayIst());
  const [from, setFrom] = useState(lm.from);
  const [to, setTo] = useState(lm.to);
  const [cutDay, setCutDay] = useState(todayIst());
  const [reference, setReference] = useState("");
  const [note, setNote] = useState("");
  const [lines, setLines] = useState<Line[]>([blank()]);
  const [basis, setBasis] = useState<Basis | null>(null);
  const [cuts, setCuts] = useState<Cut[]>([]);
  const [filling, setFilling] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const company = o.companies.find((c) => c.id === companyId) ?? null;
  const setLine = (key: number, p: Partial<Line>) => setLines((ls) => ls.map((l) => (l.key === key ? { ...l, ...p } : l)));
  const money = lines.map((l) => {
    const q = Number(l.quantity);
    const r = readRupees(l.rate);
    return Number.isInteger(q) && q > 0 && typeof r === "number" ? q * r : 0;
  });
  const total = money.reduce((a, b) => a + b, 0);
  const isRate = type === "RATE_DIFF";
  const canFill = type !== "OTHER" && !!companyId;

  async function fill() {
    if (!companyId) return setErr("Choose the company");
    setErr(null);
    setFilling(true);
    try {
      const q = new URLSearchParams({ supplier: companyId, type, from: isRate ? cutDay : from, to: isRate ? cutDay : to });
      const res = await fetch(`/api/admin/books/claims/basis?${q}`);
      const j = await res.json();
      if (!res.ok) throw new Error(j.error ?? "Could not read our records");
      const b = j as Basis;
      setBasis(b);
      if (isRate) {
        setCuts(b.stock.map((s) => ({ productId: s.productId, name: s.name, qty: s.qty, oldRate: s.cost != null ? rupeesText(s.cost) : "", newRate: "" })));
      } else if (b.lines.length) {
        const kept = lines.filter((l) => l.description.trim() || readRupees(l.rate));
        setLines([
          ...kept,
          ...b.lines.map((l) => ({ key: seq++, productId: l.productId, description: l.description, quantity: String(l.quantity), rate: rupeesText(l.rate), evidence: l.evidence ?? "" })),
        ]);
      }
    } catch (e) {
      setErr(errText(e));
    } finally {
      setFilling(false);
    }
  }

  function addCuts() {
    const add: Line[] = [];
    for (const c of cuts) {
      const a = readRupees(c.oldRate);
      const b = readRupees(c.newRate);
      if (typeof a !== "number" || typeof b !== "number" || b >= a) continue;
      add.push({
        key: seq++,
        productId: c.productId,
        description: `${c.name}: rate cut ₹${c.oldRate} → ₹${c.newRate} on ${showDay(cutDay)}`,
        quantity: String(c.qty),
        rate: rupeesText(a - b),
        evidence: "Stock on hand that day",
      });
    }
    if (!add.length) return setErr("Enter a lower new rate for at least one product");
    setErr(null);
    const kept = lines.filter((l) => l.description.trim() || readRupees(l.rate));
    setLines([...kept, ...add]);
  }

  async function save() {
    setErr(null);
    if (!companyId) return setErr("Choose the company");
    const out = [];
    for (const [i, l] of lines.entries()) {
      if (!l.description.trim() && !l.rate.trim()) continue;
      const r = readRupees(l.rate);
      if (typeof r !== "number" || r <= 0) return setErr(`Line ${i + 1}: enter the rate in rupees`);
      const q = Number(l.quantity);
      if (!Number.isInteger(q) || q < 1) return setErr(`Line ${i + 1}: quantity must be a whole number`);
      out.push({ productId: l.productId, description: l.description, quantity: q, rate: r, evidence: l.evidence });
    }
    if (!out.length) return setErr("Add what you are claiming");
    setBusy(true);
    try {
      const r = await send<{ claim: { id: string } }>("/api/admin/books/claims", "POST", {
        supplierId: companyId,
        type,
        date,
        periodFrom: isRate ? cutDay : type === "OTHER" && !from ? null : from,
        periodTo: isRate ? cutDay : type === "OTHER" && !to ? null : to,
        reference,
        note,
        lines: out,
      });
      router.push(`/admin/books/claims/${r.claim.id}`);
      router.refresh();
    } catch (e) {
      setErr(errText(e));
      setBusy(false);
    }
  }

  const chip = (on: boolean) => `rounded-full px-3.5 py-1.5 text-sm font-semibold ${on ? "bg-ink text-white" : "bg-black/5 text-foreground/70"}`;

  return (
    <div className="space-y-4">
      <Link href="/admin/books/claims" className="inline-flex items-center gap-1 text-sm font-bold text-[var(--ink-2)]">
        <Icon name="arrow" className="h-4 w-4 rotate-180" /> Claims
      </Link>

      <section className="card p-4 sm:p-5 space-y-4">
        <h2 className="font-heading text-xl font-bold text-[var(--ink)]">Raise a claim</h2>
        <Field label="Company">
          <SearchPick
            options={o.companies.map((c) => ({ id: c.id, label: c.name, sub: c.gstin ?? undefined }))}
            value={companyId}
            onChange={(id) => {
              setCompanyId(id);
              setBasis(null);
              setCuts([]);
            }}
            placeholder="Search companies"
          />
        </Field>
        <div>
          <div className="flex flex-wrap gap-2" role="radiogroup" aria-label="Claim for">
            {CLAIM_TYPES.map((t) => (
              <button
                key={t}
                type="button"
                role="radio"
                aria-checked={type === t}
                className={chip(type === t)}
                onClick={() => {
                  setType(t);
                  setBasis(null);
                  setCuts([]);
                }}
              >
                {CLAIM_TYPE_LABEL[t]}
              </button>
            ))}
          </div>
          <p className="mt-1.5 text-xs text-[var(--muted)]">{CLAIM_TYPE_HINT[type]}</p>
        </div>
        <div className="grid gap-3 sm:grid-cols-3">
          {isRate ? (
            <Field label="Day the rate was cut" hint="Our stock at the end of this day is claimed.">
              <input type="date" className="input" value={cutDay} max={todayIst()} onChange={(e) => setCutDay(e.target.value)} />
            </Field>
          ) : (
            <>
              <Field label="Period from">
                <input type="date" className="input" value={from} max={todayIst()} onChange={(e) => setFrom(e.target.value)} />
              </Field>
              <Field label="Period to">
                <input type="date" className="input" value={to} max={todayIst()} onChange={(e) => setTo(e.target.value)} />
              </Field>
            </>
          )}
          <Field label="Claim date">
            <input type="date" className="input" value={date} max={todayIst()} onChange={(e) => setDate(e.target.value)} />
          </Field>
          <Field label="Their scheme name / reference" hint="Optional.">
            <input className="input" value={reference} maxLength={80} onChange={(e) => setReference(e.target.value)} />
          </Field>
        </div>
        {canFill && (
          <div className="flex flex-wrap items-center gap-2">
            <button type="button" className="btn btn-outline btn-sm" disabled={filling} onClick={fill}>
              <Icon name="search" className="h-4 w-4" /> {filling ? "Reading…" : isRate ? "Show our stock that day" : "Fill from our records"}
            </button>
            {basis && !isRate && (
              <span className="text-xs text-[var(--muted)]">
                {basis.lines.length ? `${basis.lines.length} line${basis.lines.length === 1 ? "" : "s"} added. Check them before raising.` : "Nothing found for this period."}
              </span>
            )}
          </div>
        )}
        {basis && basis.products === 0 && <p className="text-sm text-[#a8281e]">No products are linked to {company?.name}. Set the company on its products first.</p>}
        {basis && basis.noCost.length > 0 && <p className="text-sm text-[#a8281e]">No cost known for {basis.noCost.join(", ")}: add those lines by hand.</p>}
        {basis && basis.overlaps.length > 0 && (
          <p className="text-sm text-[#a8281e]">
            Already claimed for part of this period:{" "}
            {basis.overlaps.map((x, i) => (
              <span key={x.id}>
                {i ? ", " : ""}
                <Link href={`/admin/books/claims/${x.id}`} className="underline">
                  {x.number}
                </Link>{" "}
                ({formatINR(x.amount)})
              </span>
            ))}
            .
          </p>
        )}
      </section>

      {isRate && basis && (
        <section className="card p-0 overflow-hidden">
          <div className="px-4 pt-4">
            <h3 className="font-heading font-bold text-[var(--ink)]">Our stock on {showDay(cutDay)}</h3>
            <p className="text-xs text-[var(--muted)]">Enter the new rate for the products they cut. Old rate is our last cost; change it if the company&apos;s old rate differs.</p>
          </div>
          {cuts.length ? (
            <ul className="divide-y divide-[var(--line)] mt-2">
              {cuts.map((c, i) => (
                <li key={c.productId} className="px-4 py-2.5 grid gap-2 sm:grid-cols-[1fr_7rem_7rem] items-center">
                  <span className="min-w-0">
                    <span className="font-semibold">{c.name}</span>
                    <span className="block text-xs text-[var(--muted)]">{c.qty.toLocaleString("en-IN")} in stock</span>
                  </span>
                  <input
                    className="input !py-1.5"
                    inputMode="decimal"
                    aria-label={`Old rate of ${c.name}`}
                    placeholder="Old ₹"
                    value={c.oldRate}
                    onChange={(e) => setCuts((cs) => cs.map((x, j) => (j === i ? { ...x, oldRate: e.target.value } : x)))}
                  />
                  <input
                    className="input !py-1.5"
                    inputMode="decimal"
                    aria-label={`New rate of ${c.name}`}
                    placeholder="New ₹"
                    value={c.newRate}
                    onChange={(e) => setCuts((cs) => cs.map((x, j) => (j === i ? { ...x, newRate: e.target.value } : x)))}
                  />
                </li>
              ))}
            </ul>
          ) : (
            <p className="p-4 text-sm text-[var(--muted)]">We held none of their products that day.</p>
          )}
          {cuts.length > 0 && (
            <div className="p-4">
              <button type="button" className="btn btn-outline btn-sm" onClick={addCuts}>
                Add these to the claim
              </button>
            </div>
          )}
        </section>
      )}

      <section className="card p-0 overflow-hidden">
        <div className="px-4 pt-4 flex items-center justify-between gap-2">
          <h3 className="font-heading font-bold text-[var(--ink)]">What we claim</h3>
          <button type="button" className="btn btn-quiet btn-xs" onClick={() => setLines((ls) => [...ls, blank()])}>
            <Icon name="plus" className="h-3.5 w-3.5" /> Add a line
          </button>
        </div>
        <ul className="divide-y divide-[var(--line)] mt-2">
          {lines.map((l, i) => (
            <li key={l.key} className="px-4 py-3 space-y-2">
              <div className="flex items-start gap-2">
                <span className="text-xs text-[var(--muted)] pt-2.5 w-5 shrink-0">{i + 1}</span>
                <input
                  className="input flex-1 min-w-0"
                  placeholder="What it is for"
                  aria-label={`Line ${i + 1}: what it is for`}
                  value={l.description}
                  maxLength={160}
                  onChange={(e) => setLine(l.key, { description: e.target.value })}
                />
                {lines.length > 1 && (
                  <button type="button" className="btn btn-quiet btn-xs shrink-0 mt-1" aria-label={`Remove line ${i + 1}`} onClick={() => setLines((ls) => ls.filter((x) => x.key !== l.key))}>
                    <Icon name="x" className="h-3.5 w-3.5" />
                  </button>
                )}
              </div>
              <div className="grid grid-cols-[4.5rem_1fr_auto] sm:grid-cols-[5rem_8rem_1fr_auto] gap-2 items-center pl-7">
                <input className="input !py-1.5" inputMode="numeric" aria-label={`Line ${i + 1}: quantity`} value={l.quantity} onChange={(e) => setLine(l.key, { quantity: e.target.value })} />
                <input
                  className="input !py-1.5"
                  inputMode="decimal"
                  placeholder="Rate ₹"
                  aria-label={`Line ${i + 1}: rate`}
                  value={l.rate}
                  onChange={(e) => setLine(l.key, { rate: e.target.value })}
                />
                <input
                  className="input !py-1.5 col-span-3 sm:col-span-1 order-last sm:order-none"
                  placeholder="Evidence: bill numbers, photo ref (optional)"
                  aria-label={`Line ${i + 1}: evidence`}
                  value={l.evidence}
                  maxLength={200}
                  onChange={(e) => setLine(l.key, { evidence: e.target.value })}
                />
                <span className="tabular-nums font-semibold text-right text-sm">{money[i] ? formatINR(money[i]) : ""}</span>
              </div>
            </li>
          ))}
        </ul>
        <div className="p-4 pt-2">
          <Field label="Note (optional)" hint="Printed on the claim letter.">
            <input className="input" value={note} maxLength={500} onChange={(e) => setNote(e.target.value)} />
          </Field>
        </div>
        {err && <p className="px-4 pb-4 text-sm text-[#a8281e]">{err}</p>}
      </section>

      <div className="sticky bottom-[5.5rem] md:bottom-3 z-10">
        <div className="card p-3 shadow-xl flex items-center justify-between gap-3">
          <div className="min-w-0">
            <p className="font-heading font-bold text-lg leading-tight tabular-nums">{formatINR(total)}</p>
            <p className="text-xs text-[var(--muted)] truncate">
              {CLAIM_TYPE_LABEL[type]}
              {company ? ` on ${company.name}` : ""}
            </p>
          </div>
          <button type="button" className="btn btn-mor shrink-0" disabled={busy || !companyId || !total} onClick={save}>
            <Icon name="check" className="h-4 w-4" /> {busy ? "Saving…" : "Raise claim"}
          </button>
        </div>
      </div>
    </div>
  );
}
