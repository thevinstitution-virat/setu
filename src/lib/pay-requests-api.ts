import type { SessionPayload } from "@/lib/auth";
import type { TenantDb } from "@/lib/db";
import type { PaymentIntent, Prisma } from "@/generated/prisma/client";
import { can } from "@/lib/permissions";
import { collectScope } from "@/lib/khata";

/**
 * Who may see or make payment requests: accounts staff (ledger.view) all;
 * a retailer its own; field staff (payments.collect) the shops they serve,
 * and in lists only the requests they made.
 */
export async function requestScope(db: TenantDb, session: SessionPayload): Promise<{ where: Prisma.PaymentIntentWhereInput; retailerId: string | null } | null> {
  if (can(session.role, "ledger.view")) return { where: {}, retailerId: null };
  if (session.role === "RETAILER") {
    const p = await db.retailerProfile.findUnique({ where: { userId: session.userId }, select: { id: true } });
    return p ? { where: { retailerId: p.id }, retailerId: p.id } : null;
  }
  if (can(session.role, "payments.collect")) return { where: { createdById: session.userId }, retailerId: null };
  return null;
}

export async function canSeeIntent(db: TenantDb, session: SessionPayload, intent: Pick<PaymentIntent, "retailerId" | "createdById">) {
  if (can(session.role, "ledger.view")) return true;
  if (session.role === "RETAILER") {
    const p = await db.retailerProfile.findUnique({ where: { userId: session.userId }, select: { id: true } });
    return p?.id === intent.retailerId;
  }
  if (!can(session.role, "payments.collect")) return false;
  return intent.createdById === session.userId || !!(await collectScope(db, session, intent.retailerId));
}

/** What a screen gets (no gateway internals). */
export const intentView = (i: PaymentIntent & { retailer?: { outletName: string } | null }) => ({
  id: i.id,
  kind: i.kind,
  provider: i.provider,
  retailerId: i.retailerId,
  outletName: i.retailer?.outletName ?? null,
  purpose: i.purpose,
  amount: i.amount,
  paidAmount: i.paidAmount,
  orderId: i.orderId,
  shortUrl: i.shortUrl,
  imageUrl: i.imageUrl,
  status: i.status,
  error: i.error,
  note: i.note,
  expiresAt: i.expiresAt,
  createdAt: i.createdAt,
});
