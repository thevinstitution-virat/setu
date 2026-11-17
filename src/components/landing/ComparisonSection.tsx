"use client";

import { useLanguage } from "@/lib/i18n/LanguageProvider";
import { landingContent } from "@/lib/i18n/landing-content";

export default function ComparisonSection() {
  const { lang } = useLanguage();
  const c = landingContent[lang];

  return (
    <section className="bg-background py-20">
      <div className="max-w-5xl mx-auto px-4">
        <div className="text-center mb-12">
          <p className="text-sm font-bold uppercase tracking-widest text-brand-dark">{c.compareKicker}</p>
          <h2 className="mt-2 text-2xl sm:text-3xl font-bold [text-wrap:balance]">{c.compareTitle}</h2>
        </div>

        <div className="grid sm:grid-cols-2 gap-6 items-stretch">
          <div className="card p-6 sm:p-8">
            <p className="text-sm font-semibold text-foreground/40 mb-5">{c.compareBefore}</p>
            <div className="flex items-center justify-center gap-2 mb-6">
              {[0, 1, 2].map((i) => (
                <div key={i} className="flex flex-col items-center gap-1">
                  <div className="h-16 w-10 rounded-lg border-2 border-dashed border-foreground/20" />
                  {i < 2 && <div className="h-px w-5 border-t border-dashed border-foreground/20 -mt-8" />}
                </div>
              ))}
            </div>
            <ul className="space-y-2.5">
              {c.compareBeforeItems.map((item) => (
                <li key={item} className="flex items-start gap-2 text-sm text-foreground/60">
                  <span className="text-foreground/30 mt-0.5">✕</span>
                  {item}
                </li>
              ))}
            </ul>
          </div>

          <div className="card p-6 sm:p-8 border-2 border-brand/30 bg-brand-light/30">
            <p className="text-sm font-semibold text-brand-dark mb-5">{c.compareAfter}</p>
            <div className="flex items-center justify-center mb-6">
              <div className="relative h-16 w-10 rounded-lg border-2 border-brand bg-white flex items-center justify-center">
                <span className="h-2.5 w-2.5 rounded-full bg-gold setu-breathe" />
              </div>
            </div>
            <ul className="space-y-2.5">
              {c.compareAfterItems.map((item) => (
                <li key={item} className="flex items-start gap-2 text-sm text-foreground/80 font-medium">
                  <span className="text-brand mt-0.5">✓</span>
                  {item}
                </li>
              ))}
            </ul>
          </div>
        </div>
      </div>
    </section>
  );
}
