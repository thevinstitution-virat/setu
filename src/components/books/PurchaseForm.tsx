"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import Icon from "@/components/Icon";
import { errText, ErrorBox, Field, readRupees, SearchPick, send, useFetch } from "@/components/admin/AdminKit";
import { DOC_LABEL, purchaseLineMoney, type PurchaseDocType } from "@/lib/purchase-math";
import { STATES } from "@/lib/gst";
import { formatINR } from "@/lib/money";
import { showDay } from "@/components/books/fmt";

type Options = {
  stateCode: string | null;
  suppliers: { id: string; name: string; kind: string; gstin: string | null; stateCode: string | null; creditDays: number }[];
  products: { id: string; name: string; sku: string; hsnCode: string | null; gstRate: number; lastCost: number | null; trackExpiry: boolean; supplierId: string | null; unit: string }[];
  heads: { id: string; name: string; group: string }[];
  stockOn: boolean;
  grns: { id: string; number: string; supplierId: string; billNo: string | null; billDate: string | null; createdAt: string; lines: { id: string; productId: string; quantity: number; unitCost: number | null; batch: string; expiry: string | null }[] }[];
  gstRates: number[];
};

type SupplierDocs = { docs: { id: string; type: PurchaseDocType; number: string; supplierRef: string; date: string; total: number; cancelled: boolean }[] };

type LineForm = {
  key: number;
  target: "GOODS" | "HEAD" | "CLAIM";
  productId: string | null;
  headId: string;
  description: string;
  quantity: string;
  freeQty: string;
  rate: string;
  discountPct: string;
  gstRate: string;
  itc: boolean;
  batch: string;
  expiry: string;
  purchaseLineId: string | null;
};

const GROUP_LABEL: Record<string, string> = { DIRECT_EXPENSES: "Direct expenses", INDIRECT_EXPENSES: "Indirect expenses", FIXED_ASSETS: "Fixed assets", CURRENT_ASSETS: "Current assets" };
const todayIst = () => new Date(Date.now() + 5.5 * 3_600_000).toISOString().slice(0, 10);
let seq = 1;
const blankLine = (target: LineForm["target"] = "GOODS"): LineForm => ({ key: seq++, target, productId: null, headId: "", description: "", quantity: "1", freeQty: "", rate: "", discountPct: "", gstRate: target === "CLAIM" ? "0" : "18", itc: true, batch: "", expiry: "", purchaseLineId: null });
const int = (s: string) => (s.trim() === "" ? 0 : Number(s));
const rupees = (p: number) => (p / 100).toFixed(2);

/**
 * Enter a supplier's bill, a debit note to them or their credit note to us.
 * The figures are worked out here the same way the server works them, so
 * the total can be checked against the printed bill before saving.
 */
