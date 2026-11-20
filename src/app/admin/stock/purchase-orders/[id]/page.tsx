"use client";

import { use, useState } from "react";
import Link from "next/link";
import Icon from "@/components/Icon";
import StockNav from "@/components/stock/StockNav";
import { formatINR } from "@/lib/money";
import { ErrorBox, errText, send, shortDate, useFetch } from "@/components/admin/AdminKit";

type PoStatus = "DRAFT" | "SENT" | "PARTLY_RECEIVED" | "RECEIVED" | "CANCELLED";

type PoLine = {
  id: string;
  productId: string;
  quantity: number;
  unitCost: number | null;
  receivedQty: number;
  product: { name: string; sku: string; unit: string; caseUnit: string | null; caseSize: number | null; hsnCode: string | null };
};

type Po = {
  id: string;
  number: string;
  status: PoStatus;
  expectedDate: string | null;
  note: string | null;
  createdAt: string;
  sentAt: string | null;
  supplier: { id: string; name: string; contactName: string | null; phone: string | null; email: string | null; gstin: string | null; address: string | null };
  lines: PoLine[];
  receipts: { id: string; number: string; createdAt: string; billNo: string | null; total: number }[];
};

type Business = { name: string; legalName: string | null; gstin: string | null; address: string | null; phone: string | null };

const STATUS: Record<PoStatus, { label: string; chip: string; help: string }> = {
  DRAFT: { label: "Draft", chip: "chip", help: "Not sent to the supplier yet. You can still change it." },
  SENT: { label: "Sent", chip: "chip chip-kesar", help: "Waiting for the goods." },
  PARTLY_RECEIVED: { label: "Part received", chip: "chip chip-genda", help: "Some goods have come in. The rest is still on order." },
  RECEIVED: { label: "Received", chip: "chip chip-mint", help: "All goods have come in." },
  CANCELLED: { label: "Cancelled", chip: "chip st-cancelled", help: "Nothing more is expected on this order." },
};

/** Print only the purchase order document: hide the app shell and the screen view. */
const PRINT_CSS = `@media print {
  header, nav { display: none !important; }
  body { background: #fff !important; }
  main { padding: 0 !important; max-width: none !important; }
  @page { margin: 12mm; }
}`;

/** @db.Date ISO → "20 Nov 2026". */
const dayText = (iso: string | null) =>
  iso ? new Date(`${iso.slice(0, 10)}T00:00:00.000Z`).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" }) : "";

/** "120 pcs (10 cases)" when the quantity is whole cases. */
function qtyText(qty: number, p: PoLine["product"]) {
  const base = `${qty} ${p.unit}`;
  if (p.caseSize && p.caseSize > 1 && qty > 0 && qty % p.caseSize === 0) return `${base} (${qty / p.caseSize} ${p.caseUnit ?? "case"})`;
  return base;
}

