import type { Invoice, InvoiceLine, InvoiceType, Prisma } from "@/generated/prisma/client";
import type { Tx } from "@/lib/db";
import { MoneyError } from "@/lib/money-error";
import { formatINR, gstOn, lineMoney } from "@/lib/money";
import { nextSequence } from "@/lib/orders";
import { invoiceSettings, type InvoiceSettings } from "@/lib/invoice-settings";
import { amountInWords, creditNoteDeadline, docNumber, fyCode, runningNumber, splitTax, uqc } from "@/lib/gst";
import { invoiceWebhook } from "@/lib/webhooks";

/**
 * GST documents. This module builds and stores them (numbers, parties, lines,
 * tax split); posting them to the ledger is done by the callers in ledger.ts
 * (bookSale, issueCreditNote, issueDebitNote) inside the same transaction.
 */

type Ctx = { tx: Tx; tenantId: string; actorId: string | null };

export type Party = {
  legalName: string;
  tradeName: string;
  gstin: string | null;
  stateCode: string;
  address: string;
  city: string;
  pinCode: string;
  phone: string | null;
};

export const DOC_TITLE: Record<InvoiceType, string> = {
  TAX_INVOICE: "Tax Invoice",
  BILL_OF_SUPPLY: "Bill of Supply",
  CREDIT_NOTE: "Credit Note",
  DEBIT_NOTE: "Debit Note",
};

export const prefixFor = (s: InvoiceSettings, type: InvoiceType) =>
  ({ TAX_INVOICE: s.prefixes.tax, BILL_OF_SUPPLY: s.prefixes.bos, CREDIT_NOTE: s.prefixes.credit, DEBIT_NOTE: s.prefixes.debit })[type];

/** Counter behind a running (not yearly) series. */
export const runningKey = (type: InvoiceType) => `doc:${type}:run`;

/**
 * Next gap-free number for a document type: in the date's financial year
 * (INV2627-00042), or from the running series (A004262).
 */
async function nextDocNumber(ctx: Ctx, s: InvoiceSettings, type: InvoiceType, date: Date) {
  const fy = fyCode(date);
  if (s.numbering.style === "running") {
    const seq = await nextSequence(ctx.tx, ctx.tenantId, runningKey(type));
    return { fy, number: runningNumber(prefixFor(s, type), seq, s.numbering.digits) };
  }
  const seq = await nextSequence(ctx.tx, ctx.tenantId, `doc:${type}:${fy}`);
  return { fy, number: docNumber(prefixFor(s, type), fy, seq) };
}

/** The number the next document of this type will get in the running series (null = nothing issued yet: starts at 1). */
export async function nextRunningNumber(tx: Tx, tenantId: string, type: InvoiceType) {
  const row = await tx.counter.findUnique({ where: { tenantId_key: { tenantId, key: runningKey(type) } } });
  return (row?.value ?? 0) + 1;
}

/**
 * Carry on an old book's series: the next document gets `next`. Only moves
 * forward, so a number can never be issued twice.
 */
export async function setNextRunningNumber(tx: Tx, tenantId: string, type: InvoiceType, next: number) {
  if (!Number.isInteger(next) || next < 1 || next > 99_999_999) throw new MoneyError("The next number must be a whole number from 1 to 99,999,999");
  const current = await nextRunningNumber(tx, tenantId, type);
  if (next < current) throw new MoneyError(`Numbers up to ${current - 1} are already used; the next number can't go back`, 409);
  await tx.counter.upsert({
    where: { tenantId_key: { tenantId, key: runningKey(type) } },
    create: { tenantId, key: runningKey(type), value: next - 1 },
    update: { value: next - 1 },
  });
  return next;
}

async function sellerOf(ctx: Ctx) {
  const t = await ctx.tx.tenant.findUniqueOrThrow({
    where: { id: ctx.tenantId },
    select: { name: true, legalName: true, gstin: true, stateCode: true, address: true, phone: true, settings: true },
  });
  const settings = invoiceSettings(t.settings);
  if (!t.stateCode) throw new MoneyError("Set your business's GST state in Settings → GST & invoices before invoicing", 409);
  const seller: Party = {
    legalName: t.legalName || t.name,
    tradeName: t.name,
    gstin: t.gstin || null,
    stateCode: t.stateCode,
    address: t.address ?? "",
    city: settings.city,
    pinCode: settings.pinCode,
    phone: t.phone,
  };
  return { seller, settings, tenantSettings: t.settings };
}

