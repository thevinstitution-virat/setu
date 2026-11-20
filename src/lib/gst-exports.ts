import ExcelJS from "exceljs";
import type { Invoice, InvoiceLine, InvoiceType, PayMethod } from "@/generated/prisma/client";
import { ddMonyyyy, istParts, rupees, stateLabel, STATES } from "@/lib/gst";
import type { Party } from "@/lib/invoice";
import type { InvoiceSettings } from "@/lib/invoice-settings";

/**
 * Accountant exports built from issued documents:
 * - GSTR-1 workbook in the GST offline-tool sheet layout (b2b, b2cl, b2cs,
 *   cdnr, cdnur, exemp, hsn(b2b), hsn(b2c), docs);
 * - Tally XML (party ledgers + Sales / Credit Note / Debit Note / Receipt vouchers);
 * - sales register workbook (documents, items, tax by rate).
 * Pure functions over loaded rows, so they are unit tested without a database.
 */

export type ExportDoc = Invoice & {
  lines: InvoiceLine[];
  original: Pick<Invoice, "id" | "number" | "date" | "b2b" | "interState" | "total"> | null;
  order: { orderNumber: string } | null;
};

export type ExportReceipt = {
  number: string;
  date: Date;
  amount: number;
  method: PayMethod;
  reference: string | null;
  buyer: Party;
  retailerId: string;
  allocations: { billNumber: string; amount: number }[];
};

/** B2C invoices above this (inter-state) are reported invoice-wise (B2CL). */
export const B2CL_LIMIT = 1_00_000_00;

const isSale = (t: InvoiceType) => t === "TAX_INVOICE" || t === "BILL_OF_SUPPLY";
const sign = (d: Pick<Invoice, "type">) => (d.type === "CREDIT_NOTE" ? -1 : 1);
const isB2CL = (d: { b2b: boolean; interState: boolean; total: number }) => !d.b2b && d.interState && d.total > B2CL_LIMIT;
const party = (d: Invoice) => d.buyer as unknown as Party;

type RateAgg = { rate: number; taxable: number; igst: number; cgst: number; sgst: number };
function byRate(lines: InvoiceLine[], skipZero = true): RateAgg[] {
  const m = new Map<number, RateAgg>();
  for (const l of lines) {
    if (skipZero && l.gstRate === 0) continue;
    const r = m.get(l.gstRate) ?? { rate: l.gstRate, taxable: 0, igst: 0, cgst: 0, sgst: 0 };
    r.taxable += l.taxable;
    r.igst += l.igst;
    r.cgst += l.cgst;
    r.sgst += l.sgst;
    m.set(l.gstRate, r);
  }
  return [...m.values()].sort((a, b) => a.rate - b.rate);
}

function sheet(wb: ExcelJS.Workbook, name: string, headers: string[], rows: (string | number)[][]) {
  const ws = wb.addWorksheet(name);
  ws.addRow(headers).font = { bold: true };
  for (const r of rows) ws.addRow(r);
  ws.columns.forEach((c, i) => (c.width = Math.min(40, Math.max(12, headers[i]?.length ?? 10) + 2)));
  ws.views = [{ state: "frozen", ySplit: 1 }];
  return ws;
}