export default function PurchaseOrderPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const { data, error, reload } = useFetch<{ po: Po; business: Business }>(`/api/purchase-orders/${id}`);
  const [flash, setFlash] = useState<string | null>(null);

  const say = (msg: string) => {
    setFlash(msg);
    setTimeout(() => setFlash(null), 5000);
  };

  if (!data) {
    return (
      <div className="space-y-4">
        <BackLink />
        {error ? <ErrorBox message={error} onRetry={reload} /> : <p className="text-sm text-[var(--muted)]">Loading…</p>}
      </div>
    );
  }

  const { po, business } = data;
  const value = po.lines.reduce((a, l) => a + l.quantity * (l.unitCost ?? 0), 0);
  const units = po.lines.reduce((a, l) => a + l.quantity, 0);
  const received = po.lines.reduce((a, l) => a + Math.min(l.receivedQty, l.quantity), 0);

  return (
    <>
      <style>{PRINT_CSS}</style>
      <div className="space-y-5 pb-28 print:hidden">
        <div className="space-y-3">
          <BackLink />
          <StockNav />
        </div>

        <div className="card p-4 sm:p-5 space-y-4">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="page-kick">Purchase order</p>
              <h1 className="page-title break-all">{po.number}</h1>
              <p className="text-sm text-[var(--ink-2)] mt-1">{STATUS[po.status].help}</p>
            </div>
            <span className={STATUS[po.status].chip}>{STATUS[po.status].label}</span>
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <div className="flex items-start gap-3 min-w-0">
              <span className="icon-tile bg-[var(--kesar-tint)] text-[var(--kesar-text)]">
                <Icon name="truck" />
              </span>
              <div className="min-w-0">
                <p className="text-xs text-[var(--muted)]">Supplier</p>
                <p className="text-sm font-semibold break-words">{po.supplier.name}</p>
                {(po.supplier.contactName || po.supplier.phone) && (
                  <p className="text-sm text-[var(--ink-2)] break-words">
                    {po.supplier.contactName}
                    {po.supplier.contactName && po.supplier.phone ? " · " : ""}
                    {po.supplier.phone && (
                      <a href={`tel:${po.supplier.phone}`} className="font-semibold text-[var(--kesar-text)]">
                        {po.supplier.phone}
                      </a>
                    )}
                  </p>
                )}
              </div>
            </div>
            <div className="flex items-start gap-3 min-w-0">
              <span className="icon-tile bg-[var(--mint-tint)] text-[var(--mint-text)]">
                <Icon name="clock" />
              </span>
              <div className="min-w-0 text-sm">
                <p className="text-xs text-[var(--muted)]">Dates</p>
                <p>Made {shortDate(po.createdAt)}</p>
                {po.sentAt && <p className="text-[var(--ink-2)]">Sent {shortDate(po.sentAt)}</p>}
                {po.expectedDate && <p className="text-[var(--ink-2)]">Expected {dayText(po.expectedDate)}</p>}
              </div>
            </div>
          </div>
          {po.note && <p className="rounded-xl bg-ink/5 px-3 py-2 text-sm text-[var(--ink-2)]">{po.note}</p>}

          <div className="grid grid-cols-3 gap-2 text-center">
            <Tile label="Value" value={value ? formatINR(value, { whole: true }) : "—"} />
            <Tile label="Ordered" value={String(units)} />
            <Tile label="Received" value={String(received)} tone={received >= units && units > 0 ? "text-[var(--mint-text)]" : ""} />
          </div>
        </div>

        {flash && (
          <p className="card p-3 text-sm font-semibold text-[var(--mint-text)] bg-[var(--mint-tint)]" role="status">
            <Icon name="check" className="inline h-4 w-4 mr-1" />
            {flash}
          </p>
        )}

        <Actions po={po} business={business} onDone={(msg) => {
            reload();
            say(msg);
          }} onCopied={say} />

        <Lines po={po} value={value} />

        <Receipts po={po} />
      </div>

      <PrintDoc po={po} business={business} value={value} />
    </>
  );
}

function BackLink() {
  return (
    <Link href="/admin/stock/purchase-orders" className="inline-flex items-center gap-1 text-sm font-bold text-[var(--ink-2)]">
      <Icon name="arrow" className="h-4 w-4 rotate-180" /> Purchase orders
    </Link>
  );
}

function Tile({ label, value, tone = "" }: { label: string; value: string; tone?: string }) {
  return (
    <div className="rounded-xl bg-ink/5 py-2.5 px-1 min-w-0">
      <p className={`font-heading font-bold text-lg leading-none truncate ${tone}`}>{value}</p>
      <p className="text-[11px] text-[var(--muted)] mt-1 leading-tight">{label}</p>
    </div>
  );
}

// ───────────────────────────── actions ─────────────────────────────