async function buyerOf(ctx: Ctx, retailerId: string, sellerState: string): Promise<Party> {
  const r = await ctx.tx.retailerProfile.findUniqueOrThrow({
    where: { id: retailerId },
    include: { user: { select: { phone: true } }, area: { select: { name: true } } },
  });
  return {
    legalName: r.legalName || r.outletName,
    tradeName: r.outletName,
    gstin: r.gstin || null,
    stateCode: r.stateCode || (r.gstin ? r.gstin.slice(0, 2) : sellerState),
    address: [r.shopNumber, r.complexName, r.area.name].filter(Boolean).join(", "),
    city: r.area.name,
    pinCode: r.pinCode,
    phone: r.user.phone ?? null,
  };
}

/** e-Invoice applies to B2B tax invoices and notes once the tenant turns it on. */
export function einvoiceRequired(s: InvoiceSettings, type: InvoiceType, b2b: boolean, sellerGstin: string | null) {
  return s.einvoice.enabled && b2b && !!sellerGstin && type !== "BILL_OF_SUPPLY";
}

type Draft = {
  productId: string | null;
  orderItemId: string | null;
  originalLineId: string | null;
  description: string;
  hsnCode: string | null;
  isService: boolean;
  unit: string;
  quantity: number;
  freeQty: number;
  rate: number;
  gross: number;
  discount: number;
  gstRate: number;
  tax: number;
  /** Print details (no effect on money). */
  inclRate?: number | null;
  mrp?: number | null;
  caseSize?: number | null;
};

export function finalise(drafts: Draft[], interState: boolean) {
  const lines = drafts.map((d, i) => {
    const taxable = d.gross - d.discount;
    const { cgst, sgst, igst } = splitTax(d.tax, interState);
    const { tax: _tax, ...rest } = d;
    void _tax;
    return { ...rest, sl: i + 1, taxable, cgst, sgst, igst, total: taxable + cgst + sgst + igst };
  });
  const sum = (k: "taxable" | "cgst" | "sgst" | "igst" | "total") => lines.reduce((a, l) => a + l[k], 0);
  return { lines, taxable: sum("taxable"), cgst: sum("cgst"), sgst: sum("sgst"), igst: sum("igst"), total: sum("total") };
}

/**
 * Lines of an order's invoice: paid goods, free goods (no value) and the
 * delivery charge. Recomputed from the frozen order lines with the same
 * rounding as the quote, then checked to equal the order's totals exactly.
 */
export function orderDrafts(
  order: {
    orderNumber: string;
    subtotal: number;
    gstAmount: number;
    deliveryCharge: number;
    deliveryGstRate: number;
    /** Item rates and discounts include GST. */
    taxInclusive?: boolean;
    items: {
      id: string;
      productId: string;
      quantity: number;
      price: number;
      gstRate: number;
      discount: number;
      freeSchemeId: string | null;
      mrp?: number | null;
      product: { name: string; hsnCode: string | null; unit: string; caseSize?: number | null };
    }[];
  },
  s: InvoiceSettings
): Draft[] {
  const inclusive = !!order.taxInclusive;
  // Lines cut to nothing at delivery (invoice at delivery) don't appear.
  const drafts: Draft[] = order.items.filter((it) => it.quantity > 0).map((it) => {
    const free = !!it.freeSchemeId || it.price === 0;
    const m = free ? { gross: 0, discount: 0, tax: 0 } : lineMoney(it.price, it.quantity, it.discount, it.gstRate, inclusive);
    return {
      productId: it.productId,
      orderItemId: it.id,
      originalLineId: null,
      description: free ? `${it.product.name} (free)` : it.product.name,
      hsnCode: it.product.hsnCode,
      isService: false,
      unit: uqc(it.product.unit),
      quantity: it.quantity,
      freeQty: free ? it.quantity : 0,
      // The invoice's rate is always before GST; with inclusive rates it is the line's taxable gross per unit.
      rate: free ? 0 : inclusive && it.gstRate > 0 ? Math.round(m.gross / it.quantity) : it.price,
      gross: m.gross,
      discount: m.discount,
      gstRate: it.gstRate,
      tax: m.tax,
      inclRate: free ? 0 : inclusive ? it.price : null,
      mrp: it.mrp ?? null,
      caseSize: it.product.caseSize ?? null,
    };
  });
  if (order.deliveryCharge > 0) {
    const goodsTax = drafts.reduce((a, d) => a + d.tax, 0);
    drafts.push({
      productId: null,
      orderItemId: null,
      originalLineId: null,
      description: "Delivery charges",
      hsnCode: s.deliverySac,
      isService: true,
      unit: "OTH",
      quantity: 1,
      freeQty: 0,
      rate: order.deliveryCharge,
      gross: order.deliveryCharge,
      discount: 0,
      gstRate: order.deliveryGstRate,
      tax: order.gstAmount - goodsTax,
    });
  }
  const taxable = drafts.reduce((a, d) => a + d.gross - d.discount, 0);
  const tax = drafts.reduce((a, d) => a + d.tax, 0);
  const delivery = drafts.find((d) => d.isService);
  const deliveryOff = !!delivery && delivery.tax !== gstOn(order.deliveryCharge, order.deliveryGstRate);
  if (taxable !== order.subtotal || tax !== order.gstAmount || deliveryOff || drafts.some((d) => d.tax < 0)) {
    throw new MoneyError(
      `Order ${order.orderNumber} doesn't add up (lines ${formatINR(taxable)} + ${formatINR(tax)} GST vs order ${formatINR(order.subtotal)} + ${formatINR(order.gstAmount)}). It can't be invoiced.`,
      409
    );
  }
  return drafts;
}

