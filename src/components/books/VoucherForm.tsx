"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import Icon from "@/components/Icon";
import { errText, Field, readRupees, send, Thumb, uploadImage } from "@/components/admin/AdminKit";
import { formatINR } from "@/lib/money";
import { TdsHint, useProposal } from "@/components/books/TdsForms";
import { VOUCHER_METHOD_LABEL, VOUCHER_TYPE_HINT, VOUCHER_TYPE_LABEL, VOUCHER_TYPES, type VoucherMethod, type VoucherType } from "@/lib/voucher-labels";

export type VoucherOptions = {
  heads: { code: string; name: string; groupLabel: string }[];
  cash: { code: string; name: string }[];
  banks: { id: string; code: string; name: string; isDefault: boolean }[];
  staff: { id: string; name: string; code: string; held: number }[];
  journal: { code: string; name: string; groupLabel: string }[];
  tdsSections: { code: string; label: string }[];
};

type Line = { code: string; amount: string; credit: string; note: string };
const blank = (): Line => ({ code: "", amount: "", credit: "", note: "" });
const todayIst = () => new Date(Date.now() + 5.5 * 3_600_000).toISOString().slice(0, 10);
const chip = (on: boolean) => `rounded-full px-3.5 py-1.5 text-sm font-semibold ${on ? "bg-ink text-white" : "bg-black/5 text-foreground/70"}`;
const paise = (s: string) => {
  const v = readRupees(s);
  return typeof v === "number" ? v : 0;
};

/** A select of accounts grouped the way the chart of accounts groups them. */
function AccountSelect({
  value,
  onChange,
  options,
  placeholder,
}: {
  value: string;
  onChange: (v: string) => void;
  options: { code: string; name: string; groupLabel: string }[];
  placeholder: string;
}) {
  const groups = [...new Set(options.map((o) => o.groupLabel))];
  return (
    <select className="input" value={value} onChange={(e) => onChange(e.target.value)}>
      <option value="">{placeholder}</option>
      {groups.map((g) => (
        <optgroup key={g} label={g}>
          {options
            .filter((o) => o.groupLabel === g)
            .map((o) => (
              <option key={o.code} value={o.code}>
                {o.name}
              </option>
            ))}
        </optgroup>
      ))}
    </select>
  );
}

/**
 * Enter a voucher. Payment and receipt: what it was for (one or more heads),
 * how the money moved, and optional GST bill and TDS. Contra: from and to.
 * Journal: debit and credit lines that must balance, with a reason.
 */
