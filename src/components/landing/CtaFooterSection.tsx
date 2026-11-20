"use client";

import Link from "next/link";
import { useLanguage } from "@/lib/i18n/LanguageProvider";
import { landingContent } from "@/lib/i18n/landing-content";
import LanguageToggle from "@/components/LanguageToggle";

const WHATSAPP_NUMBER = process.env.NEXT_PUBLIC_WHATSAPP_NUMBER;
const CONTACT_EMAIL = process.env.NEXT_PUBLIC_CONTACT_EMAIL;

function BrandMark() {
  return (
    <span className="ls-brand-mark">
      <svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
        <path d="M2 17c4-7 16-7 20 0" />
        <path d="M2 17h20M6 17v-3.5M10 17v-5M14 17v-5M18 17v-3.5" />
      </svg>
    </span>
  );
}

export default function CtaFooterSection() {
  const { lang } = useLanguage();
  const c = landingContent[lang];

  return (
    <>
      <section className="ls-sec" id="demo" style={{ paddingTop: 0 }}>
        <div className="ls-cta ls-rv">
          <div className="ls-aurora soft" aria-hidden="true">
            <i className="a1" />
            <i className="a2" />
          </div>
          <svg className="ls-cta-br" viewBox="0 0 1100 220" aria-hidden="true">
            <path pathLength={1} d="M0 210 L 300 40 Q 550 260 800 40 L 1100 210" />
            <path pathLength={1} d="M0 214H1100" />
            <path pathLength={1} d="M300 40V214M800 40V214M380 96V214M460 134V214M550 150V214M640 134V214M720 96V214" />
          </svg>
          <div style={{ position: "relative" }}>
            <div className="ls-kick">{c.ctaKick}</div>
            <h2 className="ls-h2">{c.ctaTitle}</h2>
            <p className="ls-sub">{c.ctaSub}</p>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 12, justifyContent: "center", marginTop: 30 }}>
              <Link href="/start" className="btn btn-kesar btn-lg ls-shine">
                {c.cta1}
                <svg viewBox="0 0 24 24" className="h-4 w-4" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                  <path d="M5 12h14M13 6l6 6-6 6" />
                </svg>
              </Link>
              {WHATSAPP_NUMBER ? (
                <a href={`https://wa.me/${WHATSAPP_NUMBER}`} target="_blank" rel="noopener noreferrer" className="btn btn-lg ls-btn-ghost">
                  {c.ctaWa}
                </a>
              ) : (
                <Link href="/login" className="btn btn-lg ls-btn-ghost">
                  {c.signIn}
                </Link>
              )}
            </div>
          </div>
        </div>
      </section>

      <footer className="ls-foot">
        <div className="ls-foot-grid">
          <div className="ls-foot-brand">
            <a className="ls-brand" href="#top">
              <BrandMark />
              <span>
                <span className="ls-brand-name">Seller&apos;s Setu</span>
                <span className="ls-brand-hi">सेलर्स सेतु</span>
              </span>
            </a>
            <p>{c.footTag}</p>
            <LanguageToggle />
          </div>
          <nav aria-label={c.footExplore}>
            <h3>{c.footExplore}</h3>
            <a href="#journey">{c.navJourney}</a>
            <a href="#godown">{c.navGodown}</a>
            <a href="#map">{c.navMap}</a>
            <a href="#beat">{c.navBeat}</a>
            <a href="#billing">{c.navBill}</a>
            <a href="#owner">{c.navOwner}</a>
          </nav>
          <nav aria-label={c.footStart}>
            <h3>{c.footStart}</h3>
            <Link href="/start">{c.cta1}</Link>
            <Link href="/login">{c.signIn}</Link>
            <a href="#faq">{c.navFaq}</a>
          </nav>
          {(WHATSAPP_NUMBER || CONTACT_EMAIL) && (
            <nav aria-label={c.footTalk}>
              <h3>{c.footTalk}</h3>
              {WHATSAPP_NUMBER && (
                <a href={`https://wa.me/${WHATSAPP_NUMBER}`} target="_blank" rel="noopener noreferrer">
                  {c.ctaWa}
                </a>
              )}
              {CONTACT_EMAIL && <a href={`mailto:${CONTACT_EMAIL}`}>{c.footEmail}</a>}
            </nav>
          )}
        </div>
        <div className="ls-foot-bar">
          <span>
            © {new Date().getFullYear()} {c.footProduct}
          </span>
          <span className="ls-foot-links">
            <a href="https://vgraphics.in" target="_blank" rel="noopener noreferrer">
              {c.footDesign}
            </a>
            <a href="/legal/terms">Terms</a>
            <a href="/legal/privacy">Privacy</a>
          </span>
        </div>
      </footer>
    </>
  );
}