function Actions({ po, business, onDone, onCopied }: { po: Po; business: Business; onDone: (msg: string) => void; onCopied: (msg: string) => void }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmCancel, setConfirmCancel] = useState(false);
  const open = po.status === "DRAFT" || po.status === "SENT" || po.status === "PARTLY_RECEIVED";
  const receiving = po.status === "SENT" || po.status === "PARTLY_RECEIVED";

  async function setStatus(status: "SENT" | "CANCELLED") {
    setBusy(true);
    setError(null);
    try {
      await send(`/api/purchase-orders/${po.id}`, "PATCH", { status });
      setConfirmCancel(false);
      onDone(status === "SENT" ? "Marked sent. Copy it for WhatsApp or print it for the supplier." : "Purchase order cancelled.");
    } catch (e) {
      setError(errText(e));
    } finally {
      setBusy(false);
    }
  }

  async function copy() {
    setError(null);
    const text = whatsappText(po, business);
    try {
      await navigator.clipboard.writeText(text);
      onCopied("Copied. Paste it in WhatsApp.");
    } catch {
      // Older browsers / no permission: fall back to a hidden text box.
      const ta = document.createElement("textarea");
      ta.value = text;
      ta.setAttribute("readonly", "");
      ta.style.position = "fixed";
      ta.style.opacity = "0";
      document.body.appendChild(ta);
      ta.select();
      const ok = document.execCommand("copy");
      ta.remove();
      if (ok) onCopied("Copied. Paste it in WhatsApp.");
      else setError("Could not copy. Use Print instead.");
    }
  }

  return (
    <section className="card p-4 space-y-3">
      <div className="flex flex-wrap gap-2">
        {open && (
          <Link href={`/admin/stock/receive?poId=${po.id}`} className={`btn btn-sm !min-h-[44px] ${receiving ? "btn-kesar" : "btn-outline"}`}>
            <Icon name="download" className="h-4 w-4" /> Receive goods
          </Link>
        )}
        {po.status === "DRAFT" && (
          <>
            <button type="button" className="btn btn-kesar btn-sm !min-h-[44px]" disabled={busy} onClick={() => setStatus("SENT")}>
              <Icon name="check" className="h-4 w-4" /> {busy ? "Saving…" : "Mark sent"}
            </button>
            <Link href={`/admin/stock/purchase-orders?edit=${po.id}`} className="btn btn-quiet btn-sm !min-h-[44px]">
              <Icon name="edit" className="h-4 w-4" /> Edit
            </Link>
          </>
        )}
        <button type="button" className="btn btn-quiet btn-sm !min-h-[44px]" onClick={() => window.print()}>
          <Icon name="file" className="h-4 w-4" /> Print
        </button>
        <button type="button" className="btn btn-quiet btn-sm !min-h-[44px]" onClick={copy}>
          <Icon name="share" className="h-4 w-4" /> Copy for WhatsApp
        </button>
        {open && !confirmCancel && (
          <button type="button" className="btn btn-quiet btn-sm !min-h-[44px] text-[#a8281e]" disabled={busy} onClick={() => setConfirmCancel(true)}>
            <Icon name="x" className="h-4 w-4" /> Cancel order
          </button>
        )}
      </div>
      {confirmCancel && (
        <div className="rounded-2xl bg-[#fde4e1] p-3 space-y-2">
          <p className="text-sm text-[#a8281e] font-semibold">Cancel {po.number}?</p>
          <p className="text-xs text-[var(--ink-2)]">
            {po.status === "PARTLY_RECEIVED"
              ? "Goods already received stay in stock. The rest is no longer expected."
              : "Nothing more is expected from the supplier on this order. This can't be undone."}
          </p>
          <div className="flex flex-wrap gap-2">
            <button type="button" className="btn btn-danger btn-sm !min-h-[44px]" disabled={busy} onClick={() => setStatus("CANCELLED")}>
              {busy ? "Cancelling…" : "Cancel order"}
            </button>
            <button type="button" className="btn btn-quiet btn-sm !min-h-[44px]" disabled={busy} onClick={() => setConfirmCancel(false)}>
              Keep it
            </button>
          </div>
        </div>
      )}
      {error && <p className="text-sm text-[#a8281e]">{error}</p>}
    </section>
  );
}

function whatsappText(po: Po, business: Business) {
  const out: string[] = [];
  out.push(`*Purchase order ${po.number}*`);
  out.push(`From: ${business.legalName || business.name}${business.gstin ? ` (GSTIN ${business.gstin})` : ""}`);
  out.push(`To: ${po.supplier.name}`);
  out.push(`Date: ${shortDate(po.createdAt)}`);
  if (po.expectedDate) out.push(`Needed by: ${dayText(po.expectedDate)}`);
  out.push("");
  po.lines.forEach((l, i) => {
    const rate = l.unitCost !== null ? ` @ ${formatINR(l.unitCost)} = ${formatINR(l.quantity * l.unitCost)}` : "";
    out.push(`${i + 1}. ${l.product.name}${l.product.sku ? ` (${l.product.sku})` : ""}: ${qtyText(l.quantity, l.product)}${rate}`);
  });
  const value = po.lines.reduce((a, l) => a + l.quantity * (l.unitCost ?? 0), 0);
  if (value) {
    out.push("");
    out.push(`*Total: ${formatINR(value)}* (before GST)`);
  }
  if (po.note) {
    out.push("");
    out.push(`Note: ${po.note}`);
  }
  if (business.phone) {
    out.push("");
    out.push(`Questions: ${business.phone}`);
  }
  return out.join("\n");
}

