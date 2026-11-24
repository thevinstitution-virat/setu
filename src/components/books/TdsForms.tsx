"use client";

import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import Icon from "@/components/Icon";
import { errText, Field, readRupees, rupeeText, send } from "@/components/admin/AdminKit";
import { formatINR } from "@/lib/money";
import { rateLabel } from "@/lib/tds-math";

const todayIst = () => new Date(Date.now() + 5.5 * 3_600_000).toISOString().slice(0, 10);
const Err = ({ err }: { err: string | null }) => (err ? <p className="text-sm text-[#a8281e]">{err}</p> : null);
type Bank = { id: string; name: string; isDefault: boolean };
type Section = { code: string; name: string };

function SectionSelect({ value, onChange, sections }: { value: string; onChange: (v: string) => void; sections: Section[] }) {
  return (
    <select className="input" value={value} onChange={(e) => onChange(e.target.value)}>
      <option value="">Pick…</option>
      {sections.map((s) => (
        <option key={s.code} value={s.code}>
          {s.code} · {s.name}
        </option>
      ))}
    </select>
  );
}

// ───────────────────────────── what the app works out ─────────────────────────────

export type Proposal = { known: boolean; rate: number; tds: number; why: string; pan: string | null; before: number; deducted: number };

/** Ask the app what the TDS should be (debounced). */
export function useProposal(q: { section: string; base: number | null; date: string; basis: "BILL" | "PAYMENT"; supplierId?: string | null; pan?: string | null; party?: string | null; excludeId?: string | null }) {
  const [p, setP] = useState<Proposal | null>(null);
  const key = JSON.stringify(q);
  useEffect(() => {
    if (!q.section || !q.base || q.base <= 0) {
      setP(null);
      return;
    }
    const t = setTimeout(async () => {
      const sp = new URLSearchParams({ section: q.section, base: String(q.base), date: q.date, basis: q.basis });
      if (q.supplierId) sp.set("supplierId", q.supplierId);
      if (q.pan) sp.set("pan", q.pan);
      if (q.party) sp.set("party", q.party);
      if (q.excludeId) sp.set("excludeId", q.excludeId);
      try {
        const r = await fetch(`/api/admin/books/tds/propose?${sp}`);
        setP(r.ok ? ((await r.json()) as Proposal) : null);
      } catch {
        setP(null);
      }
    }, 350);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  return p;
}

/** The app's TDS, why, and a button to use it. */
export function TdsHint({ p, current, onUse }: { p: Proposal | null; current: number | null; onUse: (tds: number) => void }) {
  if (!p) return null;
  const same = current === p.tds || (!current && !p.tds);
  return (
    <div className={`text-xs rounded-lg px-3 py-2 ${same ? "bg-black/[0.03] text-[var(--ink-2)]" : "bg-[#fff4e0] text-[#7a4b00]"}`}>
      <span className="font-semibold">Works out to {formatINR(p.tds)}</span>
      {p.known && p.rate ? ` (${rateLabel(p.rate)})` : ""}: {p.why}.
      {p.known && (p.before > 0 || p.deducted > 0) && (
        <span className="block">
          This year before this: {formatINR(p.before)}, TDS kept {formatINR(p.deducted)}.
        </span>
      )}
      {!same && (
        <button type="button" className="ml-1 underline font-semibold" onClick={() => onUse(p.tds)}>
          Use {formatINR(p.tds)}
        </button>
      )}
      {!same && <span className="block mt-0.5">Keeping a different amount? Say why in the TDS note.</span>}
    </div>
  );
}

// ───────────────────────────── TDS on a bill ─────────────────────────────

export function BillTdsCard({
  billId,
  supplierId,
  date,
  taxable,
  total,
  open,
  defaultSection,
  existing,
  sections,
  canPost,
}: {
  billId: string;
  supplierId: string;
  date: string;
  taxable: number;
  total: number;
  open: number;
  defaultSection: string | null;
  existing: { id: string; number: string; date: string; section: string; base: number; tds: number; note: string | null } | null;
  sections: Section[];
  canPost: boolean;
}) {
  const router = useRouter();
  const [ask, setAsk] = useState(false);
  const [section, setSection] = useState(defaultSection ?? "");
  const [base, setBase] = useState(rupeeText(taxable));
  const [tds, setTds] = useState("");
  const [note, setNote] = useState("");
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const baseP = readRupees(base);
  const tdsP = readRupees(tds);
  const p = useProposal({ section, base: typeof baseP === "number" ? baseP : null, date, basis: "BILL", supplierId, excludeId: billId });
  useEffect(() => {
    if (p && tds === "") setTds(rupeeText(p.tds));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [p]);

  async function save() {
    setErr(null);
    if (typeof baseP !== "number" || typeof tdsP !== "number") return setErr("Enter the amounts in rupees");
    if (p && tdsP !== p.tds && !note.trim()) return setErr("The TDS differs from what the app works out: say why in the note");
    setBusy(true);
    try {
      await send("/api/admin/books/tds/bill", "POST", { purchaseBillId: billId, section, base: baseP, tds: tdsP, note });
      router.refresh();
      setAsk(false);
    } catch (e) {
      setErr(errText(e));
    } finally {
      setBusy(false);
    }
  }
  async function undo() {
    if (!existing) return;
    setBusy(true);
    setErr(null);
    try {
      await send(`/api/admin/books/tds/bill?${new URLSearchParams({ id: existing.id, reason })}`, "DELETE");
      router.refresh();
    } catch (e) {
      setErr(errText(e));
    } finally {
      setBusy(false);
    }
  }

  if (existing)
    return (
      <section className="card p-4 space-y-2">
        <h3 className="font-heading font-bold text-[var(--ink)]">TDS kept back</h3>
        <p className="text-sm text-[var(--ink-2)]">
          {formatINR(existing.tds)} under {existing.section} on {formatINR(existing.base)} ({existing.number}). The supplier is owed {formatINR(total - existing.tds)} for this bill.
          {existing.note ? ` Note: ${existing.note}.` : ""}
        </p>
        {canPost && (
          <div className="flex flex-wrap items-center gap-2">
            <input className="input !py-1.5 max-w-xs" placeholder="Why undo it" value={reason} maxLength={200} onChange={(e) => setReason(e.target.value)} />
            <button type="button" className="btn btn-quiet btn-sm" disabled={busy || reason.trim().length < 3} onClick={undo}>
              Undo the TDS
            </button>
          </div>
        )}
        <Err err={err} />
      </section>
    );
  if (!canPost) return null;
  if (!ask)
    return (
      <button type="button" className="btn btn-outline btn-sm" disabled={open <= 0} title={open <= 0 ? "The bill is paid" : undefined} onClick={() => setAsk(true)}>
        <Icon name="cash" className="h-4 w-4" /> Keep back TDS on this bill
      </button>
    );
  return (
    <section className="card p-4 space-y-3">
      <h3 className="font-heading font-bold text-[var(--ink)]">Keep back TDS on this bill</h3>
      <div className="grid gap-3 sm:grid-cols-3">
        <Field label="Section">
          <SectionSelect value={section} onChange={setSection} sections={sections} />
        </Field>
        <Field label="On (₹, usually before GST)">
          <input className="input text-right" inputMode="decimal" value={base} onChange={(e) => setBase(e.target.value)} />
        </Field>
        <Field label="TDS (₹)">
          <input className="input text-right" inputMode="decimal" value={tds} onChange={(e) => setTds(e.target.value)} />
        </Field>
      </div>
      <TdsHint p={p} current={typeof tdsP === "number" ? tdsP : null} onUse={(v) => setTds(rupeeText(v))} />
      <Field label="Note">
        <input className="input" value={note} maxLength={200} onChange={(e) => setNote(e.target.value)} />
      </Field>
      <Err err={err} />
      <div className="flex gap-2">
        <button type="button" className="btn btn-mor btn-sm" disabled={busy || !section} onClick={save}>
          {busy ? "Saving…" : "Keep it back"}
        </button>
        <button type="button" className="btn btn-quiet btn-sm" onClick={() => setAsk(false)}>
          Back
        </button>
      </div>
      <p className="text-xs text-[var(--muted)]">Posts Dr the supplier, Cr TDS payable. The bill&apos;s unpaid amount falls by the TDS.</p>
    </section>
  );
}

// ───────────────────────────── challans ─────────────────────────────

export function ChallanForm({ owing, sections, banks }: { owing: { period: string; label: string; section: string; unpaid: number; interestDue: number }[]; sections: Section[]; banks: Bank[] }) {
  const router = useRouter();
  const first = owing[0];
  const [pick, setPick] = useState(first ? `${first.period}|${first.section}` : "");
  const [section, setSection] = useState(first?.section ?? "");
  const [period, setPeriod] = useState(first?.period ?? todayIst().slice(0, 7));
  const [tax, setTax] = useState(first ? rupeeText(first.unpaid) : "");
  const [interest, setInterest] = useState(first?.interestDue ? rupeeText(first.interestDue) : "");
  const [lateFee, setLateFee] = useState("");
  const [paidOn, setPaidOn] = useState(todayIst());
  const [bank, setBank] = useState(banks.find((b) => b.isDefault)?.id ?? banks[0]?.id ?? "");
  const [bsr, setBsr] = useState("");
  const [serial, setSerial] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const total = useMemo(() => [tax, interest, lateFee].map(readRupees).reduce<number>((s, v) => s + (typeof v === "number" ? v : 0), 0), [tax, interest, lateFee]);

  function choose(v: string) {
    setPick(v);
    const o = owing.find((x) => `${x.period}|${x.section}` === v);
    if (o) {
      setSection(o.section);
      setPeriod(o.period);
      setTax(rupeeText(o.unpaid));
      setInterest(o.interestDue ? rupeeText(o.interestDue) : "");
    }
  }
  async function save() {
    setErr(null);
    setDone(null);
    const t = readRupees(tax);
    const i = readRupees(interest);
    const l = readRupees(lateFee);
    if (t === "bad" || i === "bad" || l === "bad") return setErr("Enter the amounts in rupees");
    setBusy(true);
    try {
      const r = await send<{ number: string }>("/api/admin/books/tds/challan", "POST", { section, period, tax: t ?? 0, interest: i ?? 0, lateFee: l ?? 0, bankAccountId: bank, paidOn, bsrCode: bsr, serial });
      setDone(`Saved as ${r.number}.`);
      setBsr("");
      setSerial("");
      router.refresh();
    } catch (e) {
      setErr(errText(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="space-y-3">
      {owing.length > 0 && (
        <Field label="For">
          <select className="input" value={pick} onChange={(e) => choose(e.target.value)}>
            {owing.map((o) => (
              <option key={`${o.period}|${o.section}`} value={`${o.period}|${o.section}`}>
                {o.label} · {o.section} · {formatINR(o.unpaid)} not paid
              </option>
            ))}
            <option value="">Another month or section</option>
          </select>
        </Field>
      )}
      <div className="grid gap-3 grid-cols-2 sm:grid-cols-4">
        <Field label="Section">
          <SectionSelect value={section} onChange={setSection} sections={sections} />
        </Field>
        <Field label="Month kept back">
          <input type="month" className="input" value={period} max={todayIst().slice(0, 7)} onChange={(e) => setPeriod(e.target.value)} />
        </Field>
        <Field label="TDS (₹)">
          <input className="input text-right" inputMode="decimal" value={tax} onChange={(e) => setTax(e.target.value)} />
        </Field>
        <Field label="Interest (₹)">
          <input className="input text-right" inputMode="decimal" value={interest} onChange={(e) => setInterest(e.target.value)} />
        </Field>
        <Field label="Late fee (₹)">
          <input className="input text-right" inputMode="decimal" value={lateFee} onChange={(e) => setLateFee(e.target.value)} />
        </Field>
        <Field label="Paid on">
          <input type="date" className="input" value={paidOn} max={todayIst()} onChange={(e) => setPaidOn(e.target.value)} />
        </Field>
        <Field label="BSR code">
          <input className="input" inputMode="numeric" maxLength={7} value={bsr} onChange={(e) => setBsr(e.target.value.replace(/\D/g, ""))} />
        </Field>
        <Field label="Challan serial">
          <input className="input" inputMode="numeric" maxLength={5} value={serial} onChange={(e) => setSerial(e.target.value.replace(/\D/g, ""))} />
        </Field>
      </div>
      <Field label="From bank">
        <select className="input" value={bank} onChange={(e) => setBank(e.target.value)}>
          {banks.map((b) => (
            <option key={b.id} value={b.id}>
              {b.name}
            </option>
          ))}
        </select>
      </Field>
      <Err err={err} />
      {done && <p className="text-sm text-[#1f6b4a]">{done}</p>}
      <button type="button" className="btn btn-mor btn-sm" disabled={busy || !section || !total} onClick={save}>
        <Icon name="check" className="h-4 w-4" /> {busy ? "Saving…" : `Save challan: ${formatINR(total)} paid`}
      </button>
      <p className="text-xs text-[var(--muted)]">Posts Dr TDS payable (and interest / late fee to &quot;Interest and late fees on taxes&quot;), Cr the bank.</p>
    </div>
  );
}

/** Cancel something with a reason: DELETE `url?id&reason`. */
export function CancelWithReason({ url, id, label, what }: { url: string; id: string; label: string; what: string }) {
  const router = useRouter();
  const [ask, setAsk] = useState(false);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  async function go() {
    setBusy(true);
    setErr(null);
    try {
      await send(`${url}?${new URLSearchParams({ id, reason })}`, "DELETE");
      router.refresh();
    } catch (e) {
      setErr(errText(e));
      setBusy(false);
    }
  }
  if (!ask)
    return (
      <button type="button" className="btn btn-quiet btn-xs" onClick={() => setAsk(true)}>
        {label}
      </button>
    );
  return (
    <span className="inline-flex flex-wrap items-center gap-1.5">
      <input className="input !py-1 !text-xs w-40" placeholder={`Why cancel ${what}`} value={reason} maxLength={200} onChange={(e) => setReason(e.target.value)} />
      <button type="button" className="btn btn-mor btn-xs" disabled={busy || reason.trim().length < 3} onClick={go}>
        Yes
      </button>
      <button type="button" className="btn btn-quiet btn-xs" onClick={() => setAsk(false)}>
        No
      </button>
      {err && <span className="text-xs text-[#a8281e]">{err}</span>}
    </span>
  );
}

// ───────────────────────────── TDS kept back from us ─────────────────────────────

export function ShopTdsForm({ shops }: { shops: { id: string; name: string }[] }) {
  const router = useRouter();
  const [shop, setShop] = useState("");
  const [amount, setAmount] = useState("");
  const [section, setSection] = useState("194Q");
  const [date, setDate] = useState(todayIst());
  const [certificate, setCertificate] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const picked = shops.find((s) => s.name.toLowerCase() === shop.trim().toLowerCase());
  async function save() {
    setErr(null);
    setDone(null);
    const a = readRupees(amount);
    if (!picked) return setErr("Pick the shop from the list");
    if (typeof a !== "number" || a <= 0) return setErr("Enter the TDS in rupees");
    setBusy(true);
    try {
      const r = await send<{ number: string }>("/api/admin/books/tds/shop", "POST", { retailerId: picked.id, amount: a, section, date, certificate });
      setDone(`Saved as ${r.number}: ${picked.name}'s bills are settled by ${formatINR(a)}.`);
      setShop("");
      setAmount("");
      setCertificate("");
      router.refresh();
    } catch (e) {
      setErr(errText(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="space-y-3">
      <div className="grid gap-3 grid-cols-2 sm:grid-cols-5">
        <Field label="Shop" className="col-span-2">
          <input className="input" list="tds-shops" value={shop} onChange={(e) => setShop(e.target.value)} placeholder="Type to find" />
          <datalist id="tds-shops">
            {shops.map((s) => (
              <option key={s.id} value={s.name} />
            ))}
          </datalist>
        </Field>
        <Field label="TDS (₹)">
          <input className="input text-right" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} />
        </Field>
        <Field label="Section">
          <input className="input" value={section} maxLength={10} onChange={(e) => setSection(e.target.value.toUpperCase())} />
        </Field>
        <Field label="Kept back on">
          <input type="date" className="input" value={date} max={todayIst()} onChange={(e) => setDate(e.target.value)} />
        </Field>
      </div>
      <Field label="Certificate (Form 16A) number, if it has come">
        <input className="input" value={certificate} maxLength={30} onChange={(e) => setCertificate(e.target.value)} />
      </Field>
      <Err err={err} />
      {done && <p className="text-sm text-[#1f6b4a]">{done}</p>}
      <button type="button" className="btn btn-mor btn-sm" disabled={busy} onClick={save}>
        {busy ? "Saving…" : "Save the shop's TDS"}
      </button>
      <p className="text-xs text-[var(--muted)]">Posts Dr TDS deducted by customers, Cr the shop: their bills are settled by the TDS, oldest first.</p>
    </div>
  );
}

export function CertificateEdit({ id, current }: { id: string; current: string | null }) {
  const router = useRouter();
  const [edit, setEdit] = useState(false);
  const [v, setV] = useState(current ?? "");
  const [busy, setBusy] = useState(false);
  async function save() {
    setBusy(true);
    try {
      await send("/api/admin/books/tds/shop", "PATCH", { id, certificate: v });
      setEdit(false);
      router.refresh();
    } finally {
      setBusy(false);
    }
  }
  if (!edit)
    return (
      <button type="button" className={`text-xs ${current ? "text-[var(--ink-2)]" : "text-[#7a4b00] font-semibold"} hover:underline`} onClick={() => setEdit(true)}>
        {current ? `Certificate ${current}` : "No certificate yet: add"}
      </button>
    );
  return (
    <span className="inline-flex items-center gap-1">
      <input className="input !py-1 !text-xs w-32" value={v} maxLength={30} onChange={(e) => setV(e.target.value)} />
      <button type="button" className="btn btn-mor btn-xs" disabled={busy} onClick={save}>
        Save
      </button>
    </span>
  );
}

// ───────────────────────────── sections ─────────────────────────────

type SectionFull = { id: string; code: string; name: string; rateInd: number; rateOther: number; rateNoPan: number; single: number | null; yearly: number | null; overOnly: boolean; active: boolean; note: string | null };

const pct = (bp: number) => String(bp / 100);
const readPct = (s: string) => {
  const n = Number(s.replace(/[%\s]/g, ""));
  return Number.isFinite(n) && n >= 0 && n <= 50 ? Math.round(n * 100) : null;
};

export function SectionEditor({ s }: { s: SectionFull | null }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [f, setF] = useState({
    code: s?.code ?? "",
    name: s?.name ?? "",
    ind: s ? pct(s.rateInd) : "",
    other: s ? pct(s.rateOther) : "",
    noPan: s ? pct(s.rateNoPan) : "20",
    single: rupeeText(s?.single),
    yearly: rupeeText(s?.yearly),
    overOnly: s?.overOnly ?? false,
    active: s?.active ?? true,
    note: s?.note ?? "",
  });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const set = (k: keyof typeof f, v: string | boolean) => setF((x) => ({ ...x, [k]: v }));
  async function save() {
    setErr(null);
    const ind = readPct(f.ind);
    const other = readPct(f.other || f.ind);
    const noPan = readPct(f.noPan);
    const single = readRupees(f.single);
    const yearly = readRupees(f.yearly);
    if (ind === null || other === null || noPan === null) return setErr("Rates must be 0 to 50 (per cent)");
    if (single === "bad" || yearly === "bad") return setErr("Limits must be in rupees");
    setBusy(true);
    try {
      await send("/api/admin/books/tds/sections", "POST", { id: s?.id ?? null, code: f.code, name: f.name, rateInd: ind, rateOther: other, rateNoPan: noPan, single, yearly, overOnly: f.overOnly, active: f.active, note: f.note });
      setOpen(false);
      router.refresh();
    } catch (e) {
      setErr(errText(e));
    } finally {
      setBusy(false);
    }
  }
  if (!open)
    return (
      <button type="button" className={s ? "btn btn-quiet btn-xs" : "btn btn-outline btn-sm"} onClick={() => setOpen(true)}>
        {s ? "Change" : "Add a section"}
      </button>
    );
  return (
    <div className="rounded-xl bg-black/[0.03] p-3 space-y-2 text-left">
      <div className="grid gap-2 grid-cols-2 sm:grid-cols-4">
        <Field label="Section">
          <input className="input" value={f.code} maxLength={10} onChange={(e) => set("code", e.target.value.toUpperCase())} />
        </Field>
        <Field label="For" className="col-span-2 sm:col-span-3">
          <input className="input" value={f.name} maxLength={80} onChange={(e) => set("name", e.target.value)} />
        </Field>
        <Field label="Rate, individual (%)">
          <input className="input text-right" inputMode="decimal" value={f.ind} onChange={(e) => set("ind", e.target.value)} />
        </Field>
        <Field label="Rate, others (%)">
          <input className="input text-right" inputMode="decimal" value={f.other} onChange={(e) => set("other", e.target.value)} />
        </Field>
        <Field label="Rate, no PAN (%)">
          <input className="input text-right" inputMode="decimal" value={f.noPan} onChange={(e) => set("noPan", e.target.value)} />
        </Field>
        <Field label="Limit at a time (₹)">
          <input className="input text-right" inputMode="decimal" value={f.single} onChange={(e) => set("single", e.target.value)} placeholder="none" />
        </Field>
        <Field label="Limit in a year (₹)">
          <input className="input text-right" inputMode="decimal" value={f.yearly} onChange={(e) => set("yearly", e.target.value)} placeholder="none" />
        </Field>
      </div>
      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" checked={f.overOnly} onChange={(e) => set("overOnly", e.target.checked)} /> Only the part of the year above the limit is taxed (like 194Q)
      </label>
      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" checked={f.active} onChange={(e) => set("active", e.target.checked)} /> In use
      </label>
      <Field label="Note">
        <input className="input" value={f.note} maxLength={300} onChange={(e) => set("note", e.target.value)} />
      </Field>
      <Err err={err} />
      <div className="flex gap-2">
        <button type="button" className="btn btn-mor btn-sm" disabled={busy} onClick={save}>
          {busy ? "Saving…" : "Save"}
        </button>
        <button type="button" className="btn btn-quiet btn-sm" onClick={() => setOpen(false)}>
          Back
        </button>
      </div>
    </div>
  );
}
