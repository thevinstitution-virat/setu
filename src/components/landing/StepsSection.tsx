"use client";

import { useLanguage } from "@/lib/i18n/LanguageProvider";
import { landingContent } from "@/lib/i18n/landing-content";

export default function StepsSection() {
  const { lang } = useLanguage();
  const c = landingContent[lang];
  const steps = [
    { t: c.g1, d: c.g1d },
    { t: c.g2, d: c.g2d },
    { t: c.g3, d: c.g3d },
  ];

  return (
    <section className="ls-sec" style={{ paddingTop: 0 }}>
      <div className="ls-rv" style={{ maxWidth: 780 }}>
        <div className="ls-kick">{c.goKick}</div>
        <h2 className="ls-h2">{c.goTitle}</h2>
      </div>
      <div className="ls-steps3 ls-rv">
        <svg className="ls-steps-line" viewBox="0 0 1000 20" preserveAspectRatio="none" aria-hidden="true">
          <path d="M60 10H940" />
        </svg>
        {steps.map((s, i) => (
          <div className={`ls-s3 ls-glow ${i === 2 ? "mor" : "glass"}`} key={i} style={{ "--i": i } as React.CSSProperties}>
            <span className="num">{String(i + 1).padStart(2, "0")}</span>
            <h3>{s.t}</h3>
            <p>{s.d}</p>
          </div>
        ))}
      </div>
    </section>
  );
}
