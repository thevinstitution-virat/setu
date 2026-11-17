import { redirect } from "next/navigation";
import { getSession, roleHome } from "@/lib/auth";
import LandingNav from "@/components/landing/LandingNav";
import HeroSection from "@/components/landing/HeroSection";
import DayTimelineSection from "@/components/landing/DayTimelineSection";
import ComparisonSection from "@/components/landing/ComparisonSection";
import BilingualDemoSection from "@/components/landing/BilingualDemoSection";
import StatsCountSection from "@/components/landing/StatsCountSection";
import FeatureGridSection from "@/components/landing/FeatureGridSection";
import FaqSection from "@/components/landing/FaqSection";
import CtaFooterSection from "@/components/landing/CtaFooterSection";

export default async function Home() {
  const session = await getSession();
  if (session) redirect(roleHome(session.role));

  return (
    <div className="flex min-h-screen flex-col overflow-x-clip">
      <LandingNav />
      <main className="flex flex-col">
        <HeroSection />
        <DayTimelineSection />
        <ComparisonSection />
        <BilingualDemoSection />
        <StatsCountSection />
        <FeatureGridSection />
        <FaqSection />
      </main>
      <CtaFooterSection />
    </div>
  );
}