/** GSTR-1 rows by section (exported for tests). */
export function gstr1Sections(docs: ExportDoc[]) {
  const b2b: (string | number)[][] = [];
  const b2cl: (string | number)[][] = [];
  const cdnr: (string | number)[][] = [];
  const cdnur: (string | number)[][] = [];
  const b2cs = new Map<string, { pos: string; rate: number; taxable: number }>();
  const exemp = { interB2B: 0, intraB2B: 0, interB2C: 0, intraB2C: 0 };
  type H = { hsn: string; desc: string; uqc: string; qty: number; value: number; rate: number; taxable: number; igst: number; cgst: number; sgst: number };
  const hsn = { b2b: new Map<string, H>(), b2c: new Map<string, H>() };

  for (const d of docs) {
    const p = party(d);
    const pos = stateLabel(d.placeOfSupply);
    const s = sign(d);
    const rates = byRate(d.lines);
    // Nil-rated value (0% lines), net of credit notes.
    const nil = d.lines.filter((l) => l.gstRate === 0).reduce((a, l) => a + l.taxable, 0) * s;
    if (nil) exemp[`${d.interState ? "inter" : "intra"}${d.b2b ? "B2B" : "B2C"}` as keyof typeof exemp] += nil;

    // HSN summary (all lines, credit notes subtract).
    for (const l of d.lines) {
      const book = d.b2b ? hsn.b2b : hsn.b2c;
      const code = l.hsnCode ?? "";
      const k = `${code}|${l.gstRate}|${l.isService ? "NA" : l.unit}`;
      const h = book.get(k) ?? { hsn: code, desc: l.description.replace(/ \(free\)$/, ""), uqc: l.isService ? "NA" : l.unit, qty: 0, value: 0, rate: l.gstRate, taxable: 0, igst: 0, cgst: 0, sgst: 0 };
      h.qty += l.isService ? 0 : l.quantity * s;
      h.value += l.total * s;
      h.taxable += l.taxable * s;
      h.igst += l.igst * s;
      h.cgst += l.cgst * s;
      h.sgst += l.sgst * s;
      book.set(k, h);
    }

    if (isSale(d.type)) {
      if (d.type === "BILL_OF_SUPPLY") continue; // no GST charged: only exemp + HSN
      if (d.b2b) {
        for (const r of rates) b2b.push([p.gstin ?? "", p.legalName, d.number, ddMonyyyy(d.date), rupees(d.total), pos, "N", "", "Regular B2B", "", r.rate, rupees(r.taxable), 0]);
      } else if (isB2CL(d)) {
        for (const r of rates) b2cl.push([d.number, ddMonyyyy(d.date), rupees(d.total), pos, "", r.rate, rupees(r.taxable), 0, ""]);
      } else {
        for (const r of rates) {
          const k = `${d.placeOfSupply}|${r.rate}`;
          const a = b2cs.get(k) ?? { pos: d.placeOfSupply, rate: r.rate, taxable: 0 };
          a.taxable += r.taxable;
          b2cs.set(k, a);
        }
      }
      continue;
    }

    // Credit / debit notes
    const noteType = d.type === "CREDIT_NOTE" ? "C" : "D";
    if (d.b2b) {
      for (const r of rates) cdnr.push([p.gstin ?? "", p.legalName, d.number, ddMonyyyy(d.date), noteType, pos, "N", "Regular B2B", rupees(d.total), "", r.rate, rupees(r.taxable), 0]);
    } else if (d.original && isB2CL(d.original)) {
      for (const r of rates) cdnur.push(["B2CL", d.number, ddMonyyyy(d.date), noteType, pos, rupees(d.total), "", r.rate, rupees(r.taxable), 0]);
    } else {
      for (const r of rates) {
        const k = `${d.placeOfSupply}|${r.rate}`;
        const a = b2cs.get(k) ?? { pos: d.placeOfSupply, rate: r.rate, taxable: 0 };
        a.taxable += r.taxable * s;
        b2cs.set(k, a);
      }
    }
  }

  // Documents issued: first / last number and count per series.
  const series = new Map<string, { nature: string; nums: string[] }>();
  const NATURE: Record<InvoiceType, string> = {
    TAX_INVOICE: "Invoices for outward supply",
    BILL_OF_SUPPLY: "Bill of Supply",
    CREDIT_NOTE: "Credit Note",
    DEBIT_NOTE: "Debit Note",
  };
  for (const d of docs) {
    const k = `${d.type}|${d.number.replace(/\d+$/, "")}`;
    const s = series.get(k) ?? { nature: NATURE[d.type], nums: [] };
    s.nums.push(d.number);
    series.set(k, s);
  }
  const docsRows = [...series.values()].map((s) => {
    const sorted = [...s.nums].sort();
    return [s.nature, sorted[0], sorted[sorted.length - 1], sorted.length, 0];
  });

  const hsnRows = (m: Map<string, H>) =>
    [...m.values()]
      .sort((a, b) => a.hsn.localeCompare(b.hsn) || a.rate - b.rate)
      .map((h) => [h.hsn, h.desc, h.uqc, h.qty, rupees(h.value), h.rate, rupees(h.taxable), rupees(h.igst), rupees(h.cgst), rupees(h.sgst), 0]);

  return {
    b2b,
    b2cl,
    b2cs: [...b2cs.values()].filter((a) => a.taxable !== 0).map((a) => ["OE", stateLabel(a.pos), "", a.rate, rupees(a.taxable), 0, ""]),
    cdnr,
    cdnur,
    exemp: [
      ["Inter-State supplies to registered persons", rupees(exemp.interB2B), 0, 0],
      ["Intra-State supplies to registered persons", rupees(exemp.intraB2B), 0, 0],
      ["Inter-State supplies to unregistered persons", rupees(exemp.interB2C), 0, 0],
      ["Intra-State supplies to unregistered persons", rupees(exemp.intraB2C), 0, 0],
    ],
    hsnB2B: hsnRows(hsn.b2b),
    hsnB2C: hsnRows(hsn.b2c),
    docs: docsRows,
  };
}

