"use client";

import Link from "next/link";
import { useLanguage } from "@/lib/i18n/LanguageProvider";
import { landingContent } from "@/lib/i18n/landing-content";
import LanguageToggle from "@/components/LanguageToggle";

export default function LandingNav() {
  const { lang } = useLanguage();
  const c = landingContent[lang];

  return (
    <nav className="ls-nav" aria-label="Primary">
      <div className="ls-nav-row">
        <a className="ls-brand" href="#top">
          <span className="ls-brand-mark">
            <svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
              <path d="M2 17c4-7 16-7 20 0" />
              <path d="M2 17h20M6 17v-3.5M10 17v-5M14 17v-5M18 17v-3.5" />
            </svg>
          </span>
          <span>
            <span className="ls-brand-name">Seller&apos;s Setu</span>
            <span className="ls-brand-hi">सेलर्स सेतु</span>
          </span>
        </a>
        <div className="ls-links">
          <a href="#journey">{c.navJourney}</a>
          <a href="#godown">{c.navGodown}</a>
          <a href="#map">{c.navMap}</a>
          <a href="#billing">{c.navBill}</a>
          <a href="#faq">{c.navFaq}</a>
        </div>
        <span style={{ flex: 1 }} />
        <LanguageToggle />
        <Link href="/login" className="font-bold text-[15px] text-ink whitespace-nowrap hidden sm:inline">
          {c.signIn}
        </Link>
        <Link href="#demo" className="btn btn-kesar">
          {c.demo}
        </Link>
      </div>
    </nav>
  );
}
