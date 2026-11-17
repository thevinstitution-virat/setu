"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useLanguage } from "@/lib/i18n/LanguageProvider";
import { landingContent } from "@/lib/i18n/landing-content";
import { APP_SHORT_NAME } from "@/lib/brand";
import LanguageToggle from "@/components/LanguageToggle";

export default function LandingNav() {
  const { lang } = useLanguage();
  const c = landingContent[lang];
  const [scrolled, setScrolled] = useState(false);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 24);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  return (
    <nav
      className={`fixed top-0 inset-x-0 z-30 transition-all ${
        scrolled ? "bg-ink/80 backdrop-blur-md border-b border-white/10 py-2.5" : "bg-transparent py-4"
      }`}
    >
      <div className="max-w-5xl mx-auto px-4 flex items-center justify-between text-white">
        <div className="flex items-center gap-2">
          <div className="h-8 w-8 rounded-lg bg-gold text-ink font-bold flex items-center justify-center text-sm">
            S
          </div>
          <span className="font-semibold">{APP_SHORT_NAME}</span>
        </div>
        <div className="flex items-center gap-3">
          <LanguageToggle />
          <Link
            href="/login"
            className="rounded-lg bg-gold text-ink text-sm font-semibold px-4 py-2 hover:brightness-110 transition"
          >
            {c.ctaPrimary}
          </Link>
        </div>
      </div>
    </nav>
  );
}