export default function VoucherForm({ options: o, initialType }: { options: VoucherOptions; initialType: VoucherType }) {
  const router = useRouter();
  const [type, setType] = useState<VoucherType>(initialType);
  const [date, setDate] = useState(todayIst());
  const [method, setMethod] = useState<VoucherMethod>("CASH");
  const [cashCode, setCashCode] = useState("OFFICE_CASH");
  const [bankId, setBankId] = useState(o.banks[0]?.id ?? "");
  const [staffId, setStaffId] = useState("");
  const [chequeNo, setChequeNo] = useState("");
  const [chequeDate, setChequeDate] = useState("");
  const [lines, setLines] = useState<Line[]>([blank()]);
  const [jlines, setJlines] = useState<Line[]>([blank(), blank()]);
  const [party, setParty] = useState("");
  const [gstOn, setGstOn] = useState(false);
  const [gstin, setGstin] = useState("");
  const [gst, setGst] = useState("");
  const [tds, setTds] = useState("");
  const [section, setSection] = useState("");
  const [partyPan, setPartyPan] = useState("");
  const [tdsNote, setTdsNote] = useState("");
  const [fromCode, setFromCode] = useState("OFFICE_CASH");
  const [toCode, setToCode] = useState(o.banks[0]?.code ?? "");
  const [amount, setAmount] = useState("");
  const [reference, setReference] = useState("");
  const [narration, setNarration] = useState("");
  const [photos, setPhotos] = useState<string[]>([]);
  const [uploading, setUploading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const pay = type === "PAYMENT";
  const money = type === "PAYMENT" || type === "RECEIPT";
  const methods: VoucherMethod[] = pay ? ["CASH", "BANK", "CHEQUE", "STAFF"] : ["CASH", "BANK"];
  const headSum = lines.reduce((a, l) => a + paise(l.amount), 0);
  const gstP = pay && gstOn ? paise(gst) : 0;
  const tdsP = paise(tds);
  const moved = money ? headSum + gstP - tdsP : type === "CONTRA" ? paise(amount) : 0;
  const tdsOn = pay && (tdsP > 0 || !!section.trim());
  const panFromGstin = gstOn && /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z]/.test(gstin) ? gstin.slice(2, 12) : "";
  const proposal = useProposal({ section: tdsOn ? section.trim() : "", base: headSum || null, date, basis: "PAYMENT", pan: partyPan.trim() || panFromGstin || null, party: party.trim() || null });
  const tdsDiffers = !!proposal && proposal.known && proposal.tds !== tdsP;
  const jDebit = jlines.reduce((a, l) => a + paise(l.amount), 0);
  const jCredit = jlines.reduce((a, l) => a + paise(l.credit), 0);
  const staff = o.staff.find((s) => s.id === staffId) ?? null;
  const contraFrom = [
    ...o.cash.map((c) => ({ ...c, groupLabel: "Cash" })),
    ...o.banks.map((b) => ({ code: b.code, name: b.name, groupLabel: "Bank accounts" })),
    ...o.staff.filter((s) => s.held > 0).map((s) => ({ code: s.code, name: `${s.name} (holds ${formatINR(s.held)})`, groupLabel: "Collected cash with staff" })),
  ];
  const contraTo = contraFrom.filter((a) => a.groupLabel !== "Collected cash with staff");
  const cashOpts = o.cash.length > 1;

  const setLine = (i: number, patch: Partial<Line>, j = false) => (j ? setJlines : setLines)((ls) => ls.map((l, k) => (k === i ? { ...l, ...patch } : l)));
  const dropLine = (i: number, j = false) => (j ? setJlines : setLines)((ls) => (ls.length > (j ? 2 : 1) ? ls.filter((_, k) => k !== i) : ls));

  async function addPhotos(files: FileList | null) {
    if (!files?.length) return;
    setUploading(true);
    setErr(null);
    try {
      const keys: string[] = [];
      for (const f of [...files].slice(0, 6 - photos.length)) keys.push(await uploadImage(f, "voucher-slip"));
      setPhotos((p) => [...p, ...keys].slice(0, 6));
    } catch (e) {
      setErr(errText(e));
    } finally {
      setUploading(false);
    }
  }

  function body() {
    const base = { type, date, reference, narration, photos };
    if (type === "CONTRA") {
      const a = readRupees(amount);
      if (a === "bad" || !a) throw new Error("Enter the amount moved in rupees");
      return { ...base, fromCode, toCode, amount: a };
    }
    if (type === "JOURNAL") {
      const out = [];
      for (const l of jlines) {
        if (!l.code && !l.amount && !l.credit) continue;
        const d = readRupees(l.amount);
        const c = readRupees(l.credit);
        if (d === "bad" || c === "bad") throw new Error("Write amounts in rupees");
        if ((d ?? 0) && (c ?? 0)) throw new Error("A line is a debit or a credit, not both");
        out.push({ code: l.code, amount: (d ?? 0) - (c ?? 0), note: l.note });
      }
      return { ...base, lines: out };
    }
    const out = [];
    for (const l of lines) {
      if (!l.code && !l.amount) continue;
      const a = readRupees(l.amount);
      if (a === "bad" || !a) throw new Error("Enter each line's amount in rupees");
      out.push({ code: l.code, amount: a, note: l.note });
    }
    const g = readRupees(gst);
    const t = readRupees(tds);
    if ((gstOn && g === "bad") || t === "bad") throw new Error("Write GST and TDS in rupees");
    if (pay && tdsDiffers && !tdsNote.trim()) throw new Error("Say why the TDS is different from what the app works out");
    return {
      ...base,
      method,
      cashCode: method === "CASH" ? cashCode : null,
      bankAccountId: method === "BANK" || method === "CHEQUE" ? bankId : null,
      staffUserId: method === "STAFF" ? staffId : null,
      cheque: method === "CHEQUE" ? { number: chequeNo, date: chequeDate || date } : null,
      lines: out,
      party,
      partyGstin: pay && gstOn ? gstin : null,
      gst: pay && gstOn ? (g ?? 0) : 0,
      tds: t ?? 0,
      tdsSection: t ? section : null,
      partyPan: pay && tdsOn && partyPan.trim() ? partyPan.trim() : null,
      tdsNote: pay && tdsDiffers ? tdsNote.trim() : null,
    };
  }

  async function save() {
    setErr(null);
    let b;
    try {
      b = body();
    } catch (e) {
      return setErr(errText(e));
    }
    setBusy(true);
    try {
      const r = await send<{ voucher: { id: string } }>("/api/admin/books/vouchers", "POST", b);
      router.push(`/admin/books/vouchers/${r.voucher.id}`);
      router.refresh();
    } catch (e) {
      setErr(errText(e));
      setBusy(false);
    }
  }

  const total = type === "JOURNAL" ? jDebit : moved;
  const ready = type === "JOURNAL" ? jDebit > 0 && jDebit === jCredit && narration.trim().length >= 3 : moved > 0;

  return (
    <div className="space-y-4">
      <Link href="/admin/books/vouchers" className="inline-flex items-center gap-1 text-sm font-bold text-[var(--ink-2)]">
        <Icon name="arrow" className="h-4 w-4 rotate-180" /> Vouchers
      </Link>

      <section className="card p-4 sm:p-5 space-y-4">
        <h2 className="font-heading text-xl font-bold text-[var(--ink)]">{VOUCHER_TYPE_LABEL[type]}</h2>
        <div className="flex flex-wrap gap-2" role="radiogroup" aria-label="Kind of voucher">
          {VOUCHER_TYPES.map((t) => (
            <button
              key={t}
              type="button"
              role="radio"
              aria-checked={type === t}
              className={chip(type === t)}
              onClick={() => {
                setType(t);
                if (t === "RECEIPT" && (method === "CHEQUE" || method === "STAFF")) setMethod("CASH");
              }}
            >
              {t === "PAYMENT" ? "Payment" : t === "RECEIPT" ? "Receipt" : t === "CONTRA" ? "Contra" : "Journal"}
            </button>
          ))}
        </div>
        <p className="text-sm text-[var(--muted)] -mt-2">{VOUCHER_TYPE_HINT[type]}</p>

        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Date">
            <input type="date" className="input" value={date} max={todayIst()} onChange={(e) => setDate(e.target.value)} />
          </Field>
          {money && (
            <Field label={pay ? "Paid to (optional)" : "Received from (optional)"}>
              <input className="input" value={party} maxLength={100} onChange={(e) => setParty(e.target.value)} placeholder={pay ? "e.g. Sharma Properties" : "e.g. Owner"} />
            </Field>
          )}
        </div>

        {money && (
          <>
            <div className="space-y-2">
              <p className="text-sm font-medium text-[var(--ink-2)]">{pay ? "Paid from" : "Received into"}</p>
              <div className="flex flex-wrap gap-2" role="radiogroup" aria-label={pay ? "Paid from" : "Received into"}>
                {methods.map((m) => (
                  <button key={m} type="button" role="radio" aria-checked={method === m} className={chip(method === m)} onClick={() => setMethod(m)}>
                    {m === "STAFF" ? "Staff's collected cash" : VOUCHER_METHOD_LABEL[m]}
                  </button>
                ))}
              </div>
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              {method === "CASH" && cashOpts && (
                <Field label="Which cash">
                  <select className="input" value={cashCode} onChange={(e) => setCashCode(e.target.value)}>
                    {o.cash.map((c) => (
                      <option key={c.code} value={c.code}>
                        {c.name}
                      </option>
                    ))}
                  </select>
                </Field>
              )}
              {(method === "BANK" || method === "CHEQUE") &&
                (o.banks.length ? (
                  <Field label="Bank account">
                    <select className="input" value={bankId} onChange={(e) => setBankId(e.target.value)}>
                      {o.banks.map((b) => (
                        <option key={b.id} value={b.id}>
                          {b.name}
                        </option>
                      ))}
                    </select>
                  </Field>
                ) : (
                  <p className="text-sm text-[#a8281e]">
                    Add a bank account first:{" "}
                    <Link href="/admin/books/banks" className="underline">
                      Bank accounts
                    </Link>
                  </p>
                ))}
              {method === "BANK" && (
                <Field label="UTR / reference (optional)">
                  <input className="input" value={reference} maxLength={60} onChange={(e) => setReference(e.target.value)} />
                </Field>
              )}
              {method === "CHEQUE" && (
                <>
                  <Field label="Cheque number">
                    <input className="input" inputMode="numeric" value={chequeNo} maxLength={20} onChange={(e) => setChequeNo(e.target.value)} />
                  </Field>
                  <Field label="Cheque date" hint="Blank = the voucher date">
                    <input type="date" className="input" value={chequeDate} onChange={(e) => setChequeDate(e.target.value)} />
                  </Field>
                </>
              )}
              {method === "STAFF" && (
                <Field label="Who paid it" hint={staff ? `Holds ${formatINR(staff.held)} of collected cash` : "It comes off the cash they hold"}>
                  <select className="input" value={staffId} onChange={(e) => setStaffId(e.target.value)}>
                    <option value="">Choose</option>
                    {o.staff.map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.name} · {formatINR(s.held)}
                      </option>
                    ))}
                  </select>
                </Field>
              )}
              {method !== "BANK" && (
                <Field label="Bill / slip number (optional)">
                  <input className="input" value={reference} maxLength={60} onChange={(e) => setReference(e.target.value)} />
                </Field>
              )}
            </div>
          </>
        )}

        {type === "CONTRA" && (
          <div className="grid gap-3 sm:grid-cols-3">
            <Field label="From">
              <AccountSelect value={fromCode} onChange={setFromCode} options={contraFrom} placeholder="Choose" />
            </Field>
            <Field label="To">
              <AccountSelect value={toCode} onChange={setToCode} options={contraTo} placeholder="Choose" />
            </Field>
            <Field label="Amount (₹)">
              <input className="input" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} />
            </Field>
            <Field label="Reference (optional)" className="sm:col-span-3">
              <input className="input" value={reference} maxLength={60} onChange={(e) => setReference(e.target.value)} placeholder="Deposit slip, UTR, cheque number" />
            </Field>
          </div>
        )}
      </section>

      {money && (
        <section className="card p-4 sm:p-5 space-y-3">
          <h3 className="font-heading font-bold text-[var(--ink)]">{pay ? "What it was for" : "What the money is"}</h3>
          {lines.map((l, i) => (
            <div key={i} className="grid gap-2 sm:grid-cols-[1.4fr_8rem_1fr_auto] items-end border-b border-[var(--line)] pb-3 last:border-0 last:pb-0">
              <Field label={i === 0 ? "Head" : `Head ${i + 1}`}>
                <AccountSelect value={l.code} onChange={(v) => setLine(i, { code: v })} options={o.heads} placeholder="Choose a head" />
              </Field>
              <Field label="Amount (₹)">
                <input className="input" inputMode="decimal" value={l.amount} onChange={(e) => setLine(i, { amount: e.target.value })} />
              </Field>
              <Field label="Note (optional)">
                <input className="input" value={l.note} maxLength={120} onChange={(e) => setLine(i, { note: e.target.value })} />
              </Field>
              {lines.length > 1 ? (
                <button type="button" className="btn btn-quiet btn-xs mb-1" aria-label="Remove line" onClick={() => dropLine(i)}>
                  <Icon name="x" className="h-3.5 w-3.5" />
                </button>
              ) : (
                <span />
              )}
            </div>
          ))}
          <button type="button" className="btn btn-outline btn-xs" onClick={() => setLines((ls) => [...ls, blank()])}>
            <Icon name="plus" className="h-3.5 w-3.5" /> Another head
          </button>
          <p className="text-xs text-[var(--muted)]">
            Missing a head?{" "}
            <Link href="/admin/books" className="underline">
              Add it under Accounts
            </Link>
            .
          </p>

          <div className="grid gap-3 sm:grid-cols-3 pt-2 border-t border-[var(--line)]">
            {pay && (
              <label className="flex items-center gap-2 text-sm sm:col-span-3 pt-2">
                <input type="checkbox" className="h-4 w-4" checked={gstOn} onChange={(e) => setGstOn(e.target.checked)} />
                GST bill: claim the GST as input credit
              </label>
            )}
            {pay && gstOn && (
              <>
                <Field label="Seller's GSTIN">
                  <input className="input uppercase" value={gstin} maxLength={15} onChange={(e) => setGstin(e.target.value.toUpperCase())} />
                </Field>
                <Field label="GST on the bill (₹)" hint="Added to the amount paid">
                  <input className="input" inputMode="decimal" value={gst} onChange={(e) => setGst(e.target.value)} />
                </Field>
              </>
            )}
            <Field label={pay ? "TDS kept back (₹)" : "TDS deducted by them (₹)"} hint="Optional">
              <input className="input" inputMode="decimal" value={tds} onChange={(e) => setTds(e.target.value)} />
            </Field>
            {(tdsP > 0 || pay) && (
              <Field label="TDS section">
                <input className="input uppercase" list="voucher-tds" value={section} maxLength={12} onChange={(e) => setSection(e.target.value.toUpperCase())} />
                <datalist id="voucher-tds">
                  {o.tdsSections.map((t) => (
                    <option key={t.code} value={t.code}>
                      {t.label}
                    </option>
                  ))}
                </datalist>
              </Field>
            )}
            {tdsOn && (
              <Field label="Their PAN" hint={panFromGstin ? `From the GSTIN: ${panFromGstin}` : "Needed for the TDS return; without it TDS is at the higher rate"}>
                <input className="input uppercase" value={partyPan} maxLength={10} placeholder={panFromGstin} onChange={(e) => setPartyPan(e.target.value.toUpperCase())} />
              </Field>
            )}
            {pay && (
              <div className="sm:col-span-3 space-y-3">
                <TdsHint p={proposal} current={tdsP} onUse={(v) => setTds(v ? String(v / 100) : "")} />
                {tdsDiffers && (
                  <Field label="Why is the TDS different?" hint="Kept with the voucher, for the CA">
                    <input className="input" value={tdsNote} maxLength={300} onChange={(e) => setTdsNote(e.target.value)} />
                  </Field>
                )}
              </div>
            )}
          </div>
        </section>
      )}

      {type === "JOURNAL" && (
        <section className="card p-4 sm:p-5 space-y-3">
          <h3 className="font-heading font-bold text-[var(--ink)]">Lines</h3>
          {jlines.map((l, i) => (
            <div key={i} className="grid gap-2 grid-cols-2 sm:grid-cols-[1.5fr_7rem_7rem_1fr_auto] items-end border-b border-[var(--line)] pb-3 last:border-0 last:pb-0">
              <Field label="Account" className="col-span-2 sm:col-span-1">
                <AccountSelect value={l.code} onChange={(v) => setLine(i, { code: v }, true)} options={o.journal} placeholder="Choose an account" />
              </Field>
              <Field label="Debit (₹)">
                <input className="input" inputMode="decimal" value={l.amount} onChange={(e) => setLine(i, { amount: e.target.value, credit: e.target.value ? "" : l.credit }, true)} />
              </Field>
              <Field label="Credit (₹)">
                <input className="input" inputMode="decimal" value={l.credit} onChange={(e) => setLine(i, { credit: e.target.value, amount: e.target.value ? "" : l.amount }, true)} />
              </Field>
              <Field label="Note (optional)" className="col-span-2 sm:col-span-1">
                <input className="input" value={l.note} maxLength={120} onChange={(e) => setLine(i, { note: e.target.value }, true)} />
              </Field>
              {jlines.length > 2 ? (
                <button type="button" className="btn btn-quiet btn-xs mb-1" aria-label="Remove line" onClick={() => dropLine(i, true)}>
                  <Icon name="x" className="h-3.5 w-3.5" />
                </button>
              ) : (
                <span className="hidden sm:block" />
              )}
            </div>
          ))}
          <button type="button" className="btn btn-outline btn-xs" onClick={() => setJlines((ls) => [...ls, blank()])}>
            <Icon name="plus" className="h-3.5 w-3.5" /> Another line
          </button>
          <dl className="text-sm tabular-nums grid grid-cols-3 gap-2 max-w-md">
            <div>
              <dt className="text-xs text-[var(--muted)]">Debits</dt>
              <dd className="font-semibold">{formatINR(jDebit)}</dd>
            </div>
            <div>
              <dt className="text-xs text-[var(--muted)]">Credits</dt>
              <dd className="font-semibold">{formatINR(jCredit)}</dd>
            </div>
            <div>
              <dt className="text-xs text-[var(--muted)]">Difference</dt>
              <dd className={`font-semibold ${jDebit === jCredit ? "text-[var(--mint-text)]" : "text-[#a8281e]"}`}>{formatINR(Math.abs(jDebit - jCredit))}</dd>
            </div>
          </dl>
          <p className="text-xs text-[var(--muted)]">Shops, suppliers, claims, sales, purchases and GST output are kept by their own bills and payments, so they are not offered here.</p>
        </section>
      )}

      <section className="card p-4 sm:p-5 space-y-3">
        <Field
          label={type === "JOURNAL" ? "Reason" : "Narration (optional)"}
          hint={type === "JOURNAL" ? "Say why: depreciation for the year, provision for audit fee, correcting an entry…" : undefined}
        >
          <input className="input" value={narration} maxLength={300} onChange={(e) => setNarration(e.target.value)} />
        </Field>
        <div className="space-y-2">
          <p className="text-sm font-medium text-[var(--ink-2)]">Photos of the bill or slip (optional)</p>
          <div className="flex flex-wrap items-center gap-2">
            {photos.map((k) => (
              <span key={k} className="relative">
                <Thumb imageKey={k} className="h-16 w-16" alt="Slip" />
                <button
                  type="button"
                  aria-label="Remove photo"
                  className="absolute -top-1.5 -right-1.5 h-6 w-6 rounded-full bg-ink text-white grid place-items-center"
                  onClick={() => setPhotos((p) => p.filter((x) => x !== k))}
                >
                  <Icon name="x" className="h-3 w-3" />
                </button>
              </span>
            ))}
            {photos.length < 6 && (
              <label className="btn btn-outline btn-xs cursor-pointer">
                <Icon name="image" className="h-3.5 w-3.5" /> {uploading ? "Uploading…" : "Add photo"}
                <input type="file" accept="image/*" capture="environment" multiple className="sr-only" disabled={uploading} onChange={(e) => addPhotos(e.target.files)} />
              </label>
            )}
          </div>
        </div>
        {money && moved > 0 && (gstP > 0 || tdsP > 0) && (
          <dl className="text-sm space-y-1 tabular-nums max-w-sm">
            <div className="flex justify-between">
              <dt className="text-[var(--muted)]">Heads</dt>
              <dd>{formatINR(headSum)}</dd>
            </div>
            {gstP > 0 && (
              <div className="flex justify-between">
                <dt className="text-[var(--muted)]">GST input credit</dt>
                <dd>+ {formatINR(gstP)}</dd>
              </div>
            )}
            {tdsP > 0 && (
              <div className="flex justify-between">
                <dt className="text-[var(--muted)]">{pay ? "TDS kept back" : "TDS deducted by them"}</dt>
                <dd>− {formatINR(tdsP)}</dd>
              </div>
            )}
          </dl>
        )}
        {err && <p className="text-sm text-[#a8281e]">{err}</p>}
      </section>

      <div className="sticky bottom-[5.5rem] md:bottom-3 z-10">
        <div className="card p-3 shadow-xl flex items-center justify-between gap-3">
          <div className="min-w-0">
            <p className="font-heading font-bold text-lg leading-tight tabular-nums">{formatINR(total)}</p>
            <p className="text-xs text-[var(--muted)] truncate">
              {money ? `${pay ? "Paid" : "Received"} · ${VOUCHER_METHOD_LABEL[method]}` : type === "CONTRA" ? "Moved" : jDebit === jCredit ? "Balanced" : "Not balanced yet"}
            </p>
          </div>
          <button type="button" className="btn btn-mor shrink-0" disabled={busy || uploading || !ready} onClick={save}>
            <Icon name="check" className="h-4 w-4" /> {busy ? "Saving…" : "Save voucher"}
          </button>
        </div>
      </div>
    </div>
  );
}
