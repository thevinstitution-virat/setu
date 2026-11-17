"use client";

import { useState } from "react";
import { useLanguage } from "@/lib/i18n/LanguageProvider";
import { landingContent } from "@/lib/i18n/landing-content";

export default function FaqSection() {
  const { lang } = useLanguage();
  const c = landingContent[lang];
  const [open, setOpen] = useState<number | null>(0);

  return (
    <section className="bg-ink text-white py-20">
      <div className="max-w-2xl mx-auto px-4">
        <div className="text-center mb-10">
          <p className="text-sm font-bold uppercase tracking-widest text-gold">{c.faqKicker}</p>
          <h2 className="mt-2 text-2xl sm:text-3xl font-bold [text-wrap:balance]">{c.faqTitle}</h2>
        </div>

        <div className="space-y-2">
          {c.faq.map((item, i) => (
            <div key={item.q} className="rounded-xl border border-white/10 overflow-hidden">
              <button
                onClick={() => setOpen(open === i ? null : i)}
                className="w-full flex items-center justify-between gap-4 px-5 py-4 text-left"
              >
                <span className="font-medium text-sm sm:text-base">{item.q}</span>
                <span className={`shrink-0 transition-transform ${open === i ? "rotate-45" : ""}`}>+</span>
              </button>
              {open === i && <p className="px-5 pb-4 text-sm text-white/60">{item.a}</p>}
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
