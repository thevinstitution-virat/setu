"use client";

import { useLanguage } from "@/lib/i18n/LanguageProvider";
import { landingContent } from "@/lib/i18n/landing-content";
import { useScrollProgress, useReducedMotion, clamp } from "./use-landing";

export default function DayTimelineSection() {
  const { lang } = useLanguage();
  const c = landingContent[lang];
  const reduced = useReducedMotion();
  const [ref, p] = useScrollProgress<HTMLDivElement>(c.timeline.length);

  return (
    <section id="journey" className="bg-ink text-white py-10">
      <div className="max-w-xl mx-auto px-4 text-center mb-6">
        <p className="text-sm font-bold uppercase tracking-widest text-gold">{c.timelineKicker}</p>
        <h2 className="mt-2 text-2xl sm:text-3xl font-bold [text-wrap:balance]">{c.timelineTitle}</h2>
      </div>

      <div ref={ref} className="relative max-w-2xl mx-auto px-4" style={{ minHeight: `${c.timeline.length * 70}vh` }}>
        <div className="absolute left-[27px] top-0 bottom-0 w-px bg-white/10 sm:left-[31px]" />
        {c.timeline.map((stop, i) => {
          const d = p - i;
          const ad = Math.abs(d);
          const on = p > i - 0.45;
          const k = reduced ? 0 : 22;
          const style = reduced
            ? {}
            : {
                opacity: clamp(1 - ad * 0.7, 0.25, 1),
                transform: `translateY(${clamp(-d * k, -k, k).toFixed(1)}px)`,
                transition: "opacity .4s, transform .6s cubic-bezier(.2,.8,.2,1)",
              };
          return (
            <div key={stop.time} className="relative flex min-h-[80vh] items-center gap-5 sm:gap-6" style={style}>
              <div className="relative shrink-0 flex flex-col items-center">
                <span
                  className={`h-14 w-14 sm:h-16 sm:w-16 rounded-full border-2 flex items-center justify-center text-2xl transition-colors ${
                    on ? "border-gold bg-ink-2" : "border-white/15 bg-ink-2/60"
                  }`}
                >
                  {stop.icon}
                </span>
              </div>
              <div className="pb-10">
                <p className="text-xs font-bold uppercase tracking-widest text-white/40">
                  {stop.phase} · {stop.time}
                </p>
                <h3 className="mt-2 text-xl font-semibold [text-wrap:balance]">{stop.title}</h3>
                <p className="mt-1.5 text-white/60 max-w-md">{stop.body}</p>
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}
