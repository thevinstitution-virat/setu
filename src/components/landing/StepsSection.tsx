"use client";

import { useLanguage } from "@/lib/i18n/LanguageProvider";
import { landingContent } from "@/lib/i18n/landing-content";

export default function StepsSection() {
  const { lang } = useLanguage();
  const c = landingContent[lang];

  return (
    <section className="ls-sec" style={{ paddingTop: 0 }}>
      <div className="ls-rv" style={{ maxWidth: 780 }}>
        <div className="ls-kick">{c.goKick}</div>
        <h2 className="ls-h2">{c.goTitle}</h2>
      </div>
      <div className="ls-steps3">
        <div className="ls-s3 glass ls-rv">
          <span className="num">01</span>
          <h3>{c.g1}</h3>
          <p>{c.g1d}</p>
        </div>
        <div className="ls-s3 glass ls-rv">
          <span className="num">02</span>
          <h3>{c.g2}</h3>
          <p>{c.g2d}</p>
        </div>
        <div className="ls-s3 mor ls-rv">
          <span className="num">03</span>
          <h3>{c.g3}</h3>
          <p>{c.g3d}</p>
        </div>
      </div>
    </section>
  );
}
