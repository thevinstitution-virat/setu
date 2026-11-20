"use client";

import Link from "next/link";
import { useLanguage } from "@/lib/i18n/LanguageProvider";
import { landingContent } from "@/lib/i18n/landing-content";

const WHATSAPP_NUMBER = process.env.NEXT_PUBLIC_WHATSAPP_NUMBER;

export default function CtaFooterSection() {
  const { lang } = useLanguage();
  const c = landingContent[lang];

  return (
    <>
      <section className="ls-sec" id="demo" style={{ paddingTop: 0 }}>
        <div className="ls-cta">
          <svg className="ls-cta-br" viewBox="0 0 1100 220" aria-hidden="true">
            <path d="M0 210 L 300 40 Q 550 260 800 40 L 1100 210" />
            <path d="M0 214H1100" />
            <path d="M300 40V214M800 40V214M380 96V214M460 134V214M550 150V214M640 134V214M720 96V214" />
          </svg>
          <div style={{ position: "relative" }}>
            <div className="ls-kick">{c.ctaKick}</div>
            <h2 className="ls-h2">{c.ctaTitle}</h2>
            <p className="ls-sub">{c.ctaSub}</p>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 12, justifyContent: "center", marginTop: 30 }}>
              <Link href="/start" className="btn btn-kesar btn-lg">
                {lang === "hi" ? "मुफ़्त ट्रायल शुरू करें" : "Start free trial"}
                <svg viewBox="0 0 24 24" className="h-4 w-4" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                  <path d="M5 12h14M13 6l6 6-6 6" />
                </svg>
              </Link>
              {WHATSAPP_NUMBER && (
                <a
                  href={`https://wa.me/${WHATSAPP_NUMBER}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="btn btn-lg"
                  style={{ background: "rgba(255,255,255,.1)", color: "#fff", border: "1.5px solid rgba(255,255,255,.3)" }}
                >
                  {c.ctaWa}
                </a>
              )}
            </div>
          </div>
        </div>
      </section>
      <footer className="ls-foot">
        <a className="ls-brand" href="#top">
          <span className="ls-brand-mark">
            <svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
              <path d="M2 17c4-7 16-7 20 0" />
              <path d="M2 17h20M6 17v-3.5M10 17v-5M14 17v-5M18 17v-3.5" />
            </svg>
          </span>
          <span>
            <span className="ls-brand-name">Seller&apos;s Setu</span>
            <span style={{ display: "block", fontSize: 13, marginTop: 3, color: "var(--muted)" }}>{c.footTag}</span>
          </span>
        </a>
        <span>
          {c.footProduct} ·{" "}
          <a href="https://vgraphics.in" target="_blank" rel="noopener noreferrer">
            {c.footDesign}
          </a>{" "}
          · <a href="/legal/terms">Terms</a> · <a href="/legal/privacy">Privacy</a>
        </span>
      </footer>
    </>
  );
}
