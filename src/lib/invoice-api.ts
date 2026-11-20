import { createHmac, timingSafeEqual } from "node:crypto";
import type { SessionPayload } from "@/lib/auth";
import type { TenantDb } from "@/lib/db";
import { can } from "@/lib/permissions";
import { moneySettings } from "@/lib/money-settings";
import { formatINR } from "@/lib/money";
import type { InvoiceDoc } from "@/lib/invoice";

/**
 * Who may see a document:
 * - staff with invoices.view: every document;
 * - a retailer: their own;
 * - a sales agent: their retailers';
 * - a delivery agent: documents of orders assigned to them.
 */
export async function canSeeInvoice(db: TenantDb, session: SessionPayload, inv: { retailerId: string; orderId: string | null }) {
  if (can(session.role, "invoices.view")) return true;
  if (session.role === "RETAILER") {
    const me = await db.retailerProfile.findUnique({ where: { userId: session.userId }, select: { id: true } });
    return me?.id === inv.retailerId;
  }
  if (session.role === "SALES_AGENT") {
    const [agent, r] = await Promise.all([
      db.salesAgentProfile.findUnique({ where: { userId: session.userId }, select: { id: true } }),
      db.retailerProfile.findUnique({ where: { id: inv.retailerId }, select: { salesAgentId: true } }),
    ]);
    return !!agent && r?.salesAgentId === agent.id;
  }
  if (session.role === "DELIVERY_AGENT" && inv.orderId) {
    const [agent, d] = await Promise.all([
      db.deliveryAgentProfile.findUnique({ where: { userId: session.userId }, select: { id: true } }),
      db.delivery.findUnique({ where: { orderId: inv.orderId }, select: { deliveryAgentId: true } }),
    ]);
    return !!agent && d?.deliveryAgentId === agent.id;
  }
  return false;
}

const secret = () => process.env.SESSION_SECRET ?? "setu-dev-secret-change-me";
const DAY = 86_400_000;
/** A shared link works this many days; the shop can always open the document in the app. */
export const SHARE_DAYS = 90;

const legacySig = (tenantId: string, invoiceId: string) =>
  createHmac("sha256", secret()).update(`invoice-share:${tenantId}:${invoiceId}`).digest("base64url").slice(0, 24);
const sig = (tenantId: string, invoiceId: string, expDay: number, version: number) =>
  createHmac("sha256", secret()).update(`invoice-share2:${tenantId}:${invoiceId}:${expDay}:${version}`).digest("base64url").slice(0, 24);
const same = (a: string, b: string) => {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
};

/** Unguessable link token for sharing one document (e.g. on WhatsApp): id, expiry day, signature. */
export function shareToken(tenantId: string, invoiceId: string, version = 0, now = new Date()) {
  const expDay = Math.floor(now.getTime() / DAY) + SHARE_DAYS;
  return `${invoiceId}.${expDay.toString(36)}.${sig(tenantId, invoiceId, expDay, version)}`;
}

/** When a token made now stops working. */
export const shareExpiry = (now = new Date()) => new Date((Math.floor(now.getTime() / DAY) + SHARE_DAYS + 1) * DAY);

/**
 * Invoice id from a share token, or null if it was tampered with, belongs to
 * another business, has expired, or was stopped ("Stop old links").
 * Links sent before expiry existed (id.signature) last SHARE_DAYS from the
 * document's date, and only until links are first stopped.
 */
export async function openShareToken(db: TenantDb, tenantId: string, token: string, now = new Date()): Promise<string | null> {
  const parts = token.split(".");
  const id = parts[0];
  if (!id || !/^[a-z0-9]{10,40}$/.test(id) || (parts.length !== 2 && parts.length !== 3)) return null;
  const inv = await db.invoice.findUnique({ where: { id }, select: { shareVersion: true, createdAt: true } });
  if (!inv) return null;
  if (parts.length === 2) {
    const fresh = now.getTime() - inv.createdAt.getTime() <= SHARE_DAYS * DAY;
    return inv.shareVersion === 0 && fresh && same(legacySig(tenantId, id), parts[1]) ? id : null;
  }
  const expDay = parseInt(parts[1], 36);
  if (!Number.isInteger(expDay) || expDay < Math.floor(now.getTime() / DAY)) return null;
  return same(sig(tenantId, id, expDay, inv.shareVersion), parts[2]) ? id : null;
}

/** "Stop old links": every link shared so far stops working; new ones are made from now. */
export async function stopShareLinks(db: TenantDb, invoiceId: string) {
  return db.invoice.update({ where: { id: invoiceId }, data: { shareVersion: { increment: 1 } }, select: { shareVersion: true } });
}

/** Share links + a ready WhatsApp message. */
export function shareInfo(origin: string, tenantId: string, doc: Pick<InvoiceDoc, "id" | "title" | "number" | "total" | "seller" | "buyer" | "due" | "shareVersion">) {
  const t = shareToken(tenantId, doc.id, doc.shareVersion);
  const url = `${origin}/i/${t}`;
  const pdfUrl = `${origin}/api/public/invoices/${t}`;
  const due = doc.due && doc.due > 0 ? ` Amount due: ${formatINR(doc.due)}.` : "";
  const text = `${doc.seller.tradeName}: ${doc.title} ${doc.number} for ${doc.buyer.tradeName}, ${formatINR(doc.total)}.${due} View or download: ${url}`;
  const phone = (doc.buyer.phone ?? "").replace(/\D/g, "");
  const wa = phone.length === 10 ? `91${phone}` : phone;
  return { url, pdfUrl, text, whatsapp: `https://wa.me/${wa}?text=${encodeURIComponent(text)}`, expiresAt: shareExpiry().toISOString() };
}

/** Origin the browser used (tenant subdomain or custom domain). */
export function originOf(req: Request) {
  const u = new URL(req.url);
  const host = req.headers.get("x-forwarded-host") ?? req.headers.get("host") ?? u.host;
  const proto = req.headers.get("x-forwarded-proto") ?? u.protocol.replace(":", "");
  return `${proto}://${host}`;
}

/** Brand colour and UPI details the PDF needs. */
export async function pdfOptions(db: TenantDb, tenantId: string) {
  const t = await db.tenant.findUniqueOrThrow({ where: { id: tenantId }, select: { brand: true, settings: true } });
  const m = moneySettings(t.settings);
  const brand = (t.brand ?? {}) as { primary?: string };
  return { accent: brand.primary, upi: m.upiVpa ? { vpa: m.upiVpa, payee: m.upiPayeeName || m.upiVpa } : null };
}

export const pdfHeaders = (number: string, download: boolean) => ({
  "Content-Type": "application/pdf",
  "Content-Disposition": `${download ? "attachment" : "inline"}; filename="${number.replace(/[^A-Za-z0-9-]/g, "_")}.pdf"`,
  "Cache-Control": "private, no-store",
});
