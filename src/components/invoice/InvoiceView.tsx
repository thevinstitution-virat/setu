"use client";

import { useCallback, useEffect, useState } from "react";
import Icon from "@/components/Icon";
import { formatINR } from "@/lib/money";

/**
 * Shared invoice / note screen pieces (any role). Data comes from
 * GET /api/invoices/[id]; the PDF from /api/invoices/[id]/pdf.
 *
 *   <InvoicePanel id={invoiceId} />            — loads, shows the document + share buttons
 *   <InvoiceView doc={…} />                    — just the document
 *   <InvoiceShare doc={…} share={…} />         — PDF / download / WhatsApp / share / copy link
 */

export type InvoiceParty = {
  legalName: string;
  tradeName: string;
  gstin: string | null;
  stateCode: string;
  address: string;
  city: string;
  pinCode: string;
  phone: string | null;
};
export type InvoiceLineJson = {
  id: string;
  sl: number;
  description: string;
  hsnCode: string | null;
  isService: boolean;
  unit: string;
  quantity: number;
  freeQty: number;
  rate: number;
  gross: number;
  discount: number;
  taxable: number;
  gstRate: number;
  cgst: number;
  sgst: number;
  igst: number;
  total: number;
  originalLineId: string | null;
};
export type InvoiceJson = {
  id: string;
  /** The retailer billed (staff screens link to their khata). */
  retailerId?: string;
  type: "TAX_INVOICE" | "BILL_OF_SUPPLY" | "CREDIT_NOTE" | "DEBIT_NOTE";
  title: string;
  number: string;
  date: string;
  seller: InvoiceParty;
  buyer: InvoiceParty;
  b2b: boolean;
  placeOfSupply: string;
  interState: boolean;
  taxable: number;
  cgst: number;
  sgst: number;
  igst: number;
  total: number;
  words: string;
  reason: string | null;
  noteKind: string | null;
  lines: InvoiceLineJson[];
  rates: { rate: number; taxable: number; cgst: number; sgst: number; igst: number }[];
  original: { id: string; number: string; date: string } | null;
  notes: { id: string; type: InvoiceJson["type"]; number: string; date: string; total: number }[];
  order: { id: string; orderNumber: string; deliveryDate: string | null; status: string } | null;
  einvStatus: "NOT_REQUIRED" | "PENDING" | "GENERATED" | "FAILED" | "CANCELLED";
  irn: string | null;
  ackNo: string | null;
  ackDate: string | null;
  einvError: string | null;
  ewbNo: string | null;
  ewbValidUntil: string | null;
  ewbVehicle: string | null;
  due: number | null;
  ewayNeeded: boolean;
};
export type ShareJson = { url: string; pdfUrl: string; text: string; whatsapp: string };
export type InvoiceResponse = {
  invoice: InvoiceJson;
  share: ShareJson;
  einvoiceProblems: string[];
  can: { creditNote: boolean; debitNote: boolean; einvoice: boolean; cancelEinvoice: boolean; eway: boolean };
};