// ───────────────────────────── lines ─────────────────────────────

function Lines({ po, value }: { po: Po; value: number }) {
  const showReceived = po.status !== "DRAFT";
  return (
    <section className="card overflow-hidden">
      <div className="px-4 py-3.5 border-b border-[var(--line)]">
        <h2 className="font-heading font-bold">Products</h2>
      </div>
      <div className="hidden md:grid grid-cols-[minmax(0,2fr)_6.5rem_6.5rem_6.5rem_7rem] gap-3 px-4 py-2 text-xs font-semibold text-[var(--muted)] border-b border-[var(--line)]">
        <span>Product</span>
        <span className="text-right">Ordered</span>
        <span className="text-right">{showReceived ? "Received" : ""}</span>
        <span className="text-right">Rate</span>
        <span className="text-right">Amount</span>
      </div>
      <ul className="divide-y divide-[var(--line)]">
        {po.lines.map((l) => {
          const left = Math.max(0, l.quantity - l.receivedQty);
          const done = l.receivedQty >= l.quantity;
          const amount = l.unitCost !== null ? l.quantity * l.unitCost : null;
          const recvTone = !showReceived ? "" : done ? "text-[var(--mint-text)] font-semibold" : l.receivedQty > 0 ? "text-[var(--genda-text)] font-semibold" : "";
          return (
            <li key={l.id} className="px-4 py-3">
              {/* Phone */}
              <div className="md:hidden space-y-1">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-sm font-semibold break-words">{l.product.name}</p>
                    <p className="text-xs text-[var(--muted)] break-all">
                      {l.product.sku}
                      {l.product.hsnCode ? ` · HSN ${l.product.hsnCode}` : ""}
                    </p>
                  </div>
                  <p className="text-sm font-semibold shrink-0">{amount !== null ? formatINR(amount) : "—"}</p>
                </div>
                <p className="text-xs text-[var(--ink-2)]">
                  {qtyText(l.quantity, l.product)}
                  {l.unitCost !== null ? ` × ${formatINR(l.unitCost)}` : ""}
                </p>
                {showReceived && (
                  <p className={`text-xs ${recvTone}`}>
                    {done ? "All received" : `${l.receivedQty} received · ${left} to come`}
                  </p>
                )}
              </div>
              {/* Desktop */}
              <div className="hidden md:grid grid-cols-[minmax(0,2fr)_6.5rem_6.5rem_6.5rem_7rem] gap-3 items-center text-sm">
                <div className="min-w-0">
                  <p className="font-semibold truncate">{l.product.name}</p>
                  <p className="text-xs text-[var(--muted)] truncate">
                    {l.product.sku}
                    {l.product.hsnCode ? ` · HSN ${l.product.hsnCode}` : ""}
                  </p>
                </div>
                <span className="text-right">
                  {l.quantity} <span className="text-xs text-[var(--muted)]">{l.product.unit}</span>
                </span>
                <span className={`text-right ${recvTone}`}>{showReceived ? l.receivedQty : ""}</span>
                <span className="text-right text-[var(--ink-2)]">{l.unitCost !== null ? formatINR(l.unitCost) : "—"}</span>
                <span className="text-right font-semibold">{amount !== null ? formatINR(amount) : "—"}</span>
              </div>
            </li>
          );
        })}
      </ul>
      <div className="flex items-center justify-between gap-3 px-4 py-3 border-t-2 border-[var(--line)]">
        <span className="text-sm text-[var(--ink-2)]">Total before GST</span>
        <span className="font-heading font-bold text-lg">{formatINR(value)}</span>
      </div>
    </section>
  );
}

