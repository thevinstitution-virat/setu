import { readFile } from "node:fs/promises";
import path from "node:path";
import { PDFDocument, rgb, type PDFFont, type PDFPage } from "pdf-lib";
import fontkit from "@pdf-lib/fontkit";
import type { PlatformInvoice } from "@/generated/prisma/client";
import { formatINR } from "@/lib/money";
import { amountInWords, ddMonyyyy, stateLabel } from "@/lib/gst";
import type { BillLine } from "@/lib/billing";

/** A4 PDF of our own subscription invoice to a tenant. */

const W = 595.28;
const H = 841.89;
const M = 40;
const INK = rgb(0.12, 0.12, 0.14);
const MUTED = rgb(0.42, 0.42, 0.46);
const LINE = rgb(0.85, 0.85, 0.87);
const ACCENT = rgb(0.08, 0.34, 0.32);

let fonts: Promise<[Uint8Array, Uint8Array]> | null = null;
const fontBytes = () => {
  const load = (f: string) => readFile(path.join(process.cwd(), "assets", "fonts", f)).then((b) => new Uint8Array(b));
  fonts ??= Promise.all([load("Geist-Regular.ttf"), load("Geist-SemiBold.ttf")]);
  return fonts;
};

type Party = { legalName?: string; gstin?: string | null; address?: string | null; stateCode?: string | null };

