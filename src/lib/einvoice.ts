import { createHash, createHmac } from "node:crypto";
import type { InvoiceType } from "@/generated/prisma/client";
import { tenantDb } from "@/lib/db";
import { ddmmyyyy, fyName, istParts, rupees } from "@/lib/gst";
import { invoiceSettings, type InvoiceSettings } from "@/lib/invoice-settings";
import { loadInvoiceDoc, type InvoiceDoc, type Party } from "@/lib/invoice";
import { MoneyError } from "@/lib/money-error";

/**
 * e-Invoice (IRN + signed QR) and e-way bill. The NIC JSON (schema 1.1) is
 * built here; a provider sends it to the Invoice Registration Portal. Until
 * the owner picks a GST provider, the "sandbox" provider makes test IRNs
 * locally (computed exactly like the real IRN) with a QR marked as a test.
 */

const DOC_TYP: Partial<Record<InvoiceType, "INV" | "CRN" | "DBN">> = { TAX_INVOICE: "INV", CREDIT_NOTE: "CRN", DEBIT_NOTE: "DBN" };

/** IRN = SHA-256 of seller GSTIN + financial year (YYYY-YY) + document type + document number. */
export function irnFor(sellerGstin: string, date: Date, type: InvoiceType, number: string) {
  return createHash("sha256").update(`${sellerGstin}${fyName(date)}${DOC_TYP[type]}${number}`).digest("hex");
}

const clip = (s: string, min: number, max: number, fill = "NA") => {
  const t = (s ?? "").replace(/\s+/g, " ").trim().slice(0, max);
  return t.length >= min ? t : fill;
};

function addr(p: Party) {
  return {
    Addr1: clip(p.address, 1, 100, p.city || "NA"),
    Loc: clip(p.city || p.address, 3, 50, "NA "),
    Pin: Number(p.pinCode) || 999999,
    Stcd: p.stateCode,
  };
}

/** Problems that would make the portal reject this document (empty = OK). */
export function einvoiceProblems(doc: InvoiceDoc): string[] {
  const out: string[] = [];
  if (!DOC_TYP[doc.type]) out.push("Bills of supply are not e-invoiced");
  if (!doc.seller.gstin) out.push("Add your GSTIN in Settings → GST & invoices");
  if (!doc.buyer.gstin) out.push("The retailer has no GSTIN (B2C documents are not e-invoiced)");
  if (!/^[1-9][0-9]{5}$/.test(doc.seller.pinCode)) out.push("Add your 6-digit PIN code in Settings → GST & invoices");
  if (!/^[1-9][0-9]{5}$/.test(doc.buyer.pinCode)) out.push("The retailer's PIN code is missing or wrong");
  for (const l of doc.lines) if (!l.hsnCode || !/^\d{4,8}$/.test(l.hsnCode)) out.push(`${l.description}: HSN code missing`);
  if ((doc.type === "CREDIT_NOTE" || doc.type === "DEBIT_NOTE") && !doc.original) out.push("Original invoice missing");
  return [...new Set(out)];
}

/** NIC e-invoice JSON, schema version 1.1. Amounts in rupees. */
export function buildIrnPayload(doc: InvoiceDoc) {
  const items = doc.lines.map((l) => {
    const valueOnly = l.quantity === 0; // a value-only note line
    const billed = valueOnly ? 1 : l.quantity - l.freeQty;
    return {
      SlNo: String(l.sl),
      PrdDesc: clip(l.description, 3, 300, "Goods"),
      IsServc: l.isService ? "Y" : "N",
      HsnCd: l.hsnCode ?? "",
      Qty: billed,
      FreeQty: valueOnly ? 0 : l.freeQty,
      Unit: l.unit,
      UnitPrice: rupees(valueOnly ? l.taxable : l.rate),
      TotAmt: rupees(l.gross),
      Discount: rupees(l.discount),
      AssAmt: rupees(l.taxable),
      GstRt: l.gstRate,
      IgstAmt: rupees(l.igst),
      CgstAmt: rupees(l.cgst),
      SgstAmt: rupees(l.sgst),
      TotItemVal: rupees(l.total),
    };
  });
  const payload: Record<string, unknown> = {
    Version: "1.1",
    TranDtls: { TaxSch: "GST", SupTyp: "B2B", RegRev: "N", IgstOnIntra: "N" },
    DocDtls: { Typ: DOC_TYP[doc.type], No: doc.number, Dt: ddmmyyyy(doc.date) },
    SellerDtls: {
      Gstin: doc.seller.gstin,
      LglNm: clip(doc.seller.legalName, 3, 100),
      TrdNm: clip(doc.seller.tradeName, 3, 100),
      ...addr(doc.seller),
      ...(doc.seller.phone && /^\d{6,12}$/.test(doc.seller.phone) ? { Ph: doc.seller.phone } : {}),
    },
    BuyerDtls: {
      Gstin: doc.buyer.gstin,
      LglNm: clip(doc.buyer.legalName, 3, 100),
      TrdNm: clip(doc.buyer.tradeName, 3, 100),
      Pos: doc.placeOfSupply,
      ...addr(doc.buyer),
      ...(doc.buyer.phone && /^\d{6,12}$/.test(doc.buyer.phone) ? { Ph: doc.buyer.phone } : {}),
    },
    ItemList: items,
    ValDtls: {
      AssVal: rupees(doc.taxable),
      CgstVal: rupees(doc.cgst),
      SgstVal: rupees(doc.sgst),
      IgstVal: rupees(doc.igst),
      RndOffAmt: rupees(doc.roundOff),
      TotInvVal: rupees(doc.total),
    },
  };
  if (doc.original) {
    payload.RefDtls = { PrecDocDtls: [{ InvNo: doc.original.number, InvDt: ddmmyyyy(doc.original.date) }] };
  }
  return payload;
}