/**
 * Issue the order's tax invoice (or bill of supply). Idempotent: an order
 * that already has one gets it back. Does not post to the ledger.
 */
export async function issueSaleInvoice(ctx: Ctx, orderId: string, now = new Date()) {
  const existing = await ctx.tx.invoice.findFirst({ where: { orderId, type: { in: ["TAX_INVOICE", "BILL_OF_SUPPLY"] } } });
  if (existing) return { invoice: existing, created: false };

  const order = await ctx.tx.order.findUniqueOrThrow({
    where: { id: orderId },
    include: { items: { include: { product: { select: { name: true, hsnCode: true, unit: true, caseSize: true } } }, orderBy: [{ freeSchemeId: { sort: "asc", nulls: "first" } }, { id: "asc" }] } },
  });
  if (order.status === "CANCELLED") throw new MoneyError("A cancelled order can't be invoiced", 409);
  const salesman = order.salesmanId
    ? ((await ctx.tx.user.findUnique({ where: { id: order.salesmanId }, select: { name: true } }))?.name ?? null)
    : null;
  const { seller, settings } = await sellerOf(ctx);
  const buyer = await buyerOf(ctx, order.retailerId, seller.stateCode);
  const drafts = orderDrafts(order, settings);
  const interState = buyer.stateCode !== seller.stateCode;
  const f = finalise(drafts, interState);
  const type: InvoiceType =
    settings.scheme === "composition" || !seller.gstin || f.cgst + f.sgst + f.igst === 0 ? "BILL_OF_SUPPLY" : "TAX_INVOICE";
  if (type === "BILL_OF_SUPPLY" && f.cgst + f.sgst + f.igst > 0) {
    throw new MoneyError("GST was charged on this order but the business has no GSTIN. Add the GSTIN in Settings → GST & invoices.", 409);
  }
  const { fy, number } = await nextDocNumber(ctx, settings, type, now);
  const b2b = !!buyer.gstin;
  const invoice = await ctx.tx.invoice.create({
    data: {
      type,
      number,
      fy,
      date: now,
      orderId,
      retailerId: order.retailerId,
      seller: seller as unknown as Prisma.InputJsonValue,
      buyer: buyer as unknown as Prisma.InputJsonValue,
      b2b,
      placeOfSupply: buyer.stateCode,
      interState,
      taxable: f.taxable,
      cgst: f.cgst,
      sgst: f.sgst,
      igst: f.igst,
      total: f.total,
      salesman,
      createdById: ctx.actorId,
      einvStatus: einvoiceRequired(settings, type, b2b, seller.gstin) ? "PENDING" : "NOT_REQUIRED",
      lines: { create: f.lines },
    },
  });
  if (invoice.total !== order.totalAmount) throw new MoneyError("Invoice total doesn't match the order total", 409);
  await invoiceWebhook(ctx.tx, ctx.tenantId, invoice.id);
  return { invoice, created: true };
}

export type NoteLineInput = { lineId: string; quantity?: number; amount?: number };
export type NoteInput = {
  invoiceId: string;
  type: "CREDIT_NOTE" | "DEBIT_NOTE";
  /** return = goods came back (by quantity); value = rate / discount change (taxable amount); cancel = everything left on the invoice. */
  kind: "return" | "value" | "cancel";
  reason: string;
  lines: NoteLineInput[];
};

/**
 * Build and store a credit or debit note against a sale invoice. Credits can
 * never take a line below zero (value or quantity, after earlier notes);
 * crediting what is left of a line gives back exactly its remaining tax, so a
 * full return or cancellation nets to zero. Does not post to the ledger.
 */