export async function renderPlatformInvoicePdf(inv: PlatformInvoice) {
  const pdf = await PDFDocument.create();
  pdf.registerFontkit(fontkit);
  const [r, b] = await fontBytes();
  const reg = await pdf.embedFont(r, { subset: true });
  const bold = await pdf.embedFont(b, { subset: true });
  const page = pdf.addPage([W, H]);
  pdf.setTitle(`Invoice ${inv.number}`);
  const seller = inv.seller as Party;
  const buyer = inv.billTo as Party;
  const lines = inv.lines as unknown as BillLine[];
  const registered = !!seller.gstin;

  const text = (p: PDFPage, s: string, x: number, y: number, o: { size?: number; font?: PDFFont; color?: ReturnType<typeof rgb>; right?: number } = {}) => {
    const size = o.size ?? 9;
    const font = o.font ?? reg;
    const dx = o.right !== undefined ? o.right - font.widthOfTextAtSize(s, size) : x;
    p.drawText(s, { x: dx, y, size, font, color: o.color ?? INK });
  };

  page.drawRectangle({ x: 0, y: H - 6, width: W, height: 6, color: ACCENT });
  let y = H - M - 10;
  text(page, seller.legalName ?? "Seller's Setu", M, y, { size: 15, font: bold });
  text(page, registered ? "TAX INVOICE" : "INVOICE", 0, y, { size: 13, font: bold, color: ACCENT, right: W - M });
  y -= 16;
  if (seller.address) text(page, seller.address.slice(0, 90), M, y, { size: 8.5 });
  text(page, `No. ${inv.number}`, 0, y, { size: 9, font: bold, right: W - M });
  y -= 12;
  text(page, seller.gstin ? `GSTIN ${seller.gstin}` : "Not registered for GST", M, y, { size: 8.5, font: bold });
  text(page, `Date ${ddMonyyyy(inv.issuedAt)}`, 0, y, { size: 9, right: W - M });
  y -= 12;
  if (seller.stateCode) text(page, `State ${stateLabel(seller.stateCode)}`, M, y, { size: 8.5 });
  text(page, `Due ${ddMonyyyy(inv.dueAt)}`, 0, y, { size: 9, right: W - M });
  y -= 24;

  text(page, "BILL TO", M, y, { size: 8, color: MUTED });
  text(page, "PERIOD", 330, y, { size: 8, color: MUTED });
  y -= 13;
  text(page, (buyer.legalName ?? "").slice(0, 60), M, y, { size: 10, font: bold });
  text(page, `${ddMonyyyy(inv.periodStart)} – ${ddMonyyyy(new Date(inv.periodEnd.getTime() - 1))}`, 330, y, { size: 9.5 });
  y -= 12;
  if (buyer.address) {
    text(page, buyer.address.slice(0, 70), M, y, { size: 8.5 });
    y -= 11;
  }
  text(page, buyer.gstin ? `GSTIN ${buyer.gstin}` : "GSTIN: unregistered", M, y, { size: 8.5 });
  y -= 11;
  if (buyer.stateCode) {
    text(page, `Place of supply ${stateLabel(buyer.stateCode)}`, M, y, { size: 8.5 });
    y -= 11;
  }
  y -= 14;

  // Table
  const cols = { desc: M, sac: 300, qty: 360, rate: 440, amt: W - M };
  page.drawLine({ start: { x: M, y: y + 12 }, end: { x: W - M, y: y + 12 }, thickness: 0.6, color: LINE });
  text(page, "Description", cols.desc, y, { size: 8, color: MUTED });
  text(page, "SAC", cols.sac, y, { size: 8, color: MUTED });
  text(page, "Qty", 0, y, { size: 8, color: MUTED, right: cols.qty + 30 });
  text(page, "Rate (₹)", 0, y, { size: 8, color: MUTED, right: cols.rate + 50 });
  text(page, "Amount (₹)", 0, y, { size: 8, color: MUTED, right: cols.amt });
  y -= 8;
  page.drawLine({ start: { x: M, y }, end: { x: W - M, y }, thickness: 0.6, color: LINE });
  y -= 14;
  for (const l of lines) {
    text(page, l.description.slice(0, 50), cols.desc, y, { size: 9 });
    text(page, l.sac, cols.sac, y, { size: 9 });
    text(page, String(l.qty), 0, y, { size: 9, right: cols.qty + 30 });
    text(page, formatINR(l.ratePaise, { symbol: false }), 0, y, { size: 9, right: cols.rate + 50 });
    text(page, formatINR(l.amountPaise, { symbol: false }), 0, y, { size: 9, right: cols.amt });
    y -= 15;
  }
  page.drawLine({ start: { x: M, y: y + 6 }, end: { x: W - M, y: y + 6 }, thickness: 0.6, color: LINE });
  y -= 10;
  const sum = (label: string, v: number, strong = false) => {
    text(page, label, 330, y, { size: strong ? 10 : 9, font: strong ? bold : reg });
    text(page, formatINR(v), 0, y, { size: strong ? 10 : 9, font: strong ? bold : reg, right: W - M });
    y -= strong ? 16 : 13;
  };
  sum("Taxable value", inv.taxable);
  if (registered) {
    if (inv.interState) sum("IGST 18%", inv.igst);
    else {
      sum("CGST 9%", inv.cgst);
      sum("SGST 9%", inv.sgst);
    }
  }
  sum("Total", inv.total, true);
  text(page, amountInWords(inv.total), M, y, { size: 8.5, color: MUTED });
  y -= 24;

  if (inv.status === "PAID") {
    text(page, `PAID ${inv.paidAt ? ddMonyyyy(inv.paidAt) : ""}${inv.paidRef ? ` · Ref ${inv.paidRef}` : ""}`, M, y, { size: 11, font: bold, color: rgb(0.05, 0.42, 0.32) });
    y -= 18;
  } else if (inv.status === "VOID") {
    text(page, `VOID${inv.voidReason ? ` · ${inv.voidReason.slice(0, 80)}` : ""}`, M, y, { size: 11, font: bold, color: rgb(0.7, 0.1, 0.1) });
    y -= 18;
  } else if (inv.payUrl) {
    text(page, `Pay online: ${inv.payUrl}`, M, y, { size: 9 });
    y -= 14;
  }
  text(page, "Reverse charge: No. This is a computer-generated invoice.", M, M, { size: 7.5, color: MUTED });
  return Buffer.from(await pdf.save());
}
