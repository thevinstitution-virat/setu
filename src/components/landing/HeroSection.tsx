"use client";

import Link from "next/link";
import { useLanguage } from "@/lib/i18n/LanguageProvider";
import { landingContent } from "@/lib/i18n/landing-content";
import BridgeAnimation from "./BridgeAnimation";

export default function HeroSection() {
  const { lang, t } = useLanguage();
  const c = landingContent[lang];

  return (
    <section className="landing-grid relative overflow-hidden bg-ink text-white">
      <div aria-hidden className="landing-glow setu-breathe pointer-events-none absolute -right-32 -top-20 h-[700px] w-[700px] rounded-full" />

      <div className="relative max-w-5xl mx-auto px-4 pt-28 pb-16 sm:pt-36 sm:pb-24 text-center">
        <span className="inline-flex items-center gap-2 rounded-full border border-white/15 bg-white/5 px-4 py-1.5 text-sm text-white/70">
          <span className="h-2 w-2 rounded-full bg-gold shadow-[0_0_10px_var(--gold)]" />
          {c.eyebrow}
        </span>

        <h1 className="mt-6 font-bold leading-[1.05] tracking-tight text-[clamp(32px,6vw,64px)] [text-wrap:balance]">
          {c.heroLead}{" "}
          <span className="bg-gradient-to-r from-gold to-brand-light bg-clip-text text-transparent">
            {c.heroAccent}
          </span>
        </h1>

        <p className="mt-5 max-w-xl mx-auto text-base sm:text-lg text-white/60 [text-wrap:pretty]">
          {c.heroSub}
        </p>

        <div className="mt-8 flex flex-col sm:flex-row items-center justify-center gap-3">
          <Link
            href="/login"
            className="w-full sm:w-auto rounded-xl bg-gold text-ink font-semibold px-7 py-3 hover:brightness-110 transition"
          >
            {c.ctaPrimary}
          </Link>
          <a
            href="#journey"
            className="w-full sm:w-auto rounded-xl border border-white/20 bg-white/5 text-white font-medium px-7 py-3 hover:bg-white/10 transition"
          >
            {c.ctaSecondary}
          </a>
        </div>

        <div className="mt-14 max-w-2xl mx-auto setu-floaty">
          <BridgeAnimation />
        </div>
        <p className="sr-only">{t("brand.tagline")}</p>
      </div>
    </section>
  );
}