export const STATE_NAMES: Record<string, string> = {
  "01": "Jammu and Kashmir", "02": "Himachal Pradesh", "03": "Punjab", "04": "Chandigarh", "05": "Uttarakhand", "06": "Haryana",
  "07": "Delhi", "08": "Rajasthan", "09": "Uttar Pradesh", "10": "Bihar", "11": "Sikkim", "12": "Arunachal Pradesh", "13": "Nagaland",
  "14": "Manipur", "15": "Mizoram", "16": "Tripura", "17": "Meghalaya", "18": "Assam", "19": "West Bengal", "20": "Jharkhand",
  "21": "Odisha", "22": "Chhattisgarh", "23": "Madhya Pradesh", "24": "Gujarat", "26": "Dadra and Nagar Haveli and Daman and Diu",
  "27": "Maharashtra", "29": "Karnataka", "30": "Goa", "31": "Lakshadweep", "32": "Kerala", "33": "Tamil Nadu", "34": "Puducherry",
  "35": "Andaman and Nicobar Islands", "36": "Telangana", "37": "Andhra Pradesh", "38": "Ladakh", "97": "Other Territory",
};
const state = (c: string) => (STATE_NAMES[c] ? `${c} · ${STATE_NAMES[c]}` : c);
export const fmtDate = (d: string | null) => (d ? new Date(d).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric", timeZone: "Asia/Kolkata" }) : "");

export const DOC_CHIP: Record<InvoiceJson["type"], string> = {
  TAX_INVOICE: "chip chip-mor",
  BILL_OF_SUPPLY: "chip chip-mor",
  CREDIT_NOTE: "chip chip-mint",
  DEBIT_NOTE: "chip chip-genda",
};
export const EINV_LABEL: Record<InvoiceJson["einvStatus"], string> = {
  NOT_REQUIRED: "",
  PENDING: "e-Invoice pending",
  GENERATED: "e-Invoice done",
  FAILED: "e-Invoice failed",
  CANCELLED: "e-Invoice cancelled",
};

function PartyCard({ label, p }: { label: string; p: InvoiceParty }) {
  return (
    <div className="min-w-0">
      <p className="text-[11px] font-semibold uppercase tracking-wide text-[var(--muted)]">{label}</p>
      <p className="font-semibold text-sm mt-1 break-words">{p.legalName}</p>
      {p.tradeName !== p.legalName && <p className="text-xs text-[var(--muted)]">{p.tradeName}</p>}
      <p className="text-xs mt-1 break-words">{[p.address, [p.city, p.pinCode].filter(Boolean).join(" ")].filter(Boolean).join(", ")}</p>
      <p className="text-xs">State: {state(p.stateCode)}</p>
      <p className="text-xs font-medium">{p.gstin ? `GSTIN ${p.gstin}` : "Unregistered (no GSTIN)"}</p>
    </div>
  );
}

/** The document itself, phone-first: lines as rows, totals, tax by rate. */
export function InvoiceView({ doc }: { doc: InvoiceJson }) {
  const tax = doc.cgst + doc.sgst + doc.igst;
  return (
    <div className="card p-4 space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <span className={DOC_CHIP[doc.type]}>{doc.title}</span>
          <h2 className="text-lg font-semibold mt-2 break-all">{doc.number}</h2>
          <p className="text-xs text-[var(--muted)]">
            {fmtDate(doc.date)} · Place of supply {state(doc.placeOfSupply)}
          </p>
          {doc.order && <p className="text-xs text-[var(--muted)]">Order {doc.order.orderNumber}</p>}
          {doc.original && <p className="text-xs text-[var(--muted)]">Against invoice {doc.original.number} of {fmtDate(doc.original.date)}</p>}
          {doc.reason && <p className="text-xs mt-1">Reason: {doc.reason}</p>}
        </div>
        <div className="text-right">
          <p className="text-xs text-[var(--muted)]">Total</p>
          <p className="text-xl font-semibold">{formatINR(doc.total)}</p>
          {doc.due !== null && (doc.due > 0 ? <p className="text-xs font-medium text-[var(--kesar-text)]">Due {formatINR(doc.due)}</p> : <p className="text-xs font-medium text-emerald-700">Paid</p>)}
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 border-t border-[var(--line)] pt-3">
        <PartyCard label="From" p={doc.seller} />
        <PartyCard label="Bill to" p={doc.buyer} />
      </div>

      <div className="border-t border-[var(--line)] pt-3">
        <ul className="divide-y divide-[var(--line)]">
          {doc.lines.map((l) => (
            <li key={l.id} className="py-2 flex justify-between gap-3 text-sm">
              <div className="min-w-0">
                <p className="font-medium break-words">{l.description}</p>
                <p className="text-xs text-[var(--muted)]">
                  {l.quantity > 0 ? `${l.quantity} ${l.unit}` : "Value only"}
                  {l.rate > 0 && l.quantity > 0 ? ` × ${formatINR(l.rate)}` : ""}
                  {l.discount > 0 ? ` − ${formatINR(l.discount)} off` : ""} · HSN {l.hsnCode ?? "—"} · GST {l.gstRate}%
                </p>
              </div>
              <div className="text-right shrink-0">
                <p className="font-medium">{l.freeQty === l.quantity && l.quantity > 0 ? "Free" : formatINR(l.taxable)}</p>
                {l.cgst + l.sgst + l.igst > 0 && <p className="text-xs text-[var(--muted)]">+ {formatINR(l.cgst + l.sgst + l.igst)} GST</p>}
              </div>
            </li>
          ))}
        </ul>
      </div>

      <div className="border-t border-[var(--line)] pt-3 grid gap-4 sm:grid-cols-2">
        <div className="text-xs space-y-1 overflow-x-auto">
          <table className="w-full">
            <thead className="text-[var(--muted)]">
              <tr>
                <th className="text-left font-medium">GST</th>
                <th className="text-right font-medium">Taxable</th>
                {doc.interState ? <th className="text-right font-medium">IGST</th> : (<><th className="text-right font-medium">CGST</th><th className="text-right font-medium">SGST</th></>)}
              </tr>
            </thead>
            <tbody>
              {doc.rates.map((r) => (
                <tr key={r.rate}>
                  <td>{r.rate}%</td>
                  <td className="text-right">{formatINR(r.taxable)}</td>
                  {doc.interState ? <td className="text-right">{formatINR(r.igst)}</td> : (<><td className="text-right">{formatINR(r.cgst)}</td><td className="text-right">{formatINR(r.sgst)}</td></>)}
                </tr>
              ))}
            </tbody>
          </table>
          <p className="text-[var(--muted)] pt-2">{doc.words}</p>
        </div>
        <dl className="text-sm space-y-1">
          <div className="flex justify-between"><dt className="text-[var(--muted)]">Taxable value</dt><dd>{formatINR(doc.taxable)}</dd></div>
          {doc.interState ? (
            <div className="flex justify-between"><dt className="text-[var(--muted)]">IGST</dt><dd>{formatINR(doc.igst)}</dd></div>
          ) : tax > 0 ? (
            <>
              <div className="flex justify-between"><dt className="text-[var(--muted)]">CGST</dt><dd>{formatINR(doc.cgst)}</dd></div>
              <div className="flex justify-between"><dt className="text-[var(--muted)]">SGST</dt><dd>{formatINR(doc.sgst)}</dd></div>
            </>
          ) : null}
          <div className="flex justify-between font-semibold text-base border-t border-[var(--line)] pt-1"><dt>Total</dt><dd>{formatINR(doc.total)}</dd></div>
        </dl>
      </div>

      {(doc.irn || doc.ewbNo || doc.einvStatus === "PENDING" || doc.einvStatus === "FAILED") && (
        <div className="border-t border-[var(--line)] pt-3 text-xs space-y-1">
          {doc.irn && <p className="break-all"><span className="text-[var(--muted)]">IRN</span> {doc.irn}</p>}
          {doc.ackNo && <p><span className="text-[var(--muted)]">Ack</span> {doc.ackNo} · {fmtDate(doc.ackDate)}</p>}
          {doc.einvStatus === "PENDING" && <p className="text-[var(--muted)]">e-Invoice is being generated.</p>}
          {doc.einvStatus === "FAILED" && <p className="text-[var(--kesar-text)]">e-Invoice failed: {doc.einvError}</p>}
          {doc.ewbNo && <p><span className="text-[var(--muted)]">E-way bill</span> {doc.ewbNo}{doc.ewbVehicle ? ` · ${doc.ewbVehicle}` : ""}{doc.ewbValidUntil ? ` · valid till ${fmtDate(doc.ewbValidUntil)}` : ""}</p>}
        </div>
      )}
    </div>
  );
}

/**
 * Open / download the PDF, send on WhatsApp, share the PDF file (phones with
 * the Web Share API), copy the link.
 */
export function InvoiceShare({ doc, share, pdfPath }: { doc: Pick<InvoiceJson, "id" | "number">; share: ShareJson; pdfPath?: string }) {
  const pdf = pdfPath ?? `/api/invoices/${doc.id}/pdf`;
  const [msg, setMsg] = useState("");
  const [canShareFile, setCanShareFile] = useState(false);
  useEffect(() => {
    try {
      const f = new File([""], "x.pdf", { type: "application/pdf" });
      setCanShareFile(typeof navigator !== "undefined" && !!navigator.canShare && navigator.canShare({ files: [f] }));
    } catch {
      setCanShareFile(false);
    }
  }, []);

  async function shareFile() {
    setMsg("");
    try {
      const res = await fetch(pdf);
      if (!res.ok) throw new Error("Could not load the PDF");
      const file = new File([await res.blob()], `${doc.number}.pdf`, { type: "application/pdf" });
      await navigator.share({ files: [file], title: doc.number, text: share.text });
    } catch (e) {
      if ((e as Error).name !== "AbortError") setMsg((e as Error).message || "Sharing didn't work");
    }
  }
  async function copy() {
    try {
      await navigator.clipboard.writeText(share.url);
      setMsg("Link copied");
    } catch {
      setMsg(share.url);
    }
  }

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap gap-2">
        <a className="btn btn-primary btn-sm" href={pdf} target="_blank" rel="noopener">
          <Icon name="file" className="h-4 w-4" /> Open PDF
        </a>
        <a className="btn btn-outline btn-sm" href={`${pdf}?download=1`}>
          <Icon name="download" className="h-4 w-4" /> Download
        </a>
        <a className="btn btn-outline btn-sm" href={share.whatsapp} target="_blank" rel="noopener">
          <Icon name="share" className="h-4 w-4" /> WhatsApp
        </a>
        {canShareFile && (
          <button type="button" className="btn btn-outline btn-sm" onClick={shareFile}>
            <Icon name="share" className="h-4 w-4" /> Share PDF
          </button>
        )}
        <button type="button" className="btn btn-quiet btn-sm" onClick={copy}>
          Copy link
        </button>
      </div>
      {msg && <p className="text-xs text-[var(--muted)] break-all">{msg}</p>}
    </div>
  );
}

