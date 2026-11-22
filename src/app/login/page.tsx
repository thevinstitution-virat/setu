import { noticeText } from "@/lib/login-notices";
import { currentBrand } from "@/lib/branding-server";
import { appNameOf } from "@/lib/branding";
import LoginCard from "@/components/signup/LoginCard";
import { googleConfigured } from "@/lib/google";

type Query = Promise<Record<string, string | string[] | undefined>>;

const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? "";
/** Same rule as lib/referrals normaliseCode: capitals and digits, 12 at most. */
const normaliseRef = (v: string) => v.trim().toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 12);

/**
 * Sign-in, in the business's own brand (name, logo, sign-in line) on its
 * address; ours on the platform address.
 *
 * ?phone=XXXXXXXXXX opens the staff tab in OTP mode with the phone filled in
 * (switching business from a password session). ?error=<code> shows why a business
 * switch link failed. ?notice=<code> is a message the server sent us here with
 * (support session ended, welcome link expired or used). Only known codes
 * (lib/login-notices.ts) show anything: text in the address is never displayed. ?ref=CODE (a shop's
 * refer-and-earn link) fills the referral code on the retailer sign-up form.
 */
export default async function LoginPage({ searchParams }: { searchParams: Query }) {
  const [q, { tenant, brand }] = await Promise.all([searchParams, currentBrand()]);
  const raw = one(q.phone).replace(/\D/g, "");
  return (
    <LoginCard
      brand={{
        business: !!tenant,
        appName: appNameOf(brand, tenant?.name),
        tagline: brand.tagline ?? null,
        logoUrl: brand.logoKey ? "/brand/logo" : null,
      }}
      initialPhone={/^\d{10}$/.test(raw) ? raw : ""}
      linkError={noticeText(one(q.error))}
      notice={noticeText(one(q.notice))}
      initialRef={normaliseRef(one(q.ref))}
      google={googleConfigured()}
    />
  );
}
