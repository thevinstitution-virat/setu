/**
 * A10 shelf audits: at a visit the agent photographs the shop's shelf and
 * saves our facings, other brands' facings and empty slots. With AI the
 * counts are read from the photo first (readShelf in lib/photo-checks.ts) and
 * the agent corrects them; without AI they are typed in. Owners see the
 * latest audit per shop and how our share moved (Reports → Shelf).
 */
import type { Prisma } from "@/generated/prisma/client";
import type { Tx } from "@/lib/db";
import { MoneyError } from "@/lib/money-error";
import { keyBelongsTo } from "@/lib/storage";
import { istDay, istDayRange } from "@/lib/field-math";
import type { Period } from "@/lib/analytics";
import { parseShelfCounts, shelfShare } from "@/lib/photo-rules";

export type ShelfInput = {
  retailerId: string;
  visitId?: string | null;
  photoKey: string;
  ours: unknown;
  others: unknown;
  empty: unknown;
  /** Product ids seen on the shelf. */
  seen?: unknown;
  /** What the AI read, when it did (the counts the agent then saved may differ). */
  read?: { ours: number; others: number; empty: number } | null;
  note?: string | null;
};

/** Saves one shelf audit for a shop the person may serve (checked by the caller). */
export async function saveShelfAudit(tx: Tx, tenantId: string, byId: string, b: ShelfInput) {
  const counts = parseShelfCounts(b);
  if (typeof counts === "string") throw new MoneyError(counts);
  if (!keyBelongsTo(b.photoKey, tenantId) || !b.photoKey.includes("/shelf-photo/")) throw new MoneyError("Take a photo of the shelf first");
  const retailer = await tx.retailerProfile.findUnique({ where: { id: b.retailerId }, select: { id: true } });
  if (!retailer) throw new MoneyError("Shop not found");
  let visitId: string | null = null;
  if (b.visitId) {
    const v = await tx.visit.findUnique({ where: { id: b.visitId }, select: { id: true, retailerId: true, salesAgent: { select: { userId: true } } } });
    if (!v || v.retailerId !== b.retailerId || v.salesAgent.userId !== byId) throw new MoneyError("That visit isn't yours at this shop");
    visitId = v.id;
  }
  const wanted = Array.isArray(b.seen) ? [...new Set(b.seen.filter((x): x is string => typeof x === "string"))].slice(0, 60) : [];
  const seen = wanted.length ? (await tx.product.findMany({ where: { id: { in: wanted } }, select: { id: true } })).map((p) => p.id) : [];
  const r = b.read && [b.read.ours, b.read.others, b.read.empty].every((n) => Number.isInteger(n) && n >= 0) ? { ours: b.read.ours, others: b.read.others, empty: b.read.empty } : null;
  const source = !r ? "manual" : r.ours === counts.ours && r.others === counts.others && r.empty === counts.empty ? "ai" : "ai_edited";
  return tx.shelfAudit.create({
    data: {
      retailerId: b.retailerId,
      visitId,
      byId,
      photoKey: b.photoKey,
      ...counts,
      seen,
      source,
      read: (r ?? undefined) as Prisma.InputJsonValue | undefined,
      note: typeof b.note === "string" ? b.note.trim().slice(0, 300) || null : null,
    },
  });
}

/** The last few audits at a shop, newest first. */
export async function recentShelfAudits(tx: Tx, retailerId: string, take = 5) {
  const rows = await tx.shelfAudit.findMany({
    where: { retailerId },
    orderBy: { createdAt: "desc" },
    take,
    select: { id: true, ours: true, others: true, empty: true, source: true, photoKey: true, note: true, createdAt: true, by: { select: { name: true } } },
  });
  return rows.map((a) => ({ ...a, share: shelfShare(a.ours, a.others), createdAt: a.createdAt.toISOString(), by: a.by.name }));
}