function Receipts({ po }: { po: Po }) {
  if (po.status === "DRAFT" && po.receipts.length === 0) return null;
  return (
    <section className="card overflow-hidden">
      <div className="px-4 py-3.5 border-b border-[var(--line)]">
        <h2 className="font-heading font-bold">Goods received</h2>
      </div>
      {po.receipts.length === 0 ? (
        <p className="p-6 text-center text-sm text-[var(--muted)]">Nothing received on this order yet.</p>
      ) : (
        <ul className="divide-y divide-[var(--line)]">
          {po.receipts.map((r) => (
            <li key={r.id}>
              <Link href={`/admin/stock/purchases/${r.id}`} className="flex items-center justify-between gap-3 px-4 py-3 min-h-[52px] hover:bg-black/[0.03] transition">
                <div className="min-w-0">
                  <p className="text-sm font-semibold break-all">{r.number}</p>
                  <p className="text-xs text-[var(--muted)]">
                    {shortDate(r.createdAt)}
                    {r.billNo ? ` · Bill ${r.billNo}` : ""}
                  </p>
                </div>
                <span className="flex items-center gap-1 shrink-0 text-sm font-semibold">
                  {r.total ? formatINR(r.total) : ""}
                  <Icon name="chevronRight" className="h-4 w-4 text-[var(--muted)]" />
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

// ───────────────────────────── printable order ─────────────────────────────

function PrintDoc({ po, business, value }: { po: Po; business: Business; value: number }) {
  const s = po.supplier;
  return (
    <article className="hidden print:block text-[12px] leading-snug text-black">
      <div className="flex items-start justify-between gap-6 border-b-2 border-black pb-3">
        <div className="min-w-0">
          <p className="text-[18px] font-bold">{business.legalName || business.name}</p>
          {business.legalName && business.legalName !== business.name && <p>{business.name}</p>}
          {business.address && <p className="whitespace-pre-line">{business.address}</p>}
          {business.gstin && <p>GSTIN: {business.gstin}</p>}
          {business.phone && <p>Phone: {business.phone}</p>}
        </div>
        <div className="text-right shrink-0">
          <p className="text-[18px] font-bold tracking-wide">PURCHASE ORDER</p>
          <p>
            No. <b>{po.number}</b>
          </p>
          <p>Date: {shortDate(po.createdAt)}</p>
          {po.expectedDate && <p>Needed by: {dayText(po.expectedDate)}</p>}
        </div>
      </div>

      <div className="py-3 border-b border-black/40">
        <p className="text-[10px] font-bold uppercase tracking-wider">To</p>
        <p className="font-bold text-[14px]">{s.name}</p>
        {s.contactName && <p>Attn: {s.contactName}</p>}
        {s.address && <p className="whitespace-pre-line">{s.address}</p>}
        {s.gstin && <p>GSTIN: {s.gstin}</p>}
        {(s.phone || s.email) && <p>{[s.phone, s.email].filter(Boolean).join(" · ")}</p>}
      </div>

      <table className="w-full mt-3 border-collapse">
        <thead>
          <tr className="border-b border-black text-left">
            <th className="py-1.5 pr-2 w-8">#</th>
            <th className="py-1.5 pr-2">Product</th>
            <th className="py-1.5 pr-2">HSN</th>
            <th className="py-1.5 pr-2 text-right">Qty</th>
            <th className="py-1.5 pr-2 text-right">Rate</th>
            <th className="py-1.5 text-right">Amount</th>
          </tr>
        </thead>
        <tbody>
          {po.lines.map((l, i) => (
            <tr key={l.id} className="border-b border-black/20 align-top">
              <td className="py-1.5 pr-2">{i + 1}</td>
              <td className="py-1.5 pr-2">
                {l.product.name}
                {l.product.sku && <span className="block text-[10px] text-black/60">{l.product.sku}</span>}
              </td>
              <td className="py-1.5 pr-2">{l.product.hsnCode ?? ""}</td>
              <td className="py-1.5 pr-2 text-right whitespace-nowrap">{qtyText(l.quantity, l.product)}</td>
              <td className="py-1.5 pr-2 text-right whitespace-nowrap">{l.unitCost !== null ? formatINR(l.unitCost) : ""}</td>
              <td className="py-1.5 text-right whitespace-nowrap">{l.unitCost !== null ? formatINR(l.quantity * l.unitCost) : ""}</td>
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr className="border-t-2 border-black font-bold">
            <td className="py-2" colSpan={5}>
              Total (before GST)
            </td>
            <td className="py-2 text-right whitespace-nowrap">{formatINR(value)}</td>
          </tr>
        </tfoot>
      </table>

      {po.note && (
        <p className="mt-3">
          <b>Note:</b> {po.note}
        </p>
      )}
      <p className="mt-2 text-[10px] text-black/70">Rates are per unit, before GST. GST as applicable on your invoice. Please quote the order number on your bill.</p>

      <div className="mt-14 flex justify-end">
        <div className="text-center">
          <div className="w-48 border-t border-black pt-1">For {business.legalName || business.name}</div>
          <p className="text-[10px] text-black/70">Authorised signatory</p>
        </div>
      </div>
    </article>
  );
}
