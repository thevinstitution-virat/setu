import { redirect } from "next/navigation";
import { currentBrand } from "@/lib/branding-server";
import { appNameOf } from "@/lib/branding";
import { tenantDb } from "@/lib/db";
import { readPending, smsFallbackAllowed } from "@/lib/mfa";
import TwoStepScreen from "@/components/auth/TwoStepScreen";

/** "•••••• 3210": enough to know which phone, not enough to read it off a screen. */
const maskPhone = (p: string) => `•••••• ${p.replace(/\D/g, "").slice(-4)}`;

/**
 * Second step of signing in on a business address (lib/mfa.ts): set up the
 * authenticator app the first time, else type its code (or a recovery code,
 * or an SMS code when the first step wasn't a mobile OTP).
 */
export default async function TwoStepPage() {
  const { tenant, brand } = await currentBrand();
  if (!tenant) redirect("/login");
  const pending = await readPending(tenant.id);
  if (!pending) redirect("/login?notice=mfa-expired");
  const user = await tenantDb(tenant.id).user.findUnique({ where: { id: pending.userId }, select: { active: true, phone: true, totpEnabledAt: true } });
  if (!user?.active) redirect("/login");
  const mode = user.totpEnabledAt ? "verify" : "setup";
  const smsPhone = mode === "verify" && user.phone && smsFallbackAllowed(pending.via) ? maskPhone(user.phone) : null;
  return <TwoStepScreen appName={appNameOf(brand, tenant.name)} logoUrl={brand.logoKey ? "/brand/logo" : null} mode={mode} smsPhone={smsPhone} />;
}