export async function gstr1Workbook(docs: ExportDoc[]) {
  const s = gstr1Sections(docs);
  const wb = new ExcelJS.Workbook();
  wb.creator = "VBiz Pro";
  sheet(wb, "b2b", ["GSTIN/UIN of Recipient", "Receiver Name", "Invoice Number", "Invoice date", "Invoice Value", "Place Of Supply", "Reverse Charge", "Applicable % of Tax Rate", "Invoice Type", "E-Commerce GSTIN", "Rate", "Taxable Value", "Cess Amount"], s.b2b);
  sheet(wb, "b2cl", ["Invoice Number", "Invoice date", "Invoice Value", "Place Of Supply", "Applicable % of Tax Rate", "Rate", "Taxable Value", "Cess Amount", "E-Commerce GSTIN"], s.b2cl);
  sheet(wb, "b2cs", ["Type", "Place Of Supply", "Applicable % of Tax Rate", "Rate", "Taxable Value", "Cess Amount", "E-Commerce GSTIN"], s.b2cs);
  sheet(wb, "cdnr", ["GSTIN/UIN of Recipient", "Receiver Name", "Note Number", "Note Date", "Note Type", "Place Of Supply", "Reverse Charge", "Note Supply Type", "Note Value", "Applicable % of Tax Rate", "Rate", "Taxable Value", "Cess Amount"], s.cdnr);
  sheet(wb, "cdnur", ["UR Type", "Note Number", "Note Date", "Note Type", "Place Of Supply", "Note Value", "Applicable % of Tax Rate", "Rate", "Taxable Value", "Cess Amount"], s.cdnur);
  sheet(wb, "exemp", ["Description", "Nil Rated Supplies", "Exempted(other than nil rated/non GST supply)", "Non-GST Supplies"], s.exemp);
  const hsnHead = ["HSN", "Description", "UQC", "Total Quantity", "Total Value", "Rate", "Taxable Value", "Integrated Tax Amount", "Central Tax Amount", "State/UT Tax Amount", "Cess Amount"];
  sheet(wb, "hsn(b2b)", hsnHead, s.hsnB2B);
  sheet(wb, "hsn(b2c)", hsnHead, s.hsnB2C);
  sheet(wb, "docs", ["Nature of Document", "Sr. No. From", "Sr. No. To", "Total Number", "Cancelled"], s.docs);
  return Buffer.from(await wb.xlsx.writeBuffer());
}

