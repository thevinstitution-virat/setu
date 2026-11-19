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
const sig = (tenantId: string, invoiceId: string) =>
  createHmac("sha256", secret()).update(`invoice-share:${tenantId}:${invoiceId}`).digest("base64url").slice(0, 24);

/** Unguessable link token for sharing one document (e.g. on WhatsApp). */
export const shareToken = (tenantId: string, invoiceId: string) => `${invoiceId}.${sig(tenantId, invoiceId)}`;

/** Invoice id from a share token, or null if it was tampered with / belongs to another business. */
export function readShareToken(tenantId: string, token: string): string | null {
  const [id, s] = token.split(".");
  if (!id || !s || !/^[a-z0-9]{10,40}$/.test(id)) return null;
  const want = Buffer.from(sig(tenantId, id));
  const got = Buffer.from(s);
  return want.length === got.length && timingSafeEqual(want, got) ? id : null;
}

/** Share links + a ready WhatsApp message. */
export function shareInfo(origin: string, tenantId: string, doc: Pick<InvoiceDoc, "id" | "title" | "number" | "total" | "seller" | "buyer" | "due">) {
  const t = shareToken(tenantId, doc.id);
  const url = `${origin}/i/${t}`;
  const pdfUrl = `${origin}/api/public/invoices/${t}`;
  const due = doc.due && doc.due > 0 ? ` Amount due: ${formatINR(doc.due)}.` : "";
  const text = `${doc.seller.tradeName}: ${doc.title} ${doc.number} for ${doc.buyer.tradeName}, ${formatINR(doc.total)}.${due} View or download: ${url}`;
  const phone = (doc.buyer.phone ?? "").replace(/\D/g, "");
  const wa = phone.length === 10 ? `91${phone}` : phone;
  return { url, pdfUrl, text, whatsapp: `https://wa.me/${wa}?text=${encodeURIComponent(text)}` };
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
