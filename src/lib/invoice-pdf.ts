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
  const pdf = await PDFDocument.create();
  pdf.registerFontkit(fontkit);
  const [r, b] = await fontBytes();
  const reg = await pdf.embedFont(r, { subset: true });
  const bold = await pdf.embedFont(b, { subset: true });
  pdf.setTitle(`${doc.title} ${doc.number}`);
  pdf.setAuthor(doc.seller.legalName);
  pdf.setCreator("Seller's Setu");
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
    p.drawText(`Page ${i + 1} of ${pages.length} · Computer-generated ${doc.title.toLowerCase()} · Seller's Setu`, {
      x: M,
      y: 18,
      size: 7,
      font: reg,
      color: MUTED,
    });
  });
  return pdf.save();
}
