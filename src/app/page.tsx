import { redirect } from "next/navigation";
import { getSession, roleHome } from "@/lib/auth";
import { headers } from "next/headers";
import { classifyHost, getTenant, normaliseHost, platformDomain } from "@/lib/tenant";
import LandingNav from "@/components/landing/LandingNav";
import HeroSection from "@/components/landing/HeroSection";
import BuiltForStrip from "@/components/landing/BuiltForStrip";
import JourneySection from "@/components/landing/JourneySection";
import GodownSection from "@/components/landing/GodownSection";
import LiveMapSection from "@/components/landing/LiveMapSection";
import BeatSection from "@/components/landing/BeatSection";
import BillingSection from "@/components/landing/BillingSection";
import OwnerDashboardSection from "@/components/landing/OwnerDashboardSection";
import BilingualSection from "@/components/landing/BilingualSection";
import StepsSection from "@/components/landing/StepsSection";
import FaqSection from "@/components/landing/FaqSection";
import CtaFooterSection from "@/components/landing/CtaFooterSection";
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
    <div className="ls flex min-h-screen flex-col overflow-x-clip" id="top">
      <LandingNav />
      <main className="flex flex-col">
        <HeroSection />
        <BuiltForStrip />
        <JourneySection />
        <GodownSection />
        <LiveMapSection />
        <BeatSection />
        <BillingSection />
        <OwnerDashboardSection />
        <BilingualSection />
        <StepsSection />
        <FaqSection />
      </main>
      <CtaFooterSection />
      <LandingFx />
    </div>
  );
}