export async function salesRegisterWorkbook(docs: ExportDoc[]) {
  const wb = new ExcelJS.Workbook();
  wb.creator = "VBiz Pro";
  const TYPE: Record<InvoiceType, string> = { TAX_INVOICE: "Tax invoice", BILL_OF_SUPPLY: "Bill of supply", CREDIT_NOTE: "Credit note", DEBIT_NOTE: "Debit note" };
  sheet(
    wb,
    "Register",
    ["Date", "Number", "Type", "Party", "GSTIN", "Place of supply", "Taxable", "CGST", "SGST", "IGST", "Total", "Order", "Against", "Reason", "e-Invoice", "IRN", "E-way bill"],
    docs.map((d) => {
      const s = sign(d);
      const p = party(d);
      return [ddMonyyyy(d.date), d.number, TYPE[d.type], p.legalName, p.gstin ?? "", stateLabel(d.placeOfSupply), rupees(d.taxable * s), rupees(d.cgst * s), rupees(d.sgst * s), rupees(d.igst * s), rupees(d.total * s), d.order?.orderNumber ?? "", d.original?.number ?? "", d.reason ?? "", d.einvStatus, d.irn ?? "", d.ewbNo ?? ""];
    })
  );
  sheet(
    wb,
    "Items",
    ["Date", "Number", "Type", "Party", "Item", "HSN/SAC", "Qty", "Free qty", "Unit", "Rate", "Discount", "Taxable", "GST %", "CGST", "SGST", "IGST", "Total"],
    docs.flatMap((d) => {
      const s = sign(d);
      return d.lines.map((l) => [ddMonyyyy(d.date), d.number, TYPE[d.type], party(d).legalName, l.description, l.hsnCode ?? "", l.quantity * s, l.freeQty * s, l.unit, rupees(l.rate), rupees(l.discount * s), rupees(l.taxable * s), l.gstRate, rupees(l.cgst * s), rupees(l.sgst * s), rupees(l.igst * s), rupees(l.total * s)]);
    })
  );
  const rates = new Map<number, { taxable: number; cgst: number; sgst: number; igst: number }>();
  for (const d of docs) {
    for (const l of d.lines) {
      const r = rates.get(l.gstRate) ?? { taxable: 0, cgst: 0, sgst: 0, igst: 0 };
      const s = sign(d);
      r.taxable += l.taxable * s;
      r.cgst += l.cgst * s;
      r.sgst += l.sgst * s;
      r.igst += l.igst * s;
      rates.set(l.gstRate, r);
    }
  }
  sheet(
    wb,
    "By GST rate",
    ["GST %", "Taxable (net)", "CGST", "SGST", "IGST", "Total tax"],
    [...rates.entries()].sort((a, b) => a[0] - b[0]).map(([rate, r]) => [rate, rupees(r.taxable), rupees(r.cgst), rupees(r.sgst), rupees(r.igst), rupees(r.cgst + r.sgst + r.igst)])
  );
  return Buffer.from(await wb.xlsx.writeBuffer());
}

// ───────────────────────────── Tally ─────────────────────────────

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&apos;");
const amt = (paise: number) => (paise / 100).toFixed(2);
function tallyDate(d: Date) {
  const { y, m, day } = istParts(d);
  return `${y}${String(m).padStart(2, "0")}${String(day).padStart(2, "0")}`;
}
/** "Sales @{rate}%" → "Sales @18%"; a plain name is used as is. */
const withRate = (name: string, rate: number) => name.replace("{rate}", String(rate));

/** Unique Tally ledger name per retailer (same shop names get the phone's last 4 digits). */
export function partyNames(parties: { retailerId: string; buyer: Party }[]) {
  const byName = new Map<string, Set<string>>();
  for (const p of parties) {
    const n = p.buyer.legalName.trim();
    byName.set(n, (byName.get(n) ?? new Set()).add(p.retailerId));
  }
  const out = new Map<string, string>();
  for (const p of parties) {
    const n = p.buyer.legalName.trim();
    const clash = (byName.get(n)?.size ?? 0) > 1;
    out.set(p.retailerId, clash ? `${n} - ${(p.buyer.phone ?? p.retailerId).slice(-4)}` : n);
  }
  return out;
}

function entry(ledger: string, debit: boolean, paise: number, bills?: { name: string; type: "New Ref" | "Agst Ref" | "On Account"; amount: number }[]) {
  // Tally XML: debit amounts are negative with ISDEEMEDPOSITIVE Yes; credits positive with No.
  const a = debit ? `-${amt(paise)}` : amt(paise);
  const bl = (bills ?? [])
    .map((b) => `<BILLALLOCATIONS.LIST><NAME>${esc(b.name)}</NAME><BILLTYPE>${b.type}</BILLTYPE><AMOUNT>${debit ? `-${amt(b.amount)}` : amt(b.amount)}</AMOUNT></BILLALLOCATIONS.LIST>`)
    .join("");
  return `<ALLLEDGERENTRIES.LIST><LEDGERNAME>${esc(ledger)}</LEDGERNAME><ISDEEMEDPOSITIVE>${debit ? "Yes" : "No"}</ISDEEMEDPOSITIVE><AMOUNT>${a}</AMOUNT>${bl}</ALLLEDGERENTRIES.LIST>`;
}

