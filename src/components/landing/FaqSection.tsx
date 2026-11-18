"use client";

import { useState } from "react";
import { useLanguage } from "@/lib/i18n/LanguageProvider";
import { landingContent } from "@/lib/i18n/landing-content";

export default function FaqSection() {
  const { lang } = useLanguage();
  const c = landingContent[lang];
  const [open, setOpen] = useState(0);

  return (
    <section className="ls-sec" id="faq" style={{ paddingTop: 0 }}>
      <div className="ls-rv" style={{ textAlign: "center" }}>
        <div className="ls-kick" style={{ justifyContent: "center" }}>{c.faqKick}</div>
        <h2 className="ls-h2">{c.faqTitle}</h2>
      </div>
      <div className="ls-faq">
        {c.faq.map((item, i) => (
          <div className="ls-qa glass" key={item.q}>
            <button
              type="button"
              className={`ls-qbtn ${i === open ? "open" : ""}`}
              aria-expanded={i === open}
              onClick={() => setOpen(i === open ? -1 : i)}
            >
              <span>{item.q}</span>
              <span className="ls-qx">
                <svg viewBox="0 0 24 24" className="h-4 w-4" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                  <path d="M12 5v14M5 12h14" />
                </svg>
              </span>
            </button>
            {i === open && <p className="ls-ans">{item.a}</p>}
          </div>
        ))}
      </div>
    </section>
  );
}
