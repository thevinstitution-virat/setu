import { redirect } from "next/navigation";
import { getSession, roleHome } from "@/lib/auth";
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

export default async function Home() {
  const session = await getSession();
  if (session) redirect(roleHome(session.role));

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
    </div>
  );
}
