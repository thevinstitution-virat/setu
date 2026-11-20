import { redirect } from "next/navigation";
import { getSession, roleHome } from "@/lib/auth";
import { headers } from "next/headers";
import { classifyHost, getTenant, normaliseHost, platformDomain } from "@/lib/tenant";
import ProNav from "@/components/landing/pro/ProNav";
import ProHero from "@/components/landing/pro/ProHero";
import {
  CtaBand,
  FaqSection,
  FeatureGrid,
  ProblemsSection,
  ProFooter,
  RetailSection,
  StatsBand,
  StepsSection,
  TrustStrip,
} from "@/components/landing/pro/ProSections";
import LandingFx from "@/components/landing/LandingFx";

export default async function Home() {
  const session = await getSession();
  if (session) redirect(roleHome(session.role));
  // A business's own address opens its sign-in page (in its own brand), not our
  // marketing site. The bare platform address keeps the marketing site even
  // when DEFAULT_TENANT_SLUG points it at a business (local dev).
  const h = await headers();
  const host = normaliseHost(h.get("x-forwarded-host") ?? h.get("host"));
  if (classifyHost(host, platformDomain(), null).kind !== "platform" && (await getTenant())) redirect("/login");

  return (
    <div className="ls vp flex min-h-screen flex-col overflow-x-clip" id="top">
      <ProNav />
      <main className="flex flex-col">
        <ProHero />
        <TrustStrip />
        <ProblemsSection />
        <RetailSection />
        <StatsBand />
        <FeatureGrid />
        <StepsSection />
        <FaqSection />
        <CtaBand />
      </main>
      <ProFooter />
      <LandingFx />
    </div>
  );
}
