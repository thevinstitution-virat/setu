/**
 * Phase 3 pure tests: GST helpers, IRN formula and e-invoice JSON, GSTR-1
 * sections and Tally XML built from in-memory documents.
 */
import { describe, expect, it } from "vitest";
import {
  amountInWords,
  creditNoteDeadline,
  ddmmyyyy,
  docNumber,
  fyCode,
  fyName,
  gstinCheckDigit,
  splitTax,
  stateLabel,
  uqc,
  validGstin,
} from "@/lib/gst";
import { irnFor, buildIrnPayload, einvoiceProblems } from "@/lib/einvoice";
import { gstr1Sections, partyNames, tallyXml, type ExportDoc } from "@/lib/gst-exports";
import { INVOICE_DEFAULTS, parseInvoiceSettings } from "@/lib/invoice-settings";
import { orderDrafts, rateSummary, type InvoiceDoc, type Party } from "@/lib/invoice";
import { openShareToken, SHARE_DAYS, shareToken } from "@/lib/invoice-api";
import { createHmac } from "node:crypto";

const gstin = (p: string) => `${p}${gstinCheckDigit(p)}`;
const SELLER = gstin("27ZZDEM0001A1Z");
const BUYER = gstin("27ZZAGR0001B1Z");

describe("GSTIN", () => {
  it("accepts a correct check digit and rejects a wrong one", () => {
    expect(validGstin(SELLER)).toBe(true);
    const wrong = SELLER.slice(0, 14) + (SELLER[14] === "A" ? "B" : "A");
    expect(validGstin(wrong)).toBe(false);
    expect(validGstin("99ZZDEM0001A1ZX")).toBe(false); // no state 99
    expect(validGstin("27zzdem0001a1z5")).toBe(false); // lower case
  });
});

describe("tax split, years, numbers", () => {
  it("splits intra-state tax into CGST + SGST that always add up", () => {
    expect(splitTax(101, false)).toEqual({ cgst: 51, sgst: 50, igst: 0 });
    expect(splitTax(100, true)).toEqual({ cgst: 0, sgst: 0, igst: 100 });
  });
  it("uses Indian time for the financial year", () => {
    // 31 March 2027 20:00 UTC is 1 April 01:30 IST → new year.
    expect(fyCode(new Date("2027-03-31T20:00:00Z"))).toBe("2728");
    expect(fyCode(new Date("2027-03-31T18:00:00Z"))).toBe("2627");
    expect(fyName(new Date("2026-11-19T10:00:00Z"))).toBe("2026-27");
    expect(ddmmyyyy(new Date("2026-11-18T19:00:00Z"))).toBe("19/11/2026");
  });
  it("credit notes for FY 2026-27 close on 30 Nov 2027", () => {
    const d = creditNoteDeadline(new Date("2026-11-19T10:00:00Z"));
    expect(d.toISOString()).toBe("2027-11-30T18:29:59.000Z");
  });
  it("document numbers fit GST's 16 characters", () => {
    expect(docNumber("INV", "2627", 42)).toBe("INV2627-00042");
    expect(() => docNumber("ABCDEFG", "2627", 1)).toThrow();
  });
  it("maps units to UQC and writes amounts in Indian words", () => {
    expect(uqc("pc")).toBe("PCS");
    expect(uqc("Pkt")).toBe("PAC");
    expect(uqc("kg")).toBe("KGS");
    expect(uqc("tray")).toBe("OTH");
    expect(amountInWords(204930)).toBe("Rupees Two Thousand Forty Nine and Thirty Paise Only");
    expect(amountInWords(1_25_00_000_00)).toBe("Rupees One Crore Twenty Five Lakh Only");
    expect(stateLabel("27")).toBe("27-Maharashtra");
  });
});

describe("invoice settings", () => {
  it("validates prefixes, PIN and IFSC", () => {
    expect(parseInvoiceSettings({ prefixes: { tax: "inv2" } }, INVOICE_DEFAULTS)).toMatchObject({ prefixes: { tax: "INV2" } });
    expect(parseInvoiceSettings({ prefixes: { tax: "CN" } }, INVOICE_DEFAULTS)).toBe("Each document type needs its own prefix");
    expect(parseInvoiceSettings({ pinCode: "12345" }, INVOICE_DEFAULTS)).toBe("PIN code must be 6 digits");
    expect(parseInvoiceSettings({ bankIfsc: "HDFC0001234" }, INVOICE_DEFAULTS)).toEqual({ bankIfsc: "HDFC0001234" });
    expect(parseInvoiceSettings({ einvoice: { enabled: true } }, INVOICE_DEFAULTS)).toEqual({ einvoice: { enabled: true, provider: "sandbox" } });
  });
});

