"use client";

import { useEffect, useState } from "react";
import { useLanguage } from "@/lib/i18n/LanguageProvider";
import { landingContent } from "@/lib/i18n/landing-content";
import { useSeen, useReducedMotion } from "./use-landing";

export default function StatsCountSection() {
  const { lang } = useLanguage();
  const c = landingContent[lang];
  const reduced = useReducedMotion();
  const [ref, seen] = useSeen<HTMLElement>(0.3);
  const [t, setT] = useState(0);

  useEffect(() => {
    if (!seen) return;
    if (reduced) {
      setT(1);
      return;
    }
    let raf = 0;
    const t0 = performance.now();
    const step = (now: number) => {
      const k = Math.min(1, (now - t0) / 1200);
      setT(1 - Math.pow(1 - k, 3));
      if (k < 1) raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [seen, reduced]);

  return (
    <section ref={ref} className="bg-background border-y border-black/5 py-16">
      <div className="max-w-5xl mx-auto px-4">
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-6">
          {c.stats.map((s) => (
            <div key={s.label} className="text-center">
              <p className="text-4xl sm:text-5xl font-bold text-brand-dark tabular-nums">
                {(s.value * t).toFixed(s.decimals)}
                {s.suffix}
              </p>
              <p className="mt-1.5 text-sm text-foreground/50">{s.label}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
