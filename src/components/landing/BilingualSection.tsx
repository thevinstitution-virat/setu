"use client";

import { useLanguage } from "@/lib/i18n/LanguageProvider";
import { landingContent } from "@/lib/i18n/landing-content";
import LanguageToggle from "@/components/LanguageToggle";

export default function BilingualSection() {
  const { lang } = useLanguage();
  const c = landingContent[lang];

  return (
    <section className="ls-sec" style={{ paddingTop: 0 }}>
      <div className="ls-split">
        <div className="ls-rv">
          <div className="ls-kick">भाषा · Language</div>
          <h2 className="ls-h2">{c.lTitle}</h2>
          <p className="ls-sub">{c.lSub}</p>
          <div style={{ marginTop: 26 }}>
            <LanguageToggle />
          </div>
        </div>
        <div className="ls-flip ls-rv">
          <div className="ls-fcard glass ls-f-en">
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <span style={{ fontSize: 12.5, fontWeight: 700, color: "var(--kesar-text)" }}>Order status</span>
              <span className="chip chip-mor">EN</span>
            </div>
            <h4>Basmati Rice 5 kg × 4</h4>
            <p>Sharma Kirana · SETU-1042</p>
            <span className="ls-fstat">Out for delivery · 12 min</span>
          </div>
          <div className="ls-fcard glass ls-f-hi">
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <span style={{ fontSize: 12.5, fontWeight: 700, color: "var(--kesar-text)" }}>ऑर्डर की स्थिति</span>
              <span className="chip chip-mor">हिं</span>
            </div>
            <h4>बासमती चावल 5 किलो × 4</h4>
            <p>शर्मा किराना · SETU-1042</p>
            <span className="ls-fstat">डिलीवरी के लिए निकला · 12 मिनट</span>
          </div>
        </div>
      </div>
    </section>
  );
}