export function tallyXml(docs: ExportDoc[], receipts: ExportReceipt[], t: InvoiceSettings["tally"], opts: { company?: string; masters?: boolean } = {}) {
  const names = partyNames([...docs.map((d) => ({ retailerId: d.retailerId, buyer: party(d) })), ...receipts.map((r) => ({ retailerId: r.retailerId, buyer: r.buyer }))]);
  const msgs: string[] = [];

  if (opts.masters !== false) {
    const seen = new Set<string>();
    for (const p of [...docs.map((d) => ({ id: d.retailerId, b: party(d) })), ...receipts.map((r) => ({ id: r.retailerId, b: r.buyer }))]) {
      const name = names.get(p.id)!;
      if (seen.has(name)) continue;
      seen.add(name);
      const state = STATES[p.b.stateCode] ?? "";
      msgs.push(
        `<LEDGER NAME="${esc(name)}" ACTION="Create"><NAME.LIST><NAME>${esc(name)}</NAME></NAME.LIST><PARENT>${esc(t.debtorsGroup)}</PARENT><ISBILLWISEON>Yes</ISBILLWISEON>` +
          `<ADDRESS.LIST><ADDRESS>${esc(p.b.address)}</ADDRESS></ADDRESS.LIST><PINCODE>${esc(p.b.pinCode)}</PINCODE><LEDSTATENAME>${esc(state)}</LEDSTATENAME><COUNTRYNAME>India</COUNTRYNAME>` +
          `<GSTREGISTRATIONTYPE>${p.b.gstin ? "Regular" : "Unregistered/Consumer"}</GSTREGISTRATIONTYPE>${p.b.gstin ? `<PARTYGSTIN>${esc(p.b.gstin)}</PARTYGSTIN>` : ""}` +
          `${p.b.phone ? `<LEDGERPHONE>${esc(p.b.phone)}</LEDGERPHONE>` : ""}</LEDGER>`
      );
    }
    const rates = new Set(docs.flatMap((d) => d.lines.map((l) => l.gstRate)));
    const salesLedgers = new Set([...rates].flatMap((r) => [withRate(t.sales, r), withRate(t.salesReturns, r)]));
    for (const s of salesLedgers) msgs.push(`<LEDGER NAME="${esc(s)}" ACTION="Create"><NAME.LIST><NAME>${esc(s)}</NAME></NAME.LIST><PARENT>Sales Accounts</PARENT></LEDGER>`);
    for (const [name, head] of [[t.cgst, "Central Tax"], [t.sgst, "State Tax"], [t.igst, "Integrated Tax"]] as const) {
      msgs.push(`<LEDGER NAME="${esc(name)}" ACTION="Create"><NAME.LIST><NAME>${esc(name)}</NAME></NAME.LIST><PARENT>Duties &amp; Taxes</PARENT><TAXTYPE>GST</TAXTYPE><GSTDUTYHEAD>${head}</GSTDUTYHEAD></LEDGER>`);
    }
    if (receipts.some((r) => r.method !== "CASH")) {
      msgs.push(`<LEDGER NAME="${esc(t.bank)}" ACTION="Create"><NAME.LIST><NAME>${esc(t.bank)}</NAME></NAME.LIST><PARENT>Bank Accounts</PARENT></LEDGER>`);
    }
  }

  for (const d of docs) {
    const p = party(d);
    const name = names.get(d.retailerId)!;
    const state = STATES[d.placeOfSupply] ?? "";
    const credit = d.type === "CREDIT_NOTE";
    const vtype = credit ? "Credit Note" : d.type === "DEBIT_NOTE" ? "Debit Note" : "Sales";
    const bill = credit
      ? [{ name: d.original?.number ?? d.number, type: "Agst Ref" as const, amount: d.total }]
      : [{ name: d.number, type: "New Ref" as const, amount: d.total }];
    const lines: string[] = [entry(name, !credit, d.total, bill)];
    const salesByRate = new Map<number, number>();
    for (const l of d.lines) salesByRate.set(l.gstRate, (salesByRate.get(l.gstRate) ?? 0) + l.taxable);
    for (const [rate, v] of salesByRate) if (v) lines.push(entry(withRate(credit ? t.salesReturns : t.sales, rate), credit, v));
    if (d.cgst) lines.push(entry(t.cgst, credit, d.cgst));
    if (d.sgst) lines.push(entry(t.sgst, credit, d.sgst));
    if (d.igst) lines.push(entry(t.igst, credit, d.igst));
    const narration = [d.order ? `Order ${d.order.orderNumber}` : "", d.original ? `Against ${d.original.number}` : "", d.reason ?? "", d.irn ? `IRN ${d.irn}` : ""].filter(Boolean).join(". ");
    msgs.push(
      `<VOUCHER VCHTYPE="${vtype}" ACTION="Create" OBJVIEW="Accounting Voucher View"><DATE>${tallyDate(d.date)}</DATE><VOUCHERTYPENAME>${vtype}</VOUCHERTYPENAME>` +
        `<VOUCHERNUMBER>${esc(d.number)}</VOUCHERNUMBER><REFERENCE>${esc(d.original?.number ?? d.order?.orderNumber ?? "")}</REFERENCE><PARTYLEDGERNAME>${esc(name)}</PARTYLEDGERNAME>` +
        `${p.gstin ? `<PARTYGSTIN>${esc(p.gstin)}</PARTYGSTIN>` : ""}<PLACEOFSUPPLY>${esc(state)}</PLACEOFSUPPLY><STATENAME>${esc(state)}</STATENAME>` +
        `<NARRATION>${esc(narration)}</NARRATION><ISINVOICE>No</ISINVOICE>${lines.join("")}</VOUCHER>`
    );
  }

  for (const r of receipts) {
    const name = names.get(r.retailerId)!;
    const allocated = r.allocations.reduce((a, x) => a + x.amount, 0);
    const bills: { name: string; type: "Agst Ref" | "On Account"; amount: number }[] = r.allocations.map((a) => ({ name: a.billNumber, type: "Agst Ref", amount: a.amount }));
    if (r.amount > allocated) bills.push({ name: r.number, type: "On Account", amount: r.amount - allocated });
    msgs.push(
      `<VOUCHER VCHTYPE="Receipt" ACTION="Create" OBJVIEW="Accounting Voucher View"><DATE>${tallyDate(r.date)}</DATE><VOUCHERTYPENAME>Receipt</VOUCHERTYPENAME>` +
        `<VOUCHERNUMBER>${esc(r.number)}</VOUCHERNUMBER><PARTYLEDGERNAME>${esc(name)}</PARTYLEDGERNAME>` +
        `<NARRATION>${esc(`${r.method}${r.reference ? ` ${r.reference}` : ""}`)}</NARRATION>` +
        entry(r.method === "CASH" ? t.cash : t.bank, true, r.amount) +
        entry(name, false, r.amount, bills) +
        `</VOUCHER>`
    );
  }

  const company = opts.company ? `<STATICVARIABLES><SVCURRENTCOMPANY>${esc(opts.company)}</SVCURRENTCOMPANY></STATICVARIABLES>` : "";
  return (
    `<?xml version="1.0" encoding="UTF-8"?>\n<ENVELOPE><HEADER><TALLYREQUEST>Import Data</TALLYREQUEST></HEADER><BODY><IMPORTDATA>` +
    `<REQUESTDESC><REPORTNAME>Vouchers</REPORTNAME>${company}</REQUESTDESC><REQUESTDATA>` +
    msgs.map((m) => `\n<TALLYMESSAGE xmlns:UDF="TallyUDF">${m}</TALLYMESSAGE>`).join("") +
    `\n</REQUESTDATA></IMPORTDATA></BODY></ENVELOPE>\n`
  );
}