describe("order lines → invoice lines", () => {
  const order = {
    orderNumber: "SO-T",
    subtotal: 2 * 10000 - 500 + 3000,
    gstAmount: Math.round((19500 * 5) / 100) + Math.round((3000 * 18) / 100),
    deliveryCharge: 3000,
    deliveryGstRate: 18,
    items: [
      { id: "i1", productId: "p1", quantity: 2, price: 10000, gstRate: 5, discount: 500, freeSchemeId: null, product: { name: "Tea", hsnCode: "0902", unit: "pc" } },
      { id: "i2", productId: "p1", quantity: 1, price: 0, gstRate: 5, discount: 0, freeSchemeId: "s1", product: { name: "Tea", hsnCode: "0902", unit: "pc" } },
    ],
  };
  it("adds free goods at no value and the delivery charge with its SAC", () => {
    const d = orderDrafts(order, INVOICE_DEFAULTS);
    expect(d.map((x) => [x.description, x.gross - x.discount, x.tax, x.freeQty])).toEqual([
      ["Tea", 19500, 975, 0],
      ["Tea (free)", 0, 0, 1],
      ["Delivery charges", 3000, 540, 0],
    ]);
    expect(d[2].hsnCode).toBe("996511");
  });
  it("refuses an order whose lines don't add up", () => {
    expect(() => orderDrafts({ ...order, gstAmount: order.gstAmount + 1 }, INVOICE_DEFAULTS)).toThrow(/doesn't add up/);
  });
});

const party = (over: Partial<Party> = {}): Party => ({
  legalName: "Agarwal General Store",
  tradeName: "Agarwal General Store",
  gstin: BUYER,
  stateCode: "27",
  address: "G-12, Shree Complex, Andheri",
  city: "Andheri",
  pinCode: "400058",
  phone: "9876543210",
  ...over,
});
const sellerParty = party({ legalName: "Setu Demo", tradeName: "Setu Demo", gstin: SELLER, pinCode: "400093", city: "Mumbai", phone: null });

let lid = 0;
function line(rate: number, taxable: number, inter: boolean, over: Record<string, unknown> = {}) {
  const tax = Math.round((taxable * rate) / 100);
  const s = splitTax(tax, inter);
  return { id: `l${++lid}`, tenantId: "t", invoiceId: "x", sl: lid, productId: "p", orderItemId: null, originalLineId: null, description: "Masala Chai", hsnCode: "0902", isService: false, unit: "PCS", quantity: 10, freeQty: 0, rate: taxable / 10, gross: taxable, discount: 0, taxable, gstRate: rate, ...s, total: taxable + tax, ...over };
}
function doc(type: ExportDoc["type"], number: string, lines: ReturnType<typeof line>[], over: Partial<ExportDoc> = {}): ExportDoc {
  const sum = (k: "taxable" | "cgst" | "sgst" | "igst" | "total") => lines.reduce((a, l) => a + (l[k] as number), 0);
  const inter = lines.some((l) => l.igst > 0);
  return {
    id: number, tenantId: "t", type, number, fy: "2627", date: new Date("2026-11-19T06:00:00Z"), orderId: null, retailerId: "r1",
    originalId: null, noteKind: null, reason: null, seller: sellerParty as never, buyer: party() as never, b2b: true, placeOfSupply: inter ? "24" : "27",
    interState: inter, taxable: sum("taxable"), cgst: sum("cgst"), sgst: sum("sgst"), igst: sum("igst"), roundOff: 0, total: sum("total"), entryId: null, createdById: null,
    createdAt: new Date(), updatedAt: new Date(), einvStatus: "NOT_REQUIRED", irn: null, ackNo: null, ackDate: null, signedQr: null, einvError: null,
    einvAttempts: 0, shareVersion: 0, einvCancelledAt: null, ewbNo: null, ewbDate: null, ewbValidUntil: null, ewbVehicle: null, ewbDistanceKm: null, salesman: null,
    lines: lines as never, original: null, order: { orderNumber: "SO-1" }, ...over,
  };
}

describe("GSTR-1 sections", () => {
  const b2b = doc("TAX_INVOICE", "INV2627-00001", [line(5, 100000, false), line(18, 50000, false), line(0, 20000, false)]);
  const b2cSmall = doc("TAX_INVOICE", "INV2627-00002", [line(5, 40000, false)], { b2b: false, buyer: party({ gstin: null }) as never, retailerId: "r2" });
  const b2cLarge = doc("TAX_INVOICE", "INV2627-00003", [line(18, 15000000, true)], { b2b: false, buyer: party({ gstin: null, stateCode: "24" }) as never, retailerId: "r3" });
  const cnB2B = doc("CREDIT_NOTE", "CN2627-00001", [line(5, 10000, false, { quantity: 1 })], { original: { id: "INV2627-00001", number: "INV2627-00001", date: b2b.date, b2b: true, interState: false, total: b2b.total } });
  const cnB2C = doc("CREDIT_NOTE", "CN2627-00002", [line(5, 4000, false, { quantity: 1 })], { b2b: false, buyer: party({ gstin: null }) as never, retailerId: "r2", original: { id: "x", number: "INV2627-00002", date: b2b.date, b2b: false, interState: false, total: b2cSmall.total } });
  const s = gstr1Sections([b2b, b2cSmall, b2cLarge, cnB2B, cnB2C]);

  it("puts B2B invoices rate-wise in b2b, without nil-rated lines", () => {
    expect(s.b2b.map((r) => [r[2], r[10], r[11]])).toEqual([
      ["INV2627-00001", 5, 1000],
      ["INV2627-00001", 18, 500],
    ]);
    expect(s.exemp[1][1]).toBe(200); // intra-state to registered: ₹200 nil-rated
  });
  it("big inter-state B2C goes to b2cl, the rest nets into b2cs", () => {
    expect(s.b2cl.map((r) => r[0])).toEqual(["INV2627-00003"]);
    expect(s.b2cs).toEqual([["OE", "27-Maharashtra", "", 5, 360, 0, ""]]); // 400 − 40 credit note
  });
  it("B2B credit notes go to cdnr; HSN summary nets them out", () => {
    expect(s.cdnr.map((r) => [r[2], r[4], r[11]])).toEqual([["CN2627-00001", "C", 100]]);
    const tea5 = s.hsnB2B.find((r) => r[0] === "0902" && r[5] === 5)!;
    expect(tea5[3]).toBe(9); // 10 sold − 1 returned
    expect(tea5[6]).toBe(900);
  });
  it("lists document series with counts", () => {
    expect(s.docs).toEqual([
      ["Invoices for outward supply", "INV2627-00001", "INV2627-00003", 3, 0],
      ["Credit Note", "CN2627-00001", "CN2627-00002", 2, 0],
    ]);
  });

  it("Tally XML: balanced sales and credit note vouchers, unique party ledgers", () => {
    const xml = tallyXml([b2b, cnB2B], [], { ...INVOICE_DEFAULTS.tally, sales: "Sales @{rate}%" });
    expect(xml).toContain('<VOUCHER VCHTYPE="Sales"');
    expect(xml).toContain("<VOUCHERNUMBER>INV2627-00001</VOUCHERNUMBER>");
    expect(xml).toContain("<LEDGERNAME>Sales @18%</LEDGERNAME>");
    expect(xml).toContain("<BILLTYPE>Agst Ref</BILLTYPE>");
    // Each voucher's amounts sum to zero (debits negative in Tally).
    for (const v of xml.match(/<VOUCHER [\s\S]*?<\/VOUCHER>/g)!) {
      const amounts = [...v.matchAll(/<ALLLEDGERENTRIES\.LIST>.*?<AMOUNT>(-?[\d.]+)<\/AMOUNT>/g)].map((m) => Number(m[1]));
      expect(Math.round(amounts.reduce((a, b) => a + b, 0) * 100)).toBe(0);
    }
    const names = partyNames([
      { retailerId: "a", buyer: party({ phone: "9000000001" }) },
      { retailerId: "b", buyer: party({ phone: "9000000002" }) },
    ]);
    expect(names.get("a")).not.toBe(names.get("b"));
  });
});

describe("e-invoice", () => {
  it("IRN is SHA-256 of GSTIN + year + type + number", () => {
    const irn = irnFor(SELLER, new Date("2026-11-19T06:00:00Z"), "TAX_INVOICE", "INV2627-00001");
    expect(irn).toMatch(/^[0-9a-f]{64}$/);
    expect(irn).not.toBe(irnFor(SELLER, new Date("2026-11-19T06:00:00Z"), "CREDIT_NOTE", "INV2627-00001"));
  });
  it("builds schema 1.1 JSON that adds up, with the original for notes", () => {
    const inv = doc("TAX_INVOICE", "INV2627-00009", [line(5, 100000, false)]);
    const d = { ...inv, seller: sellerParty, buyer: party(), rates: rateSummary(inv.lines), title: "Tax Invoice", words: "", notes: [], order: null, settings: {} as never, due: null, ewayNeeded: false } as unknown as InvoiceDoc;
    expect(einvoiceProblems(d)).toEqual([]);
    const p = buildIrnPayload(d) as Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
    expect(p.Version).toBe("1.1");
    expect(p.DocDtls).toEqual({ Typ: "INV", No: "INV2627-00009", Dt: "19/11/2026" });
    expect(p.ValDtls.TotInvVal).toBe(1050);
    expect(p.ItemList[0]).toMatchObject({ HsnCd: "0902", AssAmt: 1000, CgstAmt: 25, SgstAmt: 25, TotItemVal: 1050 });
    const cn = { ...d, type: "CREDIT_NOTE", original: { id: "o", number: "INV2627-00001", date: d.date } } as InvoiceDoc;
    expect((buildIrnPayload(cn) as Record<string, any>).RefDtls.PrecDocDtls[0].InvNo).toBe("INV2627-00001"); // eslint-disable-line @typescript-eslint/no-explicit-any
    expect(einvoiceProblems({ ...d, buyer: party({ gstin: null, pinCode: "" }) } as InvoiceDoc)).toHaveLength(2);
  });
});

describe("share links", () => {
  // The document's row as openShareToken reads it.
  const row = { shareVersion: 0, createdAt: new Date() };
  const db = { invoice: { findUnique: async () => row } } as unknown as Parameters<typeof openShareToken>[0];
  const ID = "cmabc1234567890";

  it("only the business's own token for that document works", async () => {
    const t = shareToken("tenantA", ID);
    expect(await openShareToken(db, "tenantA", t)).toBe(ID);
    expect(await openShareToken(db, "tenantB", t)).toBeNull();
    expect(await openShareToken(db, "tenantA", t.replace(/.$/, (c) => (c === "A" ? "B" : "A")))).toBeNull();
    expect(await openShareToken(db, "tenantA", "../etc.x")).toBeNull();
  });

  it("expires, and stops when links are stopped", async () => {
    const t = shareToken("tenantA", ID);
    expect(await openShareToken(db, "tenantA", t, new Date(Date.now() + (SHARE_DAYS - 1) * 86_400_000))).toBe(ID);
    expect(await openShareToken(db, "tenantA", t, new Date(Date.now() + (SHARE_DAYS + 2) * 86_400_000))).toBeNull();
    // A changed expiry breaks the signature.
    const [id, , s] = t.split(".");
    expect(await openShareToken(db, "tenantA", `${id}.${(99999).toString(36)}.${s}`)).toBeNull();
    row.shareVersion = 1;
    expect(await openShareToken(db, "tenantA", t)).toBeNull();
    expect(await openShareToken(db, "tenantA", shareToken("tenantA", ID, 1))).toBe(ID);
    row.shareVersion = 0;
  });

  it("old links without an expiry last 90 days from the document, until links are stopped", async () => {
    const legacy = `${ID}.${createHmac("sha256", process.env.SESSION_SECRET ?? "setu-dev-secret-change-me").update(`invoice-share:tenantA:${ID}`).digest("base64url").slice(0, 24)}`;
    expect(await openShareToken(db, "tenantA", legacy)).toBe(ID);
    expect(await openShareToken(db, "tenantA", legacy, new Date(Date.now() + 91 * 86_400_000))).toBeNull();
    row.shareVersion = 1;
    expect(await openShareToken(db, "tenantA", legacy)).toBeNull();
    row.shareVersion = 0;
  });
});
