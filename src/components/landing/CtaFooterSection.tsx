"use client";

import Link from "next/link";
import { useLanguage } from "@/lib/i18n/LanguageProvider";
import { landingContent } from "@/lib/i18n/landing-content";
import { APP_NAME } from "@/lib/brand";

export default function CtaFooterSection() {
  const { lang } = useLanguage();
  const c = landingContent[lang];

  return (
    <footer className="bg-ink text-white">
      <div className="landing-grid relative overflow-hidden py-20 text-center">
        <div aria-hidden className="landing-glow pointer-events-none absolute left-1/2 top-0 h-[400px] w-[700px] -translate-x-1/2" />
        <div className="relative max-w-xl mx-auto px-4">
          <h2 className="text-2xl sm:text-3xl font-bold [text-wrap:balance]">{c.ctaFooterTitle}</h2>
          <p className="mt-3 text-white/60">{c.ctaFooterSub}</p>
          <Link
            href="/login"
            className="inline-block mt-7 rounded-xl bg-gold text-ink font-semibold px-8 py-3 hover:brightness-110 transition"
          >
            {c.ctaPrimary}
          </Link>
        </div>
      </div>

      <div className="border-t border-white/10 py-8">
        <div className="max-w-5xl mx-auto px-4 flex flex-col sm:flex-row items-center justify-between gap-3 text-center sm:text-left">
          <div>
            <p className="font-semibold">{APP_NAME}</p>
            <p className="text-xs text-white/40 mt-0.5">{c.footerTagline}</p>
          </div>
          <div className="text-xs text-white/40 space-y-1">
            <p>{c.footerProductOf}</p>
            <p>
              {c.footerDesignBy} ·{" "}
              <a
                href="https://vgraphics.in"
                target="_blank"
                rel="noopener noreferrer"
                className="text-gold hover:underline"
              >
                vgraphics.in
              </a>
            </p>
          </div>
        </div>
      </div>
    </footer>
  );
}