export async function issueNoteDoc(ctx: Ctx, input: NoteInput, now = new Date()) {
  const original = await ctx.tx.invoice.findUnique({
    where: { id: input.invoiceId },
    include: { lines: { orderBy: { sl: "asc" } }, notes: { include: { lines: true } } },
  });
  if (!original) throw new MoneyError("Invoice not found", 404);
  if (original.type !== "TAX_INVOICE" && original.type !== "BILL_OF_SUPPLY") throw new MoneyError("Notes can only be issued against a sale invoice");
  const reason = input.reason.trim().slice(0, 200);
  if (!reason) throw new MoneyError("Give a reason");
  const credit = input.type === "CREDIT_NOTE";
  if (credit && now > creditNoteDeadline(original.date)) {
    throw new MoneyError("The last date for credit notes on this invoice (30 November after its financial year) has passed");
  }
  if (!credit && input.kind !== "value") throw new MoneyError("A debit note can only change value");

  // What earlier notes already did to each line.
  const done = new Map<string, { credTaxable: number; credTax: number; debTaxable: number; debTax: number; returned: number }>();
  for (const n of original.notes) {
    for (const l of n.lines) {
      if (!l.originalLineId) continue;
      const d = done.get(l.originalLineId) ?? { credTaxable: 0, credTax: 0, debTaxable: 0, debTax: 0, returned: 0 };
      const tax = l.cgst + l.sgst + l.igst;
      if (n.type === "CREDIT_NOTE") {
        d.credTaxable += l.taxable;
        d.credTax += tax;
        if (n.noteKind === "return" || n.noteKind === "cancel") d.returned += l.quantity;
      } else {
        d.debTaxable += l.taxable;
        d.debTax += tax;
      }
      done.set(l.originalLineId, d);
    }
  }
  const left = (l: InvoiceLine) => {
    const d = done.get(l.id) ?? { credTaxable: 0, credTax: 0, debTaxable: 0, debTax: 0, returned: 0 };
    return {
      value: l.taxable + d.debTaxable - d.credTaxable,
      tax: l.cgst + l.sgst + l.igst + d.debTax - d.credTax,
      qty: l.quantity - d.returned,
    };
  };

  const byId = new Map(original.lines.map((l) => [l.id, l]));
  const wanted: NoteLineInput[] =
    input.kind === "cancel" ? original.lines.map((l) => ({ lineId: l.id })) : input.lines;
  if (!wanted.length) throw new MoneyError("Pick at least one line");
  if (new Set(wanted.map((w) => w.lineId)).size !== wanted.length) throw new MoneyError("Each line can appear once");

  const drafts: Draft[] = [];
  for (const w of wanted) {
    const l = byId.get(w.lineId);
    if (!l) throw new MoneyError("That line isn't on this invoice");
    const rem = left(l);
    let quantity = 0;
    let taxable: number;
    if (input.kind === "cancel") {
      quantity = Math.max(rem.qty, 0);
      taxable = rem.value;
    } else if (input.kind === "return") {
      if (l.isService) throw new MoneyError(`${l.description} can't be returned; credit its value instead`);
      quantity = Number(w.quantity);
      if (!Number.isInteger(quantity) || quantity < 1) throw new MoneyError("Returned quantity must be a whole number");
      if (quantity > rem.qty) throw new MoneyError(`Only ${rem.qty} of ${l.description} can still be returned`);
      taxable = quantity === rem.qty ? rem.value : Math.min(rem.value, Math.round((l.taxable * quantity) / l.quantity));
    } else {
      taxable = Number(w.amount);
      if (!Number.isInteger(taxable) || taxable < 1) throw new MoneyError("Amounts must be whole paise above zero");
      if (credit && taxable > rem.value) throw new MoneyError(`${l.description}: only ${formatINR(rem.value)} can still be credited`);
      if (!credit && taxable > 1_000_000_000) throw new MoneyError("Amount is too large");
    }
    if (taxable < 0) taxable = 0;
    const tax = credit && taxable === rem.value ? Math.max(rem.tax, 0) : gstOn(taxable, l.gstRate);
    if (taxable === 0 && quantity === 0) continue;
    drafts.push({
      productId: l.productId,
      orderItemId: l.orderItemId,
      originalLineId: l.id,
      description: l.description,
      hsnCode: l.hsnCode,
      isService: l.isService,
      unit: l.unit,
      quantity,
      freeQty: l.freeQty > 0 && taxable === 0 ? quantity : 0,
      rate: quantity > 0 ? Math.round(taxable / quantity) : 0,
      gross: taxable,
      discount: 0,
      gstRate: l.gstRate,
      tax,
      mrp: l.mrp,
      caseSize: l.caseSize,
    });
  }
  const f = finalise(drafts, original.interState);
  if (f.total <= 0) throw new MoneyError(input.kind === "cancel" ? "Nothing is left on this invoice to credit" : "The note has no value");

  const { settings } = await sellerOf(ctx);
  const seller = original.seller as unknown as Party;
  const { fy, number } = await nextDocNumber(ctx, settings, input.type, now);
  const note = await ctx.tx.invoice.create({
    data: {
      type: input.type,
      number,
      fy,
      date: now,
      orderId: original.orderId,
      retailerId: original.retailerId,
      originalId: original.id,
      noteKind: input.kind,
      reason,
      seller: original.seller as Prisma.InputJsonValue,
      buyer: original.buyer as Prisma.InputJsonValue,
      b2b: original.b2b,
      placeOfSupply: original.placeOfSupply,
      interState: original.interState,
      taxable: f.taxable,
      cgst: f.cgst,
      sgst: f.sgst,
      igst: f.igst,
      total: f.total,
      createdById: ctx.actorId,
      einvStatus:
        original.type === "TAX_INVOICE" && einvoiceRequired(settings, input.type, original.b2b, seller.gstin) ? "PENDING" : "NOT_REQUIRED",
      lines: { create: f.lines },
    },
  });
  await invoiceWebhook(ctx.tx, ctx.tenantId, note.id);
  return { note, original };
}

