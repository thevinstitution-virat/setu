import { redirect } from "next/navigation";
import { pageSession } from "@/lib/guard";
import { getTenant } from "@/lib/tenant";
import { tenantDb } from "@/lib/db";
import { roleHome } from "@/lib/auth";
import { googleConfigured } from "@/lib/google";
import { noticeText } from "@/lib/login-notices";
import SecurityPanel from "@/components/auth/SecurityPanel";

/** Two-step sign-in and Google for whoever is signed in on this business (every role). */
export default async function SecurityPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const [tenant, session, q] = await Promise.all([getTenant(), pageSession(), searchParams]);
  if (!tenant) redirect("/");
  if (!session || session.via === "support") redirect("/login");
  const u = await tenantDb(tenant.id).user.findUnique({ where: { id: session.userId }, select: { role: true, totpEnabledAt: true, recoveryCodes: true, googleEmail: true } });
  if (!u) redirect("/login");
  return (
    <main className="mx-auto w-full max-w-lg px-4 py-8">
      <SecurityPanel
        status={{ required: u.role !== "RETAILER", enabled: !!u.totpEnabledAt, recoveryLeft: u.recoveryCodes.length, googleEmail: u.googleEmail, googleAvailable: googleConfigured() }}
        endpoint="/api/auth/security"
        googleStart="/api/auth/google/start"
        homeHref={roleHome(u.role)}
        selfHref="/account/security"
        notice={noticeText(typeof q.notice === "string" ? q.notice : null)}
      />
    </main>
  );
}