export type IrnResult = { irn: string; ackNo: string; ackDate: Date; signedQr: string };
export type EwbResult = { ewbNo: string; ewbDate: Date; validUntil: Date };
export type EwbInput = { vehicleNo: string; distanceKm: number };

export interface EInvoiceProvider {
  name: string;
  generate(doc: InvoiceDoc, payload: Record<string, unknown>): Promise<IrnResult>;
  cancel(doc: InvoiceDoc, reason: string): Promise<void>;
  eway(doc: InvoiceDoc, input: EwbInput): Promise<EwbResult>;
}

const b64url = (s: string | Buffer) => Buffer.from(s).toString("base64url");

/** Local test provider: real IRN formula, test acknowledgement, QR clearly marked SANDBOX. */
const SANDBOX_QR_KEY = "setu-einvoice-sandbox";

export const sandboxProvider: EInvoiceProvider = {
  name: "sandbox",
  async generate(doc) {
    const irn = irnFor(doc.seller.gstin!, doc.date, doc.type, doc.number);
    const ackNo = `1${String(parseInt(irn.slice(0, 13), 16) % 1e14).padStart(14, "0")}`;
    const ackDate = new Date();
    const claims = {
      SellerGstin: doc.seller.gstin,
      BuyerGstin: doc.buyer.gstin,
      DocNo: doc.number,
      DocTyp: DOC_TYP[doc.type],
      DocDt: ddmmyyyy(doc.date),
      TotInvVal: rupees(doc.total),
      ItemCnt: doc.lines.length,
      MainHsnCode: doc.lines[0]?.hsnCode ?? "",
      Irn: irn,
      IrnDt: ackDate.toISOString(),
      iss: "SETU-SANDBOX (not a valid e-invoice)",
    };
    const head = b64url(JSON.stringify({ alg: "HS256", typ: "JWT" }));
    const body = b64url(JSON.stringify({ data: JSON.stringify(claims) }));
    // Not a secret: the sandbox QR is marked invalid and is never accepted by GSTN.
    const sig = createHmac("sha256", SANDBOX_QR_KEY).update(`${head}.${body}`).digest("base64url");
    return { irn, ackNo, ackDate, signedQr: `${head}.${body}.${sig}` };
  },
  async cancel() {},
  async eway(doc, input) {
    const ewbDate = new Date();
    // Validity: 1 day per 200 km (minimum 1), ending at midnight IST.
    const days = Math.max(1, Math.ceil(input.distanceKm / 200));
    const { y, m, day } = istParts(ewbDate);
    const validUntil = new Date(Date.UTC(y, m - 1, day + days, 23, 59, 59) - 330 * 60 * 1000);
    const n = parseInt(createHash("sha256").update(`${doc.id}:ewb`).digest("hex").slice(0, 10), 16) % 1e11;
    return { ewbNo: `9${String(n).padStart(11, "0")}`, ewbDate, validUntil };
  },
};

/**
 * Test IRNs printed on real tax invoices would look like e-invoices that
 * were never filed, so the sandbox runs only in development and the tests,
 * or where ALLOW_EINVOICE_SANDBOX=1 is set on purpose (a demo copy).
 */
export const einvoiceSandboxAllowed = (env: Record<string, string | undefined> = process.env) =>
  env.NODE_ENV === "development" || env.NODE_ENV === "test" || env.ALLOW_EINVOICE_SANDBOX === "1";

export function providerFor(s: InvoiceSettings): EInvoiceProvider {
  if (s.einvoice.provider === "sandbox") {
    if (einvoiceSandboxAllowed()) return sandboxProvider;
    throw new MoneyError("E-invoice test mode is for trial copies only. Connect a GST provider in Settings → GST & invoices to make real IRNs.", 409);
  }
  throw new MoneyError("No GST provider is set up for e-invoicing yet. Choose one in Settings → GST & invoices.", 409);
}

