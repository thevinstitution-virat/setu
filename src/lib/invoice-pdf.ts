import { readFile } from "node:fs/promises";
import path from "node:path";
import { PDFDocument, rgb, type PDFFont, type PDFPage, type PDFImage } from "pdf-lib";
import fontkit from "@pdf-lib/fontkit";
import QRCode from "qrcode";
import { formatINR } from "@/lib/money";
import { stateLabel, ddMonyyyy } from "@/lib/gst";
import type { InvoiceDoc, Party } from "@/lib/invoice";
import { upiLink } from "@/lib/money-settings";

/**
 * A4 invoice / note PDF, drawn with pdf-lib (no browser needed). Fonts: Geist
 * (SIL OFL, assets/fonts) — it has the ₹ sign. English only for now; product
 * names print in English.
 */

const W = 595.28;
const H = 841.89;
const M = 36;
const INK = rgb(0.12, 0.12, 0.14);
const MUTED = rgb(0.42, 0.42, 0.46);
const LINE = rgb(0.85, 0.85, 0.87);
const BAND = rgb(0.97, 0.96, 0.95);

function hex(c: string | undefined, fallback = "#db5c17") {
  const m = /^#?([0-9a-f]{6})$/i.exec(c ?? "") ?? /^#?([0-9a-f]{6})$/i.exec(fallback)!;
  const n = parseInt(m[1], 16);
  return rgb(((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255);
}

let fontCache: Promise<[Uint8Array, Uint8Array]> | null = null;
function fontBytes() {
  const load = (f: string) => readFile(path.join(process.cwd(), "assets", "fonts", f)).then((b) => new Uint8Array(b));
  fontCache ??= Promise.all([load("Geist-Regular.ttf"), load("Geist-SemiBold.ttf")]);
  return fontCache;
}

const money = (p: number) => formatINR(p, { symbol: false });

type Ctx = { pdf: PDFDocument; page: PDFPage; y: number; reg: PDFFont; bold: PDFFont; accent: ReturnType<typeof rgb> };

function text(c: Ctx, s: string, x: number, y: number, o: { size?: number; bold?: boolean; color?: ReturnType<typeof rgb>; align?: "left" | "right" | "center"; width?: number } = {}) {
  const size = o.size ?? 9;
  const font = o.bold ? c.bold : c.reg;
  let dx = x;
  if (o.align && o.align !== "left" && o.width) {
    const w = font.widthOfTextAtSize(s, size);
    dx = o.align === "right" ? x + o.width - w : x + (o.width - w) / 2;
  }
  c.page.drawText(s, { x: dx, y, size, font, color: o.color ?? INK });
}

/** Word-wrap to a width. */
function wrap(font: PDFFont, s: string, size: number, width: number): string[] {
  const out: string[] = [];
  for (const para of (s ?? "").split("\n")) {
    let line = "";
    for (const word of para.split(/\s+/).filter(Boolean)) {
      const next = line ? `${line} ${word}` : word;
      if (font.widthOfTextAtSize(next, size) <= width) line = next;
      else {
        if (line) out.push(line);
        // A single word longer than the width (an IRN): hard-break it.
        let w = word;
        while (font.widthOfTextAtSize(w, size) > width) {
          let i = w.length;
          while (i > 1 && font.widthOfTextAtSize(w.slice(0, i), size) > width) i--;
          out.push(w.slice(0, i));
          w = w.slice(i);
        }
        line = w;
      }
    }
    out.push(line);
  }
  return out;
}

function hline(c: Ctx, y: number, x1 = M, x2 = W - M) {
  c.page.drawLine({ start: { x: x1, y }, end: { x: x2, y }, thickness: 0.6, color: LINE });
}

function partyBlock(c: Ctx, label: string, p: Party, x: number, y: number, width: number) {
  text(c, label.toUpperCase(), x, y, { size: 7, color: MUTED, bold: true });
  y -= 13;
  text(c, p.legalName, x, y, { size: 10, bold: true });
  y -= 12;
  if (p.tradeName && p.tradeName !== p.legalName) {
    text(c, p.tradeName, x, y, { size: 8.5, color: MUTED });
    y -= 11;
  }
  for (const l of wrap(c.reg, [p.address, [p.city, p.pinCode].filter(Boolean).join(" ")].filter(Boolean).join(", "), 8.5, width)) {
    text(c, l, x, y, { size: 8.5 });
    y -= 11;
  }
  text(c, `State: ${stateLabel(p.stateCode)}`, x, y, { size: 8.5 });
  y -= 11;
  text(c, p.gstin ? `GSTIN: ${p.gstin}` : "GSTIN: Unregistered", x, y, { size: 8.5, bold: !!p.gstin });
  y -= 11;
  if (p.phone) {
    text(c, `Phone: ${p.phone}`, x, y, { size: 8.5 });
    y -= 11;
  }
  return y;
}

const COLS = [
  { k: "sl", t: "#", w: 18, a: "left" },
  { k: "item", t: "Item", w: 168, a: "left" },
  { k: "hsn", t: "HSN/SAC", w: 50, a: "left" },
  { k: "qty", t: "Qty", w: 56, a: "right" },
  { k: "rate", t: "Rate", w: 52, a: "right" },
  { k: "disc", t: "Disc.", w: 44, a: "right" },
  { k: "taxable", t: "Taxable", w: 60, a: "right" },
  { k: "gst", t: "GST %", w: 30, a: "right" },
  { k: "tax", t: "Tax", w: 45, a: "right" },
] as const;

function tableHeader(c: Ctx) {
  c.page.drawRectangle({ x: M, y: c.y - 6, width: W - 2 * M, height: 18, color: BAND });
  let x = M + 3;
  for (const col of COLS) {
    text(c, col.t, x, c.y, { size: 7.5, bold: true, color: MUTED, align: col.a, width: col.w - 6 });
    x += col.w;
  }
  c.y -= 18;
}

async function qrImage(pdf: PDFDocument, data: string): Promise<PDFImage> {
  const url = await QRCode.toDataURL(data, { errorCorrectionLevel: "M", margin: 1, width: 360 });
  return pdf.embedPng(Buffer.from(url.split(",")[1], "base64"));
}

function isSandboxQr(qr: string | null) {
  if (!qr) return false;
  try {
    return Buffer.from(qr.split(".")[1] ?? "", "base64url").toString().includes("SANDBOX");
  } catch {
    return false;
  }
}

export async function renderInvoicePdf(doc: InvoiceDoc, opts: { accent?: string; upi?: { vpa: string; payee: string } | null } = {}) {
  if (doc.settings.layout === "trade") return renderTradePdf(doc, opts);
  const pdf = await PDFDocument.create();
  pdf.registerFontkit(fontkit);
  const [r, b] = await fontBytes();
  const reg = await pdf.embedFont(r, { subset: true });
  const bold = await pdf.embedFont(b, { subset: true });
  pdf.setTitle(`${doc.title} ${doc.number}`);
  pdf.setAuthor(doc.seller.legalName);
  pdf.setCreator("VBiz Pro");
  const c: Ctx = { pdf, page: pdf.addPage([W, H]), y: H - M, reg, bold, accent: hex(opts.accent) };
  const pages: PDFPage[] = [c.page];

  // ── Header: seller (left), document box (right)
  c.page.drawRectangle({ x: 0, y: H - 6, width: W, height: 6, color: c.accent });
  text(c, doc.seller.tradeName, M, c.y - 8, { size: 16, bold: true });
  let ly = c.y - 24;
  if (doc.seller.legalName !== doc.seller.tradeName) {
    text(c, doc.seller.legalName, M, ly, { size: 9, color: MUTED });
    ly -= 12;
  }
  for (const l of wrap(reg, [doc.seller.address, [doc.seller.city, doc.seller.pinCode].filter(Boolean).join(" ")].filter(Boolean).join(", "), 8.5, 290)) {
    text(c, l, M, ly, { size: 8.5 });
    ly -= 11;
  }
  text(c, `State: ${stateLabel(doc.seller.stateCode)}`, M, ly, { size: 8.5 });
  ly -= 11;
  text(c, doc.seller.gstin ? `GSTIN: ${doc.seller.gstin}` : "GSTIN: not registered", M, ly, { size: 8.5, bold: true });
  ly -= 11;
  if (doc.seller.phone) {
    text(c, `Phone: ${doc.seller.phone}`, M, ly, { size: 8.5 });
    ly -= 11;
  }

  const bx = W - M - 210;
  text(c, doc.title.toUpperCase(), bx, c.y - 8, { size: 14, bold: true, color: c.accent, align: "right", width: 210 });
  const rows: [string, string][] = [
    ["Number", doc.number],
    ["Date", ddMonyyyy(doc.date)],
    ["Place of supply", stateLabel(doc.placeOfSupply)],
  ];
  if (doc.order) rows.push(["Order", doc.order.orderNumber]);
  if (doc.original) rows.push(["Against invoice", `${doc.original.number} (${ddMonyyyy(doc.original.date)})`]);
  if (doc.reason) rows.push(["Reason", doc.reason]);
  rows.push(["Reverse charge", "No"]);
  let ry = c.y - 26;
  for (const [k, v] of rows) {
    text(c, k, bx, ry, { size: 8, color: MUTED });
    const vl = wrap(bold, v, 8.5, 120);
    vl.forEach((l, i) => text(c, l, bx + 90, ry - i * 10, { size: 8.5, bold: true, align: "right", width: 120 }));
    ry -= 11 + (vl.length - 1) * 10;
  }
  c.y = Math.min(ly, ry) - 8;
  hline(c, c.y);
  c.y -= 14;

  // ── e-Invoice block
  if (doc.einvStatus === "GENERATED" && doc.irn && doc.signedQr) {
    const qr = await qrImage(pdf, doc.signedQr);
    const top = c.y + 6;
    c.page.drawImage(qr, { x: W - M - 86, y: top - 86, width: 86, height: 86 });
    text(c, isSandboxQr(doc.signedQr) ? "E-INVOICE (TEST — SANDBOX, NOT VALID)" : "E-INVOICE", M, c.y, { size: 7.5, bold: true, color: MUTED });
    c.y -= 12;
    for (const l of wrap(reg, `IRN: ${doc.irn}`, 8, W - 2 * M - 100)) {
      text(c, l, M, c.y, { size: 8 });
      c.y -= 10;
    }
    text(c, `Ack No: ${doc.ackNo ?? ""}    Ack Date: ${doc.ackDate ? ddMonyyyy(doc.ackDate) : ""}`, M, c.y, { size: 8 });
    c.y = Math.min(c.y - 10, top - 92);
    hline(c, c.y);
    c.y -= 14;
  }

  // ── Bill to / ship to
  const by = partyBlock(c, "Bill to", doc.buyer, M, c.y, 250);
  const sy = partyBlock(c, "Ship to", doc.buyer, M + 270, c.y, 250);
  c.y = Math.min(by, sy) - 6;

  // ── Lines
  tableHeader(c);
  const newPage = () => {
    c.page = pdf.addPage([W, H]);
    pages.push(c.page);
    c.y = H - M - 10;
    text(c, `${doc.title} ${doc.number} (continued)`, M, c.y, { size: 9, bold: true });
    c.y -= 20;
    tableHeader(c);
  };
  for (const l of doc.lines) {
    const item = wrap(reg, l.description, 8.5, COLS[1].w - 6);
    const h = Math.max(1, item.length) * 10.5 + 5;
    if (c.y - h < M + 40) newPage();
    const qty = l.quantity === 0 ? "—" : l.freeQty === l.quantity ? `${l.quantity} ${l.unit} free` : `${l.quantity} ${l.unit}`;
    const cells: Record<string, string> = {
      sl: String(l.sl),
      hsn: l.hsnCode ?? "",
      qty,
      rate: l.rate ? money(l.rate) : "—",
      disc: l.discount ? money(l.discount) : "",
      taxable: money(l.taxable),
      gst: `${l.gstRate}`,
      tax: money(l.cgst + l.sgst + l.igst),
    };
    let x = M + 3;
    for (const col of COLS) {
      if (col.k === "item") item.forEach((s, i) => text(c, s, x, c.y - i * 10.5, { size: 8.5 }));
      else text(c, cells[col.k], x, c.y, { size: 8.5, align: col.a, width: col.w - 6 });
      x += col.w;
    }
    c.y -= h;
    hline(c, c.y + 6);
  }

  // ── Summary needs ~250pt; otherwise a fresh page.
  if (c.y < M + 250) {
    c.page = pdf.addPage([W, H]);
    pages.push(c.page);
    c.y = H - M - 10;
  }
  c.y -= 8;
  const top = c.y;

  // Left: tax by rate + amount in words
  const inter = doc.interState;
  const rc = inter ? ["GST %", "Taxable", "IGST"] : ["GST %", "Taxable", "CGST", "SGST"];
  const rw = inter ? [50, 90, 90] : [50, 80, 70, 70];
  let x = M;
  rc.forEach((t, i) => {
    text(c, t, x, c.y, { size: 7.5, bold: true, color: MUTED, align: i ? "right" : "left", width: rw[i] - 4 });
    x += rw[i];
  });
  c.y -= 12;
  for (const r0 of doc.rates) {
    const vals = inter ? [`${r0.rate}%`, money(r0.taxable), money(r0.igst)] : [`${r0.rate}%`, money(r0.taxable), money(r0.cgst), money(r0.sgst)];
    x = M;
    vals.forEach((v, i) => {
      text(c, v, x, c.y, { size: 8.5, align: i ? "right" : "left", width: rw[i] - 4 });
      x += rw[i];
    });
    c.y -= 11;
  }
  c.y -= 6;
  text(c, "Amount in words", M, c.y, { size: 7.5, bold: true, color: MUTED });
  c.y -= 11;
  for (const l of wrap(reg, doc.words, 8.5, 280)) {
    text(c, l, M, c.y, { size: 8.5 });
    c.y -= 11;
  }
  const leftEnd = c.y;

  // Right: totals
  const tx = W - M - 200;
  let ty = top;
  const totals: [string, number, boolean?][] = [["Taxable value", doc.taxable]];
  if (inter) totals.push(["IGST", doc.igst]);
  else totals.push(["CGST", doc.cgst], ["SGST", doc.sgst]);
  for (const [k, v] of totals) {
    text(c, k, tx, ty, { size: 9, color: MUTED });
    text(c, money(v), tx + 100, ty, { size: 9, align: "right", width: 100 });
    ty -= 14;
  }
  ty -= 6; // y is the text baseline: keep the band clear of the row above
  c.page.drawRectangle({ x: tx - 6, y: ty - 6, width: 212, height: 20, color: BAND });
  text(c, "Total", tx, ty, { size: 11, bold: true });
  text(c, formatINR(doc.total), tx + 80, ty, { size: 11, bold: true, align: "right", width: 120 });
  ty -= 22;
  if (doc.due !== null && doc.due > 0 && doc.due !== doc.total) {
    text(c, "Still due", tx, ty, { size: 9, color: MUTED });
    text(c, formatINR(doc.due), tx + 100, ty, { size: 9, bold: true, align: "right", width: 100 });
    ty -= 14;
  } else if (doc.due === 0) {
    text(c, "Paid in full", tx, ty, { size: 9, bold: true, color: rgb(0.1, 0.5, 0.3), align: "right", width: 200 });
    ty -= 14;
  }

  // UPI QR for what's due
  if (opts.upi && doc.settings.upiQr && doc.due && doc.due > 0) {
    const qr = await qrImage(pdf, upiLink(opts.upi.vpa, opts.upi.payee, doc.due, doc.number));
    c.page.drawImage(qr, { x: tx + 120, y: ty - 82, width: 80, height: 80 });
    text(c, "Scan to pay by UPI", tx, ty - 20, { size: 8.5, bold: true });
    text(c, opts.upi.vpa, tx, ty - 32, { size: 8, color: MUTED });
    ty -= 90;
  }
  c.y = Math.min(leftEnd, ty) - 10;
  hline(c, c.y);
  c.y -= 14;

  // ── Footer details
  const foot: string[] = [];
  if (doc.ewbNo) foot.push(`E-way bill ${doc.ewbNo}${doc.ewbVehicle ? `, vehicle ${doc.ewbVehicle}` : ""}${doc.ewbValidUntil ? `, valid till ${ddMonyyyy(doc.ewbValidUntil)}` : ""}`);
  if (doc.settings.bankAccount) foot.push(`Bank: ${doc.settings.bankName} A/c ${doc.settings.bankAccount} IFSC ${doc.settings.bankIfsc}`);
  for (const f of foot) {
    text(c, f, M, c.y, { size: 8.5 });
    c.y -= 12;
  }
  if (doc.settings.terms) {
    for (const l of wrap(reg, doc.settings.terms, 7.5, 300)) {
      text(c, l, M, c.y, { size: 7.5, color: MUTED });
      c.y -= 9.5;
    }
  }
  const sigY = Math.max(c.y, M + 30);
  text(c, `For ${doc.seller.legalName}`, W - M - 220, sigY + 30, { size: 8.5, bold: true, align: "right", width: 220 });
  text(c, "Authorised signatory", W - M - 220, sigY, { size: 8, color: MUTED, align: "right", width: 220 });

  pages.forEach((p, i) => {
    p.drawText(`Page ${i + 1} of ${pages.length} · Computer-generated ${doc.title.toLowerCase()} · VBiz Pro`, {
      x: M,
      y: 18,
      size: 7,
      font: reg,
      color: MUTED,
    });
  });
  return pdf.save();
}

// ───────────────────────────── Trade bill layout ─────────────────────────────
// A boxed distributor bill in the style shopkeepers know from dealer billing software: cases and
// loose pieces, MRP, rate with GST, net rate, discount %, SGST/CGST %, the
// salesman and due date, a GST class table, and receiver / signatory boxes.

type TradeLine = InvoiceDoc["lines"][number];

const dmy = (d: Date) => d.toLocaleDateString("en-GB", { timeZone: "Asia/Kolkata", day: "2-digit", month: "2-digit", year: "numeric" });
const two = (n: number) => n.toFixed(2);

/** Cut a string to a width, ending in "…". */
function fit(font: PDFFont, s: string, size: number, width: number) {
  if (font.widthOfTextAtSize(s, size) <= width) return s;
  let t = s;
  while (t.length > 1 && font.widthOfTextAtSize(`${t}…`, size) > width) t = t.slice(0, -1);
  return `${t}…`;
}

/** Light tint of the accent colour for header bands. */
function tint(c: ReturnType<typeof rgb>, keep = 0.14) {
  const v = c as unknown as { red: number; green: number; blue: number };
  return rgb(1 - (1 - v.red) * keep, 1 - (1 - v.green) * keep, 1 - (1 - v.blue) * keep);
}

const TRADE_COLS: { k: string; t: string; w: number; a: "left" | "right" }[] = [
  { k: "sl", t: "Sn.", w: 16, a: "left" },
  { k: "item", t: "Product", w: 142, a: "left" },
  { k: "hsn", t: "HSN", w: 42, a: "left" },
  { k: "case", t: "CASE", w: 24, a: "right" },
  { k: "pcs", t: "PCS", w: 24, a: "right" },
  { k: "conv", t: "CONV.", w: 27, a: "right" },
  { k: "mrp", t: "MRP", w: 38, a: "right" },
  { k: "rate", t: "Rate", w: 38, a: "right" },
  { k: "net", t: "N/RATE", w: 38, a: "right" },
  { k: "dis", t: "Dis%", w: 26, a: "right" },
  { k: "sgst", t: "SGST", w: 24, a: "right" },
  { k: "cgst", t: "CGST", w: 24, a: "right" },
  { k: "amount", t: "Amount", w: W - 2 * M - 463, a: "right" },
];

/**
 * One bill line as the trade layout prints it. inclusive: the bill's rates
 * include GST, so Amount, N/RATE and the class totals are values with GST
 * (as dealer billing software prints them); otherwise they are taxable values.
 */
export function tradeLine(l: TradeLine, inclusive: boolean) {
  const q = l.quantity;
  const free = q > 0 && l.freeQty === q;
  const cs = l.caseSize && l.caseSize > 1 ? l.caseSize : null;
  const amount = inclusive ? l.total : l.taxable;
  const rate = l.inclRate ?? (inclusive && q > 0 ? Math.round((l.gross + (l.total - l.taxable)) / q) : l.rate);
  const before = q > 0 ? rate * q : 0;
  const discount = l.inclRate != null ? Math.max(before - l.total, 0) : l.discount;
  return {
    free,
    cases: cs && q > 0 ? Math.floor(q / cs) : null,
    pieces: cs ? q % cs : q,
    caseSize: cs,
    rate,
    net: q > 0 ? Math.round(amount / q) : 0,
    discountPct: before > 0 ? (discount / before) * 100 : 0,
    discount,
    amount,
  };
}

export async function renderTradePdf(doc: InvoiceDoc, opts: { accent?: string } = {}) {
  const pdf = await PDFDocument.create();
  pdf.registerFontkit(fontkit);
  const [r, b] = await fontBytes();
  const reg = await pdf.embedFont(r, { subset: true });
  const bold = await pdf.embedFont(b, { subset: true });
  pdf.setTitle(`${doc.title} ${doc.number}`);
  pdf.setAuthor(doc.seller.legalName);
  pdf.setCreator("VBiz Pro");
  const accent = hex(opts.accent);
  const band = tint(accent);
  const c: Ctx = { pdf, page: pdf.addPage([W, H]), y: 0, reg, bold, accent };
  const pages: PDFPage[] = [c.page];
  const inter = doc.interState;
  const inclusive = doc.lines.some((l) => l.inclRate != null);
  const goods = doc.lines.filter((l) => !l.isService);
  const BOX = INK;
  const top = H - M - 4;
  const R = W - M;
  const box = (x: number, y: number, w: number, h: number, fill?: ReturnType<typeof rgb>) =>
    c.page.drawRectangle({ x, y, width: w, height: h, borderColor: BOX, borderWidth: 0.7, ...(fill ? { color: fill } : {}) });
  const vline = (x: number, y1: number, y2: number) => c.page.drawLine({ start: { x, y: y1 }, end: { x, y: y2 }, thickness: 0.6, color: BOX });
  const hl = (y: number, x1 = M, x2 = R) => c.page.drawLine({ start: { x: x1, y }, end: { x: x2, y }, thickness: 0.6, color: BOX });

  /** Seller / buyer / document box at the top of every page; returns the y under it. */
  const header = async () => {
    text(c, `Page No. ${pages.length}`, M, top + 6, { size: 7.5, bold: true, align: "right", width: R - M });
    const mid = M + 262;
    // Seller (left)
    let ly = top - 12;
    text(c, fit(bold, doc.seller.tradeName.toUpperCase(), 11, 250), M + 5, ly, { size: 11, bold: true, color: accent });
    ly -= 13;
    if (doc.seller.legalName !== doc.seller.tradeName) {
      text(c, fit(reg, doc.seller.legalName, 8, 250), M + 5, ly, { size: 8, color: MUTED });
      ly -= 10;
    }
    for (const l of wrap(reg, [doc.seller.address, [doc.seller.city, doc.seller.pinCode].filter(Boolean).join(" - ")].filter(Boolean).join(", "), 8, 250)) {
      text(c, l, M + 5, ly, { size: 8 });
      ly -= 10;
    }
    if (doc.seller.phone) {
      text(c, `Phone : ${doc.seller.phone}`, M + 5, ly, { size: 8 });
      ly -= 10;
    }
    // Buyer (right)
    let ry = top - 12;
    text(c, fit(bold, `M/s ${doc.buyer.legalName.toUpperCase()}`, 10.5, R - mid - 10), mid + 5, ry, { size: 10.5, bold: true });
    ry -= 12;
    if (doc.buyer.tradeName && doc.buyer.tradeName !== doc.buyer.legalName) {
      text(c, fit(reg, doc.buyer.tradeName, 8, R - mid - 10), mid + 5, ry, { size: 8, color: MUTED });
      ry -= 10;
    }
    for (const l of wrap(reg, [doc.buyer.address, [doc.buyer.city, doc.buyer.pinCode].filter(Boolean).join(" ")].filter(Boolean).join(", "), 8.5, R - mid - 10).slice(0, 3)) {
      text(c, l, mid + 5, ry, { size: 8.5 });
      ry -= 10.5;
    }
    text(c, stateLabel(doc.buyer.stateCode).toUpperCase(), mid + 5, ry, { size: 8.5 });
    ry -= 10.5;
    if (doc.buyer.phone) {
      text(c, `Ph.No.: ${doc.buyer.phone}`, mid + 5, ry, { size: 8.5 });
      ry -= 10.5;
    }
    text(c, `GST : ${doc.buyer.gstin ?? "Unregistered"}`, mid + 5, ry, { size: 8.5, bold: !!doc.buyer.gstin });
    ry -= 6;
    let y = Math.min(ly, ry) - 2;
    box(M, y, R - M, top - y);
    vline(mid, top, y);

    // GSTIN | title | number, date, salesman, due date
    const rowH = 30;
    const t1 = M + 200;
    const t2 = M + 330;
    box(M, y - rowH, R - M, rowH);
    c.page.drawRectangle({ x: t1, y: y - rowH, width: t2 - t1, height: rowH, color: band, borderColor: BOX, borderWidth: 0.7 });
    text(c, doc.seller.gstin ? `GSTIN : ${doc.seller.gstin}` : "GSTIN : not registered", M + 5, y - 12, { size: 8.5, bold: true, color: accent });
    text(c, `State : ${stateLabel(doc.seller.stateCode)}`, M + 5, y - 23, { size: 7.5, color: MUTED });
    text(c, doc.title.toUpperCase(), t1, y - 19, { size: doc.title.length > 12 ? 10 : 12, bold: true, align: "center", width: t2 - t1 });
    const x0 = t2 + 5;
    const rw = R - x0 - 4;
    text(c, `Invoice No. : ${doc.number}`, x0, y - 11, { size: 8.5, bold: true });
    text(c, `Date : ${dmy(doc.date)}`, x0, y - 11, { size: 8.5, align: "right", width: rw });
    const left2 = doc.original ? `Against ${doc.original.number}` : (doc.salesman ?? "");
    text(c, fit(bold, left2.toUpperCase(), 8, rw - 98), x0, y - 23, { size: 8, bold: true });
    if (doc.dueDate) text(c, `Due Date : ${dmy(doc.dueDate)}`, x0, y - 23, { size: 8.5, align: "right", width: rw });
    y -= rowH;

    // e-Invoice: IRN and signed QR
    if (doc.einvStatus === "GENERATED" && doc.irn && doc.signedQr) {
      const qh = 54;
      box(M, y - qh, R - M, qh);
      const qr = await qrImage(pdf, doc.signedQr);
      c.page.drawImage(qr, { x: R - qh + 2, y: y - qh + 2, width: qh - 4, height: qh - 4 });
      text(c, isSandboxQr(doc.signedQr) ? "E-INVOICE (TEST — SANDBOX, NOT VALID)" : "E-INVOICE", M + 5, y - 11, { size: 7.5, bold: true, color: MUTED });
      let iy = y - 22;
      for (const l of wrap(reg, `IRN: ${doc.irn}`, 7.5, R - M - qh - 14).slice(0, 2)) {
        text(c, l, M + 5, iy, { size: 7.5 });
        iy -= 9.5;
      }
      text(c, `Ack No: ${doc.ackNo ?? ""}    Ack Date: ${doc.ackDate ? dmy(doc.ackDate) : ""}`, M + 5, iy, { size: 7.5 });
      y -= qh;
    }
    return y;
  };

  const colX: number[] = [];
  TRADE_COLS.reduce((x, col) => (colX.push(x), x + col.w), M);
  const tableHead = (y: number) => {
    c.page.drawRectangle({ x: M, y: y - 15, width: R - M, height: 15, color: band, borderColor: BOX, borderWidth: 0.7 });
    TRADE_COLS.forEach((col, i) => {
      const label = inter && col.k === "sgst" ? "IGST" : inter && col.k === "cgst" ? "" : col.t;
      text(c, label, colX[i] + 2, y - 10.5, { size: 7.5, bold: true, align: col.k === "item" ? "center" : col.a, width: col.w - 4 });
      if (i) vline(colX[i], y, y - 15);
    });
    return y - 15;
  };
  const closeBody = (from: number, to: number) => {
    TRADE_COLS.forEach((_, i) => i && vline(colX[i], from, to));
    vline(M, from, to);
    vline(R, from, to);
    hl(to);
  };

  // Summary: class rows (GST 5/12/18/28 plus any other rate on the bill) and totals.
  const classes = new Map<number, { total: number; sch: number; sgst: number; cgst: number; igst: number }>();
  for (const rate of [5, 12, 18, 28]) classes.set(rate, { total: 0, sch: 0, sgst: 0, cgst: 0, igst: 0 });
  for (const l of doc.lines) {
    const t = tradeLine(l, inclusive);
    const k = classes.get(l.gstRate) ?? { total: 0, sch: 0, sgst: 0, cgst: 0, igst: 0 };
    k.total += t.amount;
    k.sch += t.discount;
    k.sgst += l.sgst;
    k.cgst += l.cgst;
    k.igst += l.igst;
    classes.set(l.gstRate, k);
  }
  const classRows = [...classes.entries()].sort((a, b2) => a[0] - b2[0]);
  const rowH = 12;
  const termsLines = wrap(reg, doc.settings.terms ?? "", 7.5, 190).slice(0, 3);
  const signH = 58;
  const summaryH = 14 + Math.max((classRows.length + 2) * rowH, 6 * 13 + 4) + 14 + signH;

  let y = await header();
  y = tableHead(y);
  let bodyTop = y;
  const lineH = 11.5;
  for (const l of doc.lines) {
    if (y - lineH < M + 16) {
      closeBody(bodyTop, y - 2);
      c.page = pdf.addPage([W, H]);
      pages.push(c.page);
      y = tableHead(await header());
      bodyTop = y;
    }
    const t = tradeLine(l, inclusive);
    const half = two(l.gstRate / 2);
    const cells: Record<string, string> = {
      sl: `${l.sl}.`,
      item: fit(reg, l.description.toUpperCase(), 7.5, TRADE_COLS[1].w - 6),
      hsn: l.hsnCode ?? "",
      case: t.cases === null ? "" : String(t.cases),
      pcs: l.quantity === 0 ? "" : String(t.pieces),
      conv: t.caseSize ? String(t.caseSize) : "",
      mrp: l.mrp ? two(l.mrp / 100) : "",
      rate: t.free ? "FREE" : l.quantity ? two(t.rate / 100) : "",
      net: t.free || !l.quantity ? "" : two(t.net / 100),
      dis: two(t.discountPct),
      sgst: inter ? two(l.gstRate) : half,
      cgst: inter ? "" : half,
      amount: two(t.amount / 100),
    };
    y -= lineH;
    TRADE_COLS.forEach((col, i) => text(c, cells[col.k], colX[i] + 2, y + 3, { size: 7.5, align: col.a, width: col.w - 4 }));
  }
  // Keep the body a fixed height when there is room, like a printed bill.
  const minBottom = bodyTop - 230;
  if (y - summaryH < M + 14) {
    closeBody(bodyTop, y - 2);
    c.page = pdf.addPage([W, H]);
    pages.push(c.page);
    y = tableHead(await header());
    bodyTop = y;
  }
  const bodyBottom = Math.max(Math.min(y - 4, minBottom), M + 14 + summaryH);
  closeBody(bodyTop, bodyBottom);
  y = bodyBottom;

  // BILL ITEM / TOT QNT strip
  const qty = goods.reduce((a, l) => a + l.quantity, 0);
  box(M, y - 13, R - M, 13);
  text(c, `BILL ITEM = ${goods.length}`, M + 200, y - 9.5, { size: 7.5, bold: true });
  text(c, `TOT QNT = ${qty}`, M + 330, y - 9.5, { size: 7.5, bold: true });
  y -= 13;

  // Class table (left) and totals (right)
  const cw = inter ? [56, 64, 52, 52, 58, 58] : [56, 54, 46, 40, 48, 48, 48];
  const ch = inter ? ["CLASS", "TOTAL", "SCH.", "DISC.", "IGST", "TOTAL GST"] : ["CLASS", "TOTAL", "SCH.", "DISC.", "SGST", "CGST", "TOTAL GST"];
  const cx: number[] = [];
  cw.reduce((x, w) => (cx.push(x), x + w), M);
  const classRight = M + 340;
  const blockTop = y;
  const blockH = Math.max((classRows.length + 2) * rowH, 6 * 13 + 4);
  box(M, y - blockH, R - M, blockH);
  vline(classRight, y, y - blockH);
  const crow = (vals: string[], at: number, o: { bold?: boolean } = {}) => {
    vals.forEach((v, i) => text(c, v, cx[i] + 3, at - 9, { size: 7.5, bold: o.bold, align: i ? "right" : "left", width: cw[i] - 6 }));
  };
  crow(ch, y, { bold: true });
  hl(y - rowH, M, classRight);
  let cy = y - rowH;
  const sum = { total: 0, sch: 0, sgst: 0, cgst: 0, igst: 0 };
  for (const [rate, k] of classRows) {
    sum.total += k.total;
    sum.sch += k.sch;
    sum.sgst += k.sgst;
    sum.cgst += k.cgst;
    sum.igst += k.igst;
    const tax = k.sgst + k.cgst + k.igst;
    crow(
      inter
        ? [`GST ${two(rate)}`, two(k.total / 100), two(k.sch / 100), "0.00", two(k.igst / 100), two(tax / 100)]
        : [`GST ${two(rate)}`, two(k.total / 100), two(k.sch / 100), "0.00", two(k.sgst / 100), two(k.cgst / 100), two(tax / 100)],
      cy
    );
    cy -= rowH;
    hl(cy, M, classRight);
  }
  const allTax = sum.sgst + sum.cgst + sum.igst;
  crow(
    inter
      ? ["TOTAL", two(sum.total / 100), two(sum.sch / 100), "0.00", two(sum.igst / 100), two(allTax / 100)]
      : ["TOTAL", two(sum.total / 100), two(sum.sch / 100), "0.00", two(sum.sgst / 100), two(sum.cgst / 100), two(allTax / 100)],
    cy,
    { bold: true }
  );
  cw.slice(1).reduce((x, w) => (vline(x, y, y - blockH), x + w), M + cw[0]);

  // Totals: with GST-inclusive rates the GST is already inside the sub total.
  const sub = sum.total;
  const expected = inclusive ? sub : sub + allTax;
  const tRows: [string, number][] = [["SUB TOTAL", sub]];
  if (inter) tRows.push(["IGST PAYABLE", sum.igst]);
  else tRows.push(["SGST PAYABLE", sum.sgst], ["CGST PAYABLE", sum.cgst]);
  tRows.push(["ADD/LESS", doc.total - expected], ["CR/DR NOTE", 0]);
  let ty = blockTop;
  for (const [k, v] of tRows) {
    text(c, k, classRight + 8, ty - 10, { size: 8 });
    text(c, two(v / 100), classRight, ty - 10, { size: 8, align: "right", width: R - classRight - 5 });
    ty -= 13;
  }
  const gtY = blockTop - blockH;
  hl(gtY + 15, classRight, R);
  text(c, "GRAND TOTAL", classRight + 8, gtY + 4, { size: 9.5, bold: true });
  text(c, two(doc.total / 100), classRight, gtY + 4, { size: 9.5, bold: true, align: "right", width: R - classRight - 5 });
  y -= blockH;

  // Amount in words
  box(M, y - 13, R - M, 13);
  text(c, fit(reg, doc.words, 7.5, R - M - 10), M + 5, y - 9.5, { size: 7.5 });
  y -= 13;

  // Terms | Receiver | For seller
  const s1 = M + 205;
  const s2 = M + 345;
  box(M, y - signH, R - M, signH);
  vline(s1, y, y - signH);
  vline(s2, y, y - signH);
  text(c, "Terms & Conditions", M + 5, y - 11, { size: 8.5, bold: true });
  let tyy = y - 22;
  for (const l of termsLines) {
    text(c, l, M + 5, tyy, { size: 7.5 });
    tyy -= 9;
  }
  if (doc.settings.bankAccount && tyy > y - signH + 4) {
    text(c, fit(reg, `Bank: ${doc.settings.bankName} A/c ${doc.settings.bankAccount} IFSC ${doc.settings.bankIfsc}`, 7, s1 - M - 10), M + 5, tyy, { size: 7, color: MUTED });
  }
  text(c, "Receiver", s1, y - 11, { size: 8.5, bold: true, align: "center", width: s2 - s1 });
  text(c, fit(bold, `For ${doc.seller.tradeName.toUpperCase()}`, 7.5, R - s2 - 10), s2 + 5, y - 11, { size: 7.5, bold: true });
  text(c, "Authorised signatory", s2, y - signH + 6, { size: 7.5, color: MUTED, align: "right", width: R - s2 - 5 });
  y -= signH;
  if (doc.ewbNo) text(c, `E-way bill ${doc.ewbNo}${doc.ewbVehicle ? `, vehicle ${doc.ewbVehicle}` : ""}`, M, y - 10, { size: 7.5 });

  pages.forEach((p, i) =>
    p.drawText(`Page ${i + 1} of ${pages.length} · Computer-generated ${doc.title.toLowerCase()} · VBiz Pro`, { x: M, y: 18, size: 7, font: reg, color: MUTED })
  );
  return pdf.save();
}