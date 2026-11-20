import { prisma } from "@/lib/prisma";
import type { CurrentTenant } from "@/lib/tenant";
import type { SessionPayload } from "@/lib/auth";
import { entitlements, FEATURE_KEYS, FEATURES, PATH_FEATURES, featureForPath, type Feature } from "@/lib/plans";
import { getTenant } from "@/lib/tenant";
import { appNameOf, effectiveBrand, parseBrand, shortNameOf } from "@/lib/branding";
import { activeSupport } from "@/lib/support";
import { asPlatform } from "@/lib/db";

/**
 * Everything the app shell shows around a page for one signed-in person
 * (Phase 9): the business's name and logo, platform announcements, the
 * support-session banner, trial / billing / pause / deletion notices, and
 * which nav items are not in the plan. One call per layout render.
 */
export type Chrome = {
  brand: { appName: string; shortName: string; logoUrl: string | null; whiteLabel: boolean };
  announcements: { id: string; title: string; body: string; level: "info" | "warning" }[];
  support: { mode: "READ" | "WRITE"; reason: string; expiresAt: string } | null;
  notice:
    | { kind: "trial"; daysLeft: number; endsAt: string; planPicked: boolean }
    | { kind: "past_due"; message: string }
    | { kind: "paused"; reason: string | null }
    | { kind: "deleting"; deleteAfter: string }
    | null;
  /** Nav hrefs whose module the plan does not have (shown with a lock, open an upgrade card). */
  locked: string[];
  lockedFeatures: Feature[];
  /** Page prefixes whose module is off: the shell shows an upgrade card there instead of the page. */
  lockedPages: { prefix: string; feature: Feature; label: string }[];
};

export async function chromeFor(tenant: CurrentTenant, session: SessionPayload, navHrefs: string[] = []): Promise<Chrome> {
  const e = await entitlements(tenant.id);
  const brand = effectiveBrand(parseBrand(tenant.brand), e.features.has("whiteLabel"));
  const now = new Date();
  const isOffice = session.role === "ADMIN";

  const anns = await prisma.platformAnnouncement.findMany({
    where: {
      startsAt: { lte: now },
      OR: [{ endsAt: null }, { endsAt: { gt: now } }],
      AND: [{ OR: [{ tenantIds: { isEmpty: true } }, { tenantIds: { has: tenant.id } }] }],
      ...(isOffice ? {} : { audience: "STAFF" }),
    },
    orderBy: { startsAt: "desc" },
    take: 3,
  });

  const support = session.supportId ? await activeSupport(tenant.id, session.supportId) : null;

  let notice: Chrome["notice"] = null;
  if (isOffice) {
    const sub = await asPlatform((tx) => tx.subscription.findUnique({ where: { tenantId: tenant.id }, select: { status: true, trialEndsAt: true, nextPlanCode: true, planCode: true } }));
    if (tenant.deleteAfter) notice = { kind: "deleting", deleteAfter: tenant.deleteAfter.toISOString() };
    else if (tenant.status === "SUSPENDED") notice = { kind: "paused", reason: tenant.suspendReason };
    else if (sub?.status === "PAST_DUE")
      notice = { kind: "past_due", message: sub.planCode === "trial" ? "Your free trial has ended. Pick a plan to keep using the app." : "A bill is overdue. Pay it to avoid a pause." };
    else if (sub?.status === "TRIAL" && sub.trialEndsAt) {
      const daysLeft = Math.max(0, Math.ceil((sub.trialEndsAt.getTime() - now.getTime()) / 86_400_000));
      notice = { kind: "trial", daysLeft, endsAt: sub.trialEndsAt.toISOString(), planPicked: !!sub.nextPlanCode };
    }
  }

  const locked = navHrefs.filter((h) => {
    const f = featureForPath(h);
    return f && !e.features.has(f);
  });

  return {
    brand: {
      appName: appNameOf(brand, tenant.name),
      shortName: shortNameOf(brand, tenant.name),
      logoUrl: brand.logoKey ? "/brand/logo" : null,
      whiteLabel: e.features.has("whiteLabel"),
    },
    announcements: anns.map((a) => ({ id: a.id, title: a.title, body: a.body, level: a.level === "warning" ? "warning" : "info" })),
    support: support ? { mode: support.mode, reason: support.reason, expiresAt: support.expiresAt.toISOString() } : null,
    notice,
    locked,
    lockedFeatures: FEATURE_KEYS.filter((f) => !e.features.has(f)),
    lockedPages: PATH_FEATURES.filter(([p, f]) => !p.startsWith("/api/") && !e.features.has(f)).map(([prefix, feature]) => ({ prefix, feature, label: FEATURES[feature] })),
  };
}

/** For layouts: chrome for the signed-in person on this address (null if no tenant). */
export async function layoutChrome(session: SessionPayload, nav: { href: string }[]): Promise<Chrome | null> {
  const tenant = await getTenant();
  if (!tenant) return null;
  return chromeFor(tenant, session, nav.map((n) => n.href));
}