export default function PurchaseForm({ initial }: { initial: { type: PurchaseDocType; grn: string | null; supplier: string | null; against: string | null } }) {
  const router = useRouter();
  const { data: o, error, reload } = useFetch<Options>("/api/admin/books/purchase-options");
  const [type, setType] = useState<PurchaseDocType>(initial.type);
  const [supplierId, setSupplierId] = useState<string | null>(initial.supplier);
  const [grnId, setGrnId] = useState<string | null>(null);
  const [supplierRef, setSupplierRef] = useState("");
  const [date, setDate] = useState(todayIst());
  const [dueDate, setDueDate] = useState("");
  const [stateCode, setStateCode] = useState("");
  const [reverseCharge, setReverseCharge] = useState(false);
  const [inclusive, setInclusive] = useState(false);
  const [againstId, setAgainstId] = useState<string>(initial.against ?? "");
  const [moveStock, setMoveStock] = useState(false);
  const [reason, setReason] = useState("");
  const [note, setNote] = useState("");
  const [billTotal, setBillTotal] = useState("");
  const [lines, setLines] = useState<LineForm[]>([blankLine(initial.type === "CREDIT_NOTE" ? "CLAIM" : "GOODS")]);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const supplier = o?.suppliers.find((s) => s.id === supplierId) ?? null;
  const { data: sdocs } = useFetch<SupplierDocs>(supplierId && type !== "BILL" ? `/api/admin/books/suppliers/${supplierId}` : null);
  const bills = (sdocs?.docs ?? []).filter((d) => d.type === "BILL" && !d.cancelled);

  // A goods received note from the link (?grn=): its supplier and lines.
  useEffect(() => {
    if (!o || !initial.grn || grnId) return;
    const g = o.grns.find((x) => x.id === initial.grn);
    if (g) pickGrn(g.id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [o]);

  function pickGrn(id: string | null) {
    setGrnId(id);
    const g = o?.grns.find((x) => x.id === id);
    if (!g || !o) return;
    setSupplierId(g.supplierId);
    if (g.billNo) setSupplierRef(g.billNo);
    if (g.billDate) setDate(g.billDate);
    setMoveStock(false);
    setLines(
      g.lines.map((l) => {
        const p = o.products.find((x) => x.id === l.productId);
        return { ...blankLine("GOODS"), productId: l.productId, description: p?.name ?? "", quantity: String(l.quantity), rate: l.unitCost ? rupees(l.unitCost) : p?.lastCost ? rupees(p.lastCost) : "", gstRate: String(p?.gstRate ?? 0), batch: l.batch, expiry: l.expiry ?? "", purchaseLineId: l.id };
      })
    );
  }

  const tenantState = o?.stateCode ?? null;
  const placeOfSupply = stateCode || supplier?.stateCode || (supplier?.gstin ? supplier.gstin.slice(0, 2) : "") || tenantState || "";
  const interState = !!placeOfSupply && !!tenantState && placeOfSupply !== tenantState;

  const figures = useMemo(() => {
    const rows = lines.map((l) => {
      const rate = readRupees(l.rate);
      const q = int(l.quantity);
      const d = l.discountPct.trim() === "" ? 0 : Number(l.discountPct);
      const g = Number(l.gstRate);
      if (rate === "bad" || rate === null || !Number.isInteger(q) || q < 1 || !(d >= 0 && d <= 100)) return null;
      return purchaseLineMoney(rate, q, d, g, inclusive, interState);
    });
    const ok = rows.filter((r): r is NonNullable<typeof r> => !!r);
    const taxable = ok.reduce((a, r) => a + r.taxable, 0);
    const tax = ok.reduce((a, r) => a + r.tax, 0);
    const itc = lines.reduce((a, l, i) => a + (l.itc && rows[i] ? rows[i]!.tax : 0), 0);
    const before = taxable + (reverseCharge ? 0 : tax);
    const printed = readRupees(billTotal);
    const roundOff = typeof printed === "number" ? printed - before : Math.round(before / 100) * 100 - before;
    return { rows, taxable, tax, itc, before, roundOff, total: before + roundOff, printedOff: typeof printed === "number" && Math.abs(printed - before) > 100 };
  }, [lines, inclusive, interState, reverseCharge, billTotal]);

  const setLine = (key: number, patch: Partial<LineForm>) => setLines((ls) => ls.map((l) => (l.key === key ? { ...l, ...patch } : l)));

  function pickProduct(key: number, id: string | null) {
    const p = o?.products.find((x) => x.id === id);
    setLine(key, { productId: id, description: p?.name ?? "", gstRate: p ? String(p.gstRate) : "18", rate: p?.lastCost ? rupees(p.lastCost) : "" });
  }

  async function save() {
    setErr(null);
    if (!supplierId) return setErr("Pick the supplier");
    const body = {
      type,
      supplierId,
      supplierRef,
      date,
      dueDate: type === "BILL" && dueDate ? dueDate : null,
      stateCode: stateCode || null,
      reverseCharge: type === "BILL" ? reverseCharge : false,
      ratesIncludeGst: inclusive,
      againstId: type !== "BILL" && againstId ? againstId : null,
      purchaseId: type === "BILL" ? grnId : null,
      moveStock: type !== "CREDIT_NOTE" && !grnId ? moveStock : false,
      reason: reason || null,
      note: note || null,
      billTotal: (() => {
        const p = readRupees(billTotal);
        return typeof p === "number" ? p : null;
      })(),
      lines: [] as Record<string, unknown>[],
    };
    for (const [i, l] of lines.entries()) {
      const rate = readRupees(l.rate);
      if (rate === "bad" || rate === null) return setErr(`Line ${i + 1}: enter the rate in rupees`);
      body.lines.push({
        target: l.target,
        productId: l.target === "GOODS" ? l.productId : null,
        headId: l.target === "HEAD" ? l.headId || null : null,
        description: l.description,
        quantity: int(l.quantity),
        freeQty: l.target === "GOODS" ? int(l.freeQty) : 0,
        rate,
        discountPct: l.discountPct.trim() === "" ? 0 : Number(l.discountPct),
        gstRate: Number(l.gstRate),
        itc: l.itc,
        batch: l.batch || null,
        expiry: l.expiry || null,
        purchaseLineId: l.purchaseLineId,
      });
    }
    setBusy(true);
    try {
      const r = await send<{ doc: { id: string } }>("/api/admin/books/purchases", "POST", body);
      router.push(`/admin/books/purchases/${r.doc.id}`);
      router.refresh();
    } catch (e) {
      setErr(errText(e));
      setBusy(false);
    }
  }

  if (!o) return error ? <ErrorBox message={error} onRetry={reload} /> : <p className="text-sm text-[var(--muted)]">Loading…</p>;

  const supplierGrns = o.grns.filter((g) => !supplierId || g.supplierId === supplierId);
  const canMove = o.stockOn && !grnId && type !== "CREDIT_NOTE";
  const productOptions = o.products.map((p) => ({ id: p.id, label: p.name, sub: `${p.sku} · GST ${p.gstRate}%${p.lastCost ? ` · last cost ${formatINR(p.lastCost)}` : ""}` }));

  return (
    <div className="space-y-4">
      <Link href="/admin/books/purchases" className="inline-flex items-center gap-1 text-sm font-bold text-[var(--ink-2)]">
        <Icon name="arrow" className="h-4 w-4 rotate-180" /> Purchases
      </Link>

      <div className="flex flex-wrap gap-1.5" role="tablist" aria-label="Document">
        {(["BILL", "DEBIT_NOTE", "CREDIT_NOTE"] as PurchaseDocType[]).map((t) => (
          <button
            key={t}
            type="button"
            role="tab"
            aria-selected={type === t}
            className={`rounded-full px-3.5 py-1.5 text-sm font-semibold ${type === t ? "bg-ink text-white" : "bg-black/5 text-foreground/70"}`}
            onClick={() => {
              setType(t);
              setGrnId(null);
              setAgainstId("");
              if (t === "CREDIT_NOTE") setMoveStock(false);
            }}
          >
            {DOC_LABEL[t]}
          </button>
        ))}
      </div>

      <section className="card p-4 space-y-4">
        <div className="grid gap-4 md:grid-cols-2">
          <Field label="Supplier" hint={supplier ? `${supplier.gstin ? `GSTIN ${supplier.gstin} · ` : ""}${supplier.creditDays} days' credit` : <Link href="/admin/books/suppliers" className="text-[var(--kesar-text)]">Add a supplier</Link>}>
            <SearchPick
              options={o.suppliers.map((s) => ({ id: s.id, label: s.name, sub: [s.kind === "GOODS" ? "Company" : s.kind === "SERVICES" ? "Services" : "Other", s.gstin].filter(Boolean).join(" · ") }))}
              value={supplierId}
              onChange={(id) => {
                setSupplierId(id);
                setGrnId(null);
                setAgainstId("");
              }}
              placeholder="Search suppliers"
            />
          </Field>
          {type === "BILL" && supplierGrns.length > 0 && (
            <Field label="For goods already received" hint="The bill corrects those goods' cost. Leave blank for a bill on its own.">
              <select className="input" value={grnId ?? ""} onChange={(e) => (e.target.value ? pickGrn(e.target.value) : setGrnId(null))}>
                <option value="">Not for a goods received note</option>
                {supplierGrns.map((g) => (
                  <option key={g.id} value={g.id}>
                    {g.number}
                    {g.billNo ? ` · bill ${g.billNo}` : ""} · {showDay(g.createdAt.slice(0, 10))}
                  </option>
                ))}
              </select>
            </Field>
          )}
          {type !== "BILL" && (
            <Field label="Against their bill" hint="The note is set against this bill first.">
              <select className="input" value={againstId} onChange={(e) => setAgainstId(e.target.value)} disabled={!supplierId}>
                <option value="">Not against one bill (oldest first)</option>
                {bills.map((b) => (
                  <option key={b.id} value={b.id}>
                    {b.supplierRef} · {showDay(b.date)} · {formatINR(b.total)}
                  </option>
                ))}
              </select>
            </Field>
          )}
        </div>
        <div className="grid gap-4 grid-cols-2 md:grid-cols-4">
          <Field label={type === "BILL" ? "Their bill number" : type === "CREDIT_NOTE" ? "Their note number" : "Their reference (optional)"}>
            <input className="input" value={supplierRef} maxLength={40} onChange={(e) => setSupplierRef(e.target.value)} />
          </Field>
          <Field label={type === "BILL" ? "Bill date" : "Note date"}>
            <input type="date" className="input" value={date} max={todayIst()} onChange={(e) => setDate(e.target.value)} />
          </Field>
          {type === "BILL" && (
            <Field label="Due date" hint={supplier ? `Blank: ${supplier.creditDays} days after the bill` : "Blank: the supplier's credit days"}>
              <input type="date" className="input" value={dueDate} min={date} onChange={(e) => setDueDate(e.target.value)} />
            </Field>
          )}
          <Field label="Place of supply" hint={interState ? "Other state: IGST" : "Same state: CGST + SGST"}>
            <select className="input" value={stateCode} onChange={(e) => setStateCode(e.target.value)}>
              <option value="">{placeOfSupply ? `${placeOfSupply}-${STATES[placeOfSupply] ?? ""} (supplier's)` : "Supplier's state"}</option>
              {Object.entries(STATES).map(([c, n]) => (
                <option key={c} value={c}>
                  {c}-{n}
                </option>
              ))}
            </select>
          </Field>
        </div>
        <div className="flex flex-wrap gap-x-5 gap-y-2 text-sm text-[var(--ink-2)]">
          <label className="flex items-center gap-2">
            <input type="checkbox" checked={inclusive} onChange={(e) => setInclusive(e.target.checked)} /> Rates include GST
          </label>
          {type === "BILL" && (
            <label className="flex items-center gap-2">
              <input type="checkbox" checked={reverseCharge} onChange={(e) => setReverseCharge(e.target.checked)} /> Reverse charge (we pay the GST)
            </label>
          )}
          {canMove && (
            <label className="flex items-center gap-2">
              <input type="checkbox" checked={moveStock} onChange={(e) => setMoveStock(e.target.checked)} /> {type === "BILL" ? "Bring these goods into stock now" : "Take these goods out of stock (sent back)"}
            </label>
          )}
        </div>
      </section>

      <section className="space-y-3">
        {lines.map((l, i) => {
          const m = figures.rows[i];
          const product = o.products.find((p) => p.id === l.productId);
          return (
            <div key={l.key} className="card p-4 space-y-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex gap-1.5">
                  {(["GOODS", "HEAD", ...(type === "CREDIT_NOTE" ? ["CLAIM"] : [])] as LineForm["target"][]).map((t) => (
                    <button
                      key={t}
                      type="button"
                      disabled={!!l.purchaseLineId}
                      className={`rounded-full px-3 py-1 text-xs font-semibold ${l.target === t ? "bg-ink text-white" : "bg-black/5 text-foreground/70"}`}
                      onClick={() => setLine(l.key, { ...blankLine(t), key: l.key })}
                    >
                      {t === "GOODS" ? "Goods" : t === "HEAD" ? "Expense / asset" : "Scheme or claim"}
                    </button>
                  ))}
                </div>
                <div className="flex items-center gap-3">
                  <span className="text-sm font-bold tabular-nums">{m ? formatINR(m.total) : "–"}</span>
                  {lines.length > 1 && !l.purchaseLineId && (
                    <button type="button" className="btn btn-quiet btn-xs" aria-label={`Remove line ${i + 1}`} onClick={() => setLines((ls) => ls.filter((x) => x.key !== l.key))}>
                      <Icon name="x" className="h-3.5 w-3.5" />
                    </button>
                  )}
                </div>
              </div>
              <div className="grid gap-3 md:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
                {l.target === "GOODS" ? (
                  l.purchaseLineId ? (
                    <Field label="Product">
                      <p className="input bg-black/[0.03]">{product?.name ?? l.description}</p>
                    </Field>
                  ) : (
                    <Field label="Product">
                      <SearchPick options={productOptions} value={l.productId} onChange={(id) => pickProduct(l.key, id)} placeholder="Search products" />
                    </Field>
                  )
                ) : l.target === "HEAD" ? (
                  <Field label="Charge to" hint={<Link href="/admin/books" className="text-[var(--kesar-text)]">Add a head</Link>}>
                    <select className="input" value={l.headId} onChange={(e) => setLine(l.key, { headId: e.target.value })}>
                      <option value="">Pick an account head</option>
                      {Object.keys(GROUP_LABEL).map((g) => (
                        <optgroup key={g} label={GROUP_LABEL[g]}>
                          {o.heads
                            .filter((h) => h.group === g)
                            .map((h) => (
                              <option key={h.id} value={h.id}>
                                {h.name}
                              </option>
                            ))}
                        </optgroup>
                      ))}
                    </select>
                  </Field>
                ) : (
                  <Field label="What it is for" hint="Goes to claims income.">
                    <input className="input" value={l.description} maxLength={120} placeholder="Like Diwali scheme, rate difference, damages" onChange={(e) => setLine(l.key, { description: e.target.value })} />
                  </Field>
                )}
                {l.target !== "CLAIM" && (
                  <Field label="Description (optional)">
                    <input className="input" value={l.description} maxLength={120} onChange={(e) => setLine(l.key, { description: e.target.value })} />
                  </Field>
                )}
              </div>
              <div className="grid gap-3 grid-cols-2 sm:grid-cols-3 lg:grid-cols-6">
                <Field label="Qty">
                  <input className="input" inputMode="numeric" value={l.quantity} onChange={(e) => setLine(l.key, { quantity: e.target.value.replace(/\D/g, "") })} />
                </Field>
                {l.target === "GOODS" && (
                  <Field label="Free">
                    <input className="input" inputMode="numeric" value={l.freeQty} disabled={!!l.purchaseLineId} onChange={(e) => setLine(l.key, { freeQty: e.target.value.replace(/\D/g, "") })} />
                  </Field>
                )}
                <Field label={`Rate (₹)${inclusive ? " with GST" : ""}`}>
                  <input className="input" inputMode="decimal" value={l.rate} onChange={(e) => setLine(l.key, { rate: e.target.value })} />
                </Field>
                <Field label="Discount %">
                  <input className="input" inputMode="decimal" value={l.discountPct} onChange={(e) => setLine(l.key, { discountPct: e.target.value })} />
                </Field>
                <Field label="GST %">
                  <select className="input" value={l.gstRate} onChange={(e) => setLine(l.key, { gstRate: e.target.value })}>
                    {o.gstRates.map((g) => (
                      <option key={g} value={String(g)}>
                        {g}%
                      </option>
                    ))}
                  </select>
                </Field>
                <Field label="Input credit">
                  <label className="flex items-center gap-2 text-sm py-2">
                    <input type="checkbox" checked={l.itc} onChange={(e) => setLine(l.key, { itc: e.target.checked })} /> Can claim
                  </label>
                </Field>
              </div>
              {l.target === "GOODS" && moveStock && type === "BILL" && (
                <div className="grid gap-3 grid-cols-2 sm:grid-cols-3">
                  <Field label="Batch">
                    <input className="input" value={l.batch} maxLength={40} onChange={(e) => setLine(l.key, { batch: e.target.value })} />
                  </Field>
                  <Field label={product?.trackExpiry ? "Expiry (needed)" : "Expiry"}>
                    <input type="date" className="input" value={l.expiry} onChange={(e) => setLine(l.key, { expiry: e.target.value })} />
                  </Field>
                </div>
              )}
              {m && (
                <p className="text-xs text-[var(--muted)] tabular-nums">
                  Taxable {formatINR(m.taxable)}
                  {m.discount ? ` after ${formatINR(m.discount)} discount` : ""} · {interState ? `IGST ${formatINR(m.igst)}` : `CGST ${formatINR(m.cgst)} + SGST ${formatINR(m.sgst)}`}
                  {!l.itc && m.tax ? " · tax added to the cost" : ""}
                </p>
              )}
            </div>
          );
        })}
        {!grnId && (
          <button type="button" className="btn btn-outline btn-sm" onClick={() => setLines((ls) => [...ls, blankLine(lines[lines.length - 1]?.target ?? "GOODS")])}>
            <Icon name="plus" className="h-4 w-4" /> Add a line
          </button>
        )}
      </section>

      <section className="card p-4 space-y-4">
        <div className="grid gap-4 md:grid-cols-2">
          {type !== "BILL" && (
            <Field label="Reason">
              <input className="input" value={reason} maxLength={200} placeholder={type === "DEBIT_NOTE" ? "Like damaged goods sent back, short supply" : "Like scheme for October, rate difference"} onChange={(e) => setReason(e.target.value)} />
            </Field>
          )}
          <Field label="Note (optional)">
            <input className="input" value={note} maxLength={300} onChange={(e) => setNote(e.target.value)} />
          </Field>
          <Field label="Total printed on their document (₹)" hint="Optional. Up to ₹1 difference is taken as rounding.">
            <input className="input" inputMode="decimal" value={billTotal} onChange={(e) => setBillTotal(e.target.value)} />
          </Field>
        </div>
        <dl className="grid gap-1 text-sm tabular-nums max-w-sm ml-auto">
          <Row label="Taxable value" value={figures.taxable} />
          <Row label={interState ? "IGST" : "CGST + SGST"} value={figures.tax} />
          {reverseCharge && <Row label="Less: GST we pay under reverse charge" value={-figures.tax} />}
          <Row label="Round-off" value={figures.roundOff} />
          <div className="flex justify-between border-t border-[var(--line)] pt-1.5 font-bold text-[var(--ink)]">
            <dt>{type === "BILL" ? "We owe them" : "They owe us less"}</dt>
            <dd>{formatINR(figures.total)}</dd>
          </div>
          {figures.itc > 0 && <p className="text-xs text-[var(--muted)] text-right">Input tax we can claim: {formatINR(figures.itc)}</p>}
        </dl>
        {figures.printedOff && <p className="text-sm text-[#a8281e]">The lines add up to {formatINR(figures.before)}, more than ₹1 away from the printed total. Check the lines.</p>}
        {err && <p className="text-sm text-[#a8281e]">{err}</p>}
      </section>

      <div className="sticky bottom-[5.5rem] md:bottom-3 z-10">
        <div className="card p-3 shadow-xl flex items-center justify-between gap-3">
          <div className="min-w-0">
            <p className="font-heading font-bold text-lg leading-tight tabular-nums">{formatINR(figures.total)}</p>
            <p className="text-xs text-[var(--muted)] truncate">{DOC_LABEL[type]}</p>
          </div>
          <button type="button" className="btn btn-mor shrink-0" disabled={busy || !supplierId} onClick={save}>
            <Icon name="check" className="h-4 w-4" /> {busy ? "Saving…" : "Save"}
          </button>
        </div>
      </div>
    </div>
  );
}

function Row({ label, value }: { label: string; value: number }) {
  return (
    <div className="flex justify-between">
      <dt className="text-[var(--muted)]">{label}</dt>
      <dd>{value < 0 ? `−${formatINR(-value)}` : formatINR(value)}</dd>
    </div>
  );
}