async function settingsOf(tenantId: string) {
  const db = tenantDb(tenantId);
  const t = await db.tenant.findUniqueOrThrow({ where: { id: tenantId }, select: { settings: true } });
  return { db, settings: invoiceSettings(t.settings) };
}

/**
 * Get an IRN for a document (worker job or the "Generate e-invoice" button).
 * Failures are stored on the invoice for the admin to see and retry.
 */
export async function generateEInvoice(tenantId: string, invoiceId: string) {
  const { db, settings } = await settingsOf(tenantId);
  const doc = await loadInvoiceDoc(db as never, invoiceId);
  if (!doc) throw new MoneyError("Invoice not found", 404);
  if (doc.einvStatus === "GENERATED") return doc;
  if (doc.einvStatus === "CANCELLED") throw new MoneyError("This e-invoice was cancelled", 409);
  const problems = einvoiceProblems(doc);
  try {
    if (problems.length) throw new MoneyError(problems.join("; "));
    if (doc.original) {
      const orig = await db.invoice.findUnique({ where: { id: doc.original.id }, select: { einvStatus: true } });
      if (orig && orig.einvStatus !== "GENERATED" && orig.einvStatus !== "NOT_REQUIRED") {
        // Not ready yet (its job may still be queued): 503 so the worker retries.
        throw new MoneyError("Generate the original invoice's e-invoice first", 503);
      }
    }
    const provider = providerFor(settings);
    const res = await provider.generate(doc, buildIrnPayload(doc));
    await db.invoice.update({
      where: { id: invoiceId },
      data: { einvStatus: "GENERATED", irn: res.irn, ackNo: res.ackNo, ackDate: res.ackDate, signedQr: res.signedQr, einvError: null, einvAttempts: { increment: 1 } },
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    await db.invoice.update({ where: { id: invoiceId }, data: { einvStatus: "FAILED", einvError: msg.slice(0, 500), einvAttempts: { increment: 1 } } });
    throw e instanceof MoneyError ? e : new MoneyError(msg, 502);
  }
  return loadInvoiceDoc(db as never, invoiceId);
}

/** Cancel an IRN (allowed by the portal within 24 hours of generation). */
export async function cancelEInvoice(tenantId: string, invoiceId: string, reason: string) {
  const { db, settings } = await settingsOf(tenantId);
  const doc = await loadInvoiceDoc(db as never, invoiceId);
  if (!doc) throw new MoneyError("Invoice not found", 404);
  if (doc.einvStatus !== "GENERATED" || !doc.ackDate) throw new MoneyError("There is no e-invoice to cancel", 409);
  if (Date.now() - doc.ackDate.getTime() > 24 * 60 * 60 * 1000) {
    throw new MoneyError("An e-invoice can only be cancelled within 24 hours. Issue a credit note instead.", 409);
  }
  await providerFor(settings).cancel(doc, reason);
  await db.invoice.update({ where: { id: invoiceId }, data: { einvStatus: "CANCELLED", einvCancelledAt: new Date(), einvError: `Cancelled: ${reason}`.slice(0, 500) } });
  return loadInvoiceDoc(db as never, invoiceId);
}

const VEHICLE_RE = /^[A-Z]{2}[0-9]{1,2}[A-Z]{0,3}[0-9]{4}$/;

/** E-way bill for a sale invoice (by road, own vehicle). */
export async function generateEway(tenantId: string, invoiceId: string, input: EwbInput) {
  const { db, settings } = await settingsOf(tenantId);
  const doc = await loadInvoiceDoc(db as never, invoiceId);
  if (!doc) throw new MoneyError("Invoice not found", 404);
  if (doc.type !== "TAX_INVOICE" && doc.type !== "BILL_OF_SUPPLY") throw new MoneyError("E-way bills are made for sale invoices");
  if (doc.ewbNo) throw new MoneyError("This invoice already has an e-way bill", 409);
  const vehicleNo = input.vehicleNo.replace(/[\s-]/g, "").toUpperCase();
  if (!VEHICLE_RE.test(vehicleNo)) throw new MoneyError("Vehicle number looks wrong (example: MH02AB1234)");
  if (!Number.isInteger(input.distanceKm) || input.distanceKm < 1 || input.distanceKm > 4000) throw new MoneyError("Distance must be 1 to 4,000 km");
  if (!doc.seller.gstin) throw new MoneyError("Add your GSTIN in Settings → GST & invoices");
  const res = await providerFor(settings).eway(doc, { vehicleNo, distanceKm: input.distanceKm });
  await db.invoice.update({
    where: { id: invoiceId },
    data: { ewbNo: res.ewbNo, ewbDate: res.ewbDate, ewbValidUntil: res.validUntil, ewbVehicle: vehicleNo, ewbDistanceKm: input.distanceKm },
  });
  return loadInvoiceDoc(db as never, invoiceId);
}