// ───────────────────────────── reading ─────────────────────────────

export type RateRow = { rate: number; taxable: number; cgst: number; sgst: number; igst: number };

export function rateSummary(lines: Pick<InvoiceLine, "gstRate" | "taxable" | "cgst" | "sgst" | "igst">[]): RateRow[] {
  const m = new Map<number, RateRow>();
  for (const l of lines) {
    const r = m.get(l.gstRate) ?? { rate: l.gstRate, taxable: 0, cgst: 0, sgst: 0, igst: 0 };
    r.taxable += l.taxable;
    r.cgst += l.cgst;
    r.sgst += l.sgst;
    r.igst += l.igst;
    m.set(l.gstRate, r);
  }
  return [...m.values()].sort((a, b) => a.rate - b.rate);
}

export type InvoiceDoc = Invoice & {
  title: string;
  seller: Party;
  buyer: Party;
  lines: InvoiceLine[];
  rates: RateRow[];
  words: string;
  original: { id: string; number: string; date: Date } | null;
  notes: { id: string; type: InvoiceType; number: string; date: Date; total: number }[];
  order: { id: string; orderNumber: string; deliveryDate: Date | null; status: string } | null;
  settings: Pick<InvoiceSettings, "terms" | "bankName" | "bankAccount" | "bankIfsc" | "upiQr" | "ewayThreshold" | "layout">;
  /** Due date of this invoice's bill (sale invoices and debit notes). */
  dueDate: Date | null;
  /** Still unpaid on this invoice's bill (sale invoices and debit notes), paise. */
  due: number | null;
  ewayNeeded: boolean;
};

/** Everything needed to show, print or export one document. */
export async function loadInvoiceDoc(tx: Tx, id: string): Promise<InvoiceDoc | null> {
  const inv = await tx.invoice.findUnique({
    where: { id },
    include: {
      lines: { orderBy: { sl: "asc" } },
      original: { select: { id: true, number: true, date: true } },
      notes: { select: { id: true, type: true, number: true, date: true, total: true }, orderBy: { date: "asc" } },
      order: { select: { id: true, orderNumber: true, deliveryDate: true, status: true } },
      tenant: { select: { settings: true } },
    },
  });
  if (!inv) return null;
  const s = invoiceSettings(inv.tenant.settings);
  const bill = await tx.bill.findFirst({ where: { number: inv.number }, select: { amount: true, paid: true, dueDate: true } });
  const { tenant: _t, ...rest } = inv;
  void _t;
  return {
    ...rest,
    title: DOC_TITLE[inv.type],
    seller: inv.seller as unknown as Party,
    buyer: inv.buyer as unknown as Party,
    rates: rateSummary(inv.lines),
    words: amountInWords(inv.total),
    settings: { terms: s.terms, bankName: s.bankName, bankAccount: s.bankAccount, bankIfsc: s.bankIfsc, upiQr: s.upiQr, ewayThreshold: s.ewayThreshold, layout: s.layout },
    dueDate: bill?.dueDate ?? null,
    due: bill ? bill.amount - bill.paid : null,
    ewayNeeded: (inv.type === "TAX_INVOICE" || inv.type === "BILL_OF_SUPPLY") && inv.total >= s.ewayThreshold && !inv.ewbNo,
  };
}
