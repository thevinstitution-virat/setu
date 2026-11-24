import Link from "next/link";
import Icon from "@/components/Icon";
import { booksPage } from "@/lib/books-page";
import { ledgerHref } from "@/lib/books";
import { purchaseDetail } from "@/lib/purchases";
import { stateLabel } from "@/lib/gst";
import { formatINR } from "@/lib/money";
import { ErrorCard } from "@/components/reports/Kit";
import { showDay } from "@/components/books/fmt";
import CancelPurchase from "@/components/books/CancelPurchase";

/** One purchase bill or note: its lines, tax, what it is against and how much is settled. */
export default async function PurchaseDocPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const r = await booksPage((ctx) => purchaseDetail(ctx, id));
  if (!r.ok) return <ErrorCard message={r.error} />;
  const d = r.data;
  const tax = d.cgst + d.sgst + d.igst;
  const left = d.total - d.settledAmount;
  const live = !d.cancelledAt;

  return (
    <div className="space-y-4">
      <Link href="/admin/books/purchases" className="inline-flex items-center gap-1 text-sm font-bold text-[var(--ink-2)]">
        <Icon name="arrow" className="h-4 w-4 rotate-180" /> Purchases
      </Link>

      <section className="card p-4 sm:p-5 space-y-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="page-kick">{d.label}</p>
            <h2 className="font-heading text-2xl font-bold text-[var(--ink)] break-all">
              {d.number} {!live && <span className="chip !text-xs align-middle">Cancelled</span>}
            </h2>
            <p className="text-sm text-[var(--ink-2)] mt-1">
              Their {d.type === "BILL" ? "bill" : "reference"} {d.supplierRef} · {showDay(d.date)}
              {d.dueDate ? ` · due ${showDay(d.dueDate)}` : ""}
            </p>
          </div>
          <div className="text-right">
            <p className="text-2xl font-bold tabular-nums text-[var(--ink)]">{formatINR(d.total)}</p>
            {live && (
              <p className="text-xs text-[var(--muted)]">
                {d.type === "BILL" ? (left > 0 ? `${formatINR(left)} still to pay` : "Fully settled") : left > 0 ? `${formatINR(left)} not yet set against a bill` : "Fully set against bills"}
              </p>
            )}
          </div>
        </div>
        <dl className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4 text-sm">
          <Item label="Supplier">
            <Link href={`/admin/books/suppliers/${d.supplier.id}`} className="font-semibold text-[var(--kesar-text)]">
              {d.supplier.name}
            </Link>
            {d.supplier.gstin && <p className="text-xs text-[var(--muted)] break-all">GSTIN {d.supplier.gstin}</p>}
          </Item>
          <Item label="Place of supply">
            <p className="font-semibold">{stateLabel(d.stateCode) || "Not known"}</p>
            <p className="text-xs text-[var(--muted)]">{d.interState ? "Other state: IGST" : "Same state: CGST + SGST"}</p>
          </Item>
          <Item label="Goods">
            {d.purchase ? (
              <Link href={`/admin/stock/purchases/${d.purchase.id}`} className="font-semibold text-[var(--kesar-text)]">
                {d.movedStock ? "Received with this bill" : "For"} {d.purchase.number}
              </Link>
            ) : (
              <p className="font-semibold">{d.movedStock ? "Taken out of stock" : "Not moved in stock"}</p>
            )}
          </Item>
          <Item label={d.type === "BILL" ? "Notes against it" : "Against bill"}>
            {d.type === "BILL" ? (
              d.notes.length ? (
                d.notes.map((n) => (
                  <Link key={n.id} href={`/admin/books/purchases/${n.id}`} className={`block font-semibold text-[var(--kesar-text)] ${n.cancelledAt ? "line-through opacity-60" : ""}`}>
                    {n.number} · {formatINR(n.total)}
                  </Link>
                ))
              ) : (
                <p className="text-[var(--muted)]">None</p>
              )
            ) : d.against ? (
              <Link href={`/admin/books/purchases/${d.against.id}`} className="font-semibold text-[var(--kesar-text)]">
                {d.against.supplierRef} ({d.against.number})
              </Link>
            ) : (
              <p className="text-[var(--muted)]">Oldest bills first</p>
            )}
          </Item>
        </dl>
        {(d.reason || d.note) && <p className="rounded-xl bg-black/[0.04] px-3 py-2 text-sm text-[var(--ink-2)]">{[d.reason, d.note].filter(Boolean).join(" · ")}</p>}
        {d.cancelledAt && <p className="rounded-xl bg-[#fdecea] px-3 py-2 text-sm text-[#a8281e]">Cancelled: {d.cancelReason}</p>}
        <div className="flex flex-wrap gap-2">
          {d.entryId && (
            <Link className="btn btn-outline btn-xs" href={`${ledgerHref(`PAYABLE:${d.supplier.id}`)}&from=${d.date}`}>
              Supplier&apos;s ledger
            </Link>
          )}
          {live && d.type === "BILL" && r.me.canPurchase && (
            <Link className="btn btn-outline btn-xs" href={`/admin/books/purchases/new?type=DEBIT_NOTE&supplier=${d.supplier.id}&against=${d.id}`}>
              Debit note against it
            </Link>
          )}
          {live && r.me.canPurchase && <CancelPurchase id={d.id} label={d.label.toLowerCase()} />}
        </div>
      </section>

      <section className="card p-0 overflow-x-auto">
        <table className="w-full text-sm" style={{ minWidth: 760 }}>
          <thead>
            <tr className="text-xs text-[var(--muted)] border-b border-[var(--line)]">
              <th className="px-4 py-2 text-left font-semibold">Item</th>
              <th className="px-4 py-2 text-right font-semibold">Qty</th>
              <th className="px-4 py-2 text-right font-semibold">Rate</th>
              <th className="px-4 py-2 text-right font-semibold">Disc</th>
              <th className="px-4 py-2 text-right font-semibold">Taxable</th>
              <th className="px-4 py-2 text-right font-semibold">GST</th>
              <th className="px-4 py-2 text-right font-semibold">Total</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-[var(--line)]">
            {d.lines.map((l) => (
              <tr key={l.id}>
                <td className="px-4 py-2">
                  <span className="font-medium text-[var(--ink)]">{l.description}</span>
                  {l.claimId && (
                    <Link href={`/admin/books/claims/${l.claimId}`} className="block text-xs font-semibold text-[var(--kesar-text)]">
                      Settles our claim
                    </Link>
                  )}
                  <span className="block text-xs text-[var(--muted)]">
                    {[l.target === "HEAD" ? "Expense / asset" : l.target === "CLAIM" ? "Scheme or claim" : null, l.hsnCode ? `HSN ${l.hsnCode}` : null, l.batch ? `Batch ${l.batch}` : null, l.itc ? null : "No input credit"].filter(Boolean).join(" · ")}
                  </span>
                </td>
                <td className="px-4 py-2 text-right tabular-nums whitespace-nowrap">
                  {l.quantity}
                  {l.freeQty ? ` + ${l.freeQty} free` : ""}
                </td>
                <td className="px-4 py-2 text-right tabular-nums">{formatINR(l.rate)}</td>
                <td className="px-4 py-2 text-right tabular-nums">{l.discountPct ? `${l.discountPct}%` : ""}</td>
                <td className="px-4 py-2 text-right tabular-nums">{formatINR(l.taxable)}</td>
                <td className="px-4 py-2 text-right tabular-nums whitespace-nowrap">
                  {formatINR(l.cgst + l.sgst + l.igst)} <span className="text-xs text-[var(--muted)]">{l.gstRate}%</span>
                </td>
                <td className="px-4 py-2 text-right tabular-nums font-semibold">{formatINR(l.total)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <dl className="grid gap-1 text-sm tabular-nums max-w-xs ml-auto p-4">
          <Sum label="Taxable value" value={d.taxable} />
          {d.interState ? <Sum label="IGST" value={d.igst} /> : (
            <>
              <Sum label="CGST" value={d.cgst} />
              <Sum label="SGST" value={d.sgst} />
            </>
          )}
          {d.reverseCharge && <Sum label="Less: reverse charge GST (we pay)" value={-tax} />}
          {d.roundOff !== 0 && <Sum label="Round-off" value={d.roundOff} />}
          <div className="flex justify-between border-t border-[var(--line)] pt-1.5 font-bold text-[var(--ink)]">
            <dt>Total</dt>
            <dd>{formatINR(d.total)}</dd>
          </div>
          <p className="text-xs text-[var(--muted)] text-right">Input tax we can claim: {formatINR(d.itcTax)}</p>
        </dl>
      </section>
    </div>
  );
}

function Item({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="min-w-0">
      <dt className="text-xs text-[var(--muted)]">{label}</dt>
      <dd className="mt-0.5">{children}</dd>
    </div>
  );
}

function Sum({ label, value }: { label: string; value: number }) {
  return (
    <div className="flex justify-between">
      <dt className="text-[var(--muted)]">{label}</dt>
      <dd>{value < 0 ? `−${formatINR(-value)}` : formatINR(value)}</dd>
    </div>
  );
}