/**
 * Loads one document and shows it with its share buttons. `extra` renders under it (e.g. admin actions);
 * `noteHref` turns the credit / debit notes list into links.
 */
export function InvoicePanel({
  id,
  extra,
  noteHref,
}: {
  id: string;
  extra?: (r: InvoiceResponse, reload: () => void) => React.ReactNode;
  noteHref?: (noteId: string) => string;
}) {
  const [data, setData] = useState<InvoiceResponse | null>(null);
  const [error, setError] = useState("");
  const load = useCallback(async () => {
    setError("");
    const res = await fetch(`/api/invoices/${id}`, { cache: "no-store" });
    const j = await res.json().catch(() => ({}));
    if (!res.ok) setError(j.error ?? "Could not load the invoice");
    else setData(j);
  }, [id]);
  useEffect(() => {
    load();
  }, [load]);

  if (error) return <div className="card p-4 text-sm text-[var(--kesar-text)]">{error}</div>;
  if (!data) return <div className="card p-4 text-sm text-[var(--muted)]">Loading…</div>;
  return (
    <div className="space-y-4">
      <InvoiceShare doc={data.invoice} share={data.share} />
      <InvoiceView doc={data.invoice} />
      {data.invoice.notes.length > 0 && (
        <div className="card p-4">
          <p className="text-sm font-semibold mb-2">Credit and debit notes</p>
          <ul className="text-sm divide-y divide-[var(--line)]">
            {data.invoice.notes.map((n) => (
              <li key={n.id} className="py-2 flex justify-between gap-2">
                <span className="min-w-0">
                  <span className={DOC_CHIP[n.type]}>{n.type === "CREDIT_NOTE" ? "Credit" : "Debit"}</span>{" "}
                  {noteHref ? (
                    <a href={noteHref(n.id)} className="font-medium underline underline-offset-2">
                      {n.number}
                    </a>
                  ) : (
                    n.number
                  )}{" "}
                  · {fmtDate(n.date)}
                </span>
                <span className="font-medium shrink-0">{formatINR(n.total)}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
      {extra?.(data, load)}
    </div>
  );
}
