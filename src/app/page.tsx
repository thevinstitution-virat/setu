import { redirect } from "next/navigation";
import { getSession, roleHome } from "@/lib/auth";
import { headers } from "next/headers";
import { classifyHost, getTenant, normaliseHost, platformDomain } from "@/lib/tenant";
import BtLanding from "@/components/landing/bt/BtLanding";

export default async function Home() {
  const session = await getSession();
  if (session) redirect(roleHome(session.role));
  // A business's own address opens its sign-in page (in its own brand), not our
  // marketing site. The bare platform address keeps the marketing site even
  // when DEFAULT_TENANT_SLUG points it at a business (local dev).
  const h = await headers();
  const host = normaliseHost(h.get("x-forwarded-host") ?? h.get("host"));
  if (classifyHost(host, platformDomain(), null).kind !== "platform" && (await getTenant())) redirect("/login");

  return <BtLanding />;
}