/** Reports → Shelf: the latest audit per shop in the period, against the one before it. */
export async function shelfReport(tx: Tx, p: Period) {
  const from = istDayRange(p.from).from;
  const to = istDayRange(p.to).to;
  const inPeriod = await tx.shelfAudit.findMany({ where: { createdAt: { gte: from, lt: to } }, select: { retailerId: true, byId: true, seen: true, by: { select: { name: true } } } });
  const shopIds = [...new Set(inPeriod.map((a) => a.retailerId))];
  const history = shopIds.length
    ? await tx.shelfAudit.findMany({
        where: { retailerId: { in: shopIds }, createdAt: { lt: to } },
        orderBy: { createdAt: "desc" },
        take: 5000,
        select: { id: true, retailerId: true, ours: true, others: true, empty: true, source: true, photoKey: true, createdAt: true, by: { select: { name: true } }, retailer: { select: { outletName: true, area: { select: { name: true } } } } },
      })
    : [];
  const byShop = new Map<string, typeof history>();
  for (const a of history) {
    const list = byShop.get(a.retailerId) ?? [];
    if (list.length < 2) list.push(a);
    byShop.set(a.retailerId, list);
  }
  const latestIds = [...byShop.values()].map((l) => l[0].id);
  const flagged = new Set(
    latestIds.length ? (await tx.photoCheck.findMany({ where: { subjectType: "shelf", subjectId: { in: latestIds }, verdict: "bad" }, select: { subjectId: true } })).map((c) => c.subjectId) : []
  );
  const rows = [...byShop.values()]
    .map(([a, prev]) => {
      const share = shelfShare(a.ours, a.others);
      const prevShare = prev ? shelfShare(prev.ours, prev.others) : null;
      return {
        retailerId: a.retailerId,
        outletName: a.retailer.outletName,
        area: a.retailer.area.name,
        at: a.createdAt.toISOString(),
        /** IST day of the audit. */
        day: istDay(a.createdAt),
        by: a.by.name,
        ours: a.ours,
        others: a.others,
        empty: a.empty,
        share,
        prevShare,
        change: share !== null && prevShare !== null ? share - prevShare : null,
        photoKey: a.photoKey,
        source: a.source,
        flagged: flagged.has(a.id),
      };
    })
    .sort((x, y) => (x.share ?? 101) - (y.share ?? 101) || y.empty - x.empty);

  const shares = rows.map((r) => r.share).filter((s): s is number => s !== null);
  const people = new Map<string, { name: string; audits: number; shops: Set<string> }>();
  for (const a of inPeriod) {
    const x = people.get(a.byId) ?? { name: a.by.name, audits: 0, shops: new Set<string>() };
    x.audits++;
    x.shops.add(a.retailerId);
    people.set(a.byId, x);
  }
  const seenCount = new Map<string, Set<string>>();
  for (const a of inPeriod) for (const id of a.seen) seenCount.set(id, (seenCount.get(id) ?? new Set()).add(a.retailerId));
  const seenIds = [...seenCount.keys()];
  const names = seenIds.length ? new Map((await tx.product.findMany({ where: { id: { in: seenIds } }, select: { id: true, name: true } })).map((x) => [x.id, x.name])) : new Map<string, string>();

  return {
    audits: inPeriod.length,
    shops: rows.length,
    avgShare: shares.length ? Math.round(shares.reduce((t, s) => t + s, 0) / shares.length) : null,
    emptySlots: rows.reduce((t, r) => t + r.empty, 0),
    shopsWithEmpty: rows.filter((r) => r.empty > 0).length,
    rows,
    people: [...people.values()].map((x) => ({ name: x.name, audits: x.audits, shops: x.shops.size })).sort((a, b) => b.audits - a.audits),
    seen: seenIds
      .map((id) => ({ name: names.get(id) ?? "Product removed", shops: seenCount.get(id)!.size }))
      .sort((a, b) => b.shops - a.shops)
      .slice(0, 20),
  };
}
