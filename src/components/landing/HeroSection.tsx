"use client";

import Link from "next/link";
import { useLanguage } from "@/lib/i18n/LanguageProvider";
import { landingContent } from "@/lib/i18n/landing-content";
import { Confetti, useInView } from "./use-landing";

export default function HeroSection() {
  const { lang } = useLanguage();
  const c = landingContent[lang];
  const [ref, inView] = useInView<HTMLDivElement>();

  return (
    <section className="ls-hero" ref={ref} style={{ animationPlayState: inView ? "running" : "paused" }}>
      <div style={{ display: "flex", flexDirection: "column", gap: 20, minWidth: 0 }}>
        <span className="ls-pill">
          <b>{c.pillTag}</b>
          {c.pill}
        </span>
        <h1 className="ls-h1">
          {c.h1a} <span className="ls-mark">{c.h1b}</span>
        </h1>
        <p className="ls-lead" style={{ maxWidth: 540 }}>
          <b>Seller&apos;s Setu</b> {c.lead}
        </p>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 12 }}>
          <Link href="#demo" className="btn btn-kesar btn-lg">
            {c.cta1}
            <svg viewBox="0 0 24 24" className="h-4 w-4" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
              <path d="M5 12h14M13 6l6 6-6 6" />
            </svg>
          </Link>
          <Link href="#journey" className="btn btn-glass btn-lg">
            <svg viewBox="0 0 24 24" className="h-4 w-4" aria-hidden="true" fill="currentColor">
              <path d="M8 5.5v13l11-6.5z" />
            </svg>
            {c.cta2}
          </Link>
        </div>
        <div className="ls-ticks">
          {[c.tick1, c.tick2, c.tick3].map((t) => (
            <span key={t}>
              <svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round">
                <path d="M5 12.5l4.5 4.5L19 7" />
              </svg>
              {t}
            </span>
          ))}
        </div>
      </div>

      <div className="ls-fleet ls" role="img" aria-label={c.sceneAria}>
        <div className="ls-fmap">
          <svg viewBox="0 0 1000 760" aria-hidden="true">
            <rect className="l-blk" x="16" y="16" width="120" height="120" rx="10" />
            <rect className="l-park" x="166" y="16" width="250" height="120" rx="12" />
            <rect className="l-blk" x="446" y="16" width="300" height="120" rx="10" />
            <rect className="l-blk" x="776" y="16" width="90" height="120" rx="10" />
            <rect className="l-blk" x="896" y="16" width="90" height="120" rx="10" />
            <rect className="l-blk" x="16" y="166" width="120" height="70" rx="10" />
            <rect className="l-blk" x="166" y="166" width="250" height="70" rx="10" />
            <rect className="l-blk" x="446" y="166" width="300" height="70" rx="10" />
            <rect className="l-blk" x="776" y="166" width="90" height="70" rx="10" />
            <rect className="l-blk" x="896" y="166" width="90" height="240" rx="10" />
            <rect className="l-blk" x="16" y="266" width="120" height="140" rx="10" />
            <rect className="l-blk" x="166" y="266" width="250" height="140" rx="10" />
            <rect className="l-park" x="446" y="266" width="300" height="140" rx="12" />
            <rect className="l-blk" x="776" y="266" width="90" height="140" rx="10" />
            <rect className="l-blk" x="16" y="436" width="120" height="150" rx="10" />
            <rect className="l-blk" x="166" y="436" width="250" height="150" rx="10" />
            <rect className="l-blk" x="446" y="436" width="300" height="150" rx="10" />
            <rect className="l-blk" x="776" y="436" width="90" height="150" rx="10" />
            <rect className="l-blk" x="896" y="436" width="90" height="150" rx="10" />
            <rect className="l-blk" x="16" y="616" width="120" height="130" rx="10" />
            <rect className="l-blk" x="166" y="616" width="250" height="60" rx="10" />
            <path className="l-water" d="M520 760 C 560 660, 680 610, 1000 630 L 1000 712 C 760 690, 660 720, 620 760 Z" />
            <path className="r-mo" d="M0 150H1000M0 250H1000M0 600H1000M150 0V760M760 0V760M880 0V760M0 712 C 280 660, 480 700, 700 650" />
            <path className="r-mi" d="M0 150H1000M0 250H1000M0 600H1000M150 0V760M760 0V760M880 0V760M0 712 C 280 660, 480 700, 700 650" />
            <path className="r-Mo" d="M0 420H1000M430 0V760" />
            <path className="r-Mi" d="M0 420H1000M430 0V760" />
            <text className="lbl" x="290" y="520" textAnchor="middle">AMINABAD</text>
            <text className="lbl" x="596" y="206" textAnchor="middle">HAZRATGANJ</text>
            <text className="lbl" x="596" y="520" textAnchor="middle">KAISERBAGH</text>
            <text className="lbl" x="290" y="210" textAnchor="middle">NAKHAS</text>
            <text className="lbl-s" x="596" y="342" textAnchor="middle">City Park</text>
            <text className="lbl-s" x="860" y="686" textAnchor="middle">Gomti</text>
            <path className="rt-case" d="M150 600V420H430V250H760V150H850" />
            <path className="rt-rem" d="M150 600V420H430V250H760V150H850" />
            <path className="rt-done" d="M150 600V420H430V250H760V150H850" />
          </svg>

          <span className="ls-mpill glass">
            <span className="ls-ldot" />
            {c.mapPill}
          </span>
          <div className="ls-ntoast glass">
            <span className="tile chip-kesar">
              <svg viewBox="0 0 24 24" className="h-4 w-4" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                <circle cx="9" cy="20" r="1.5" />
                <circle cx="18" cy="20" r="1.5" />
                <path d="M2 3h3l2.4 11.2a2 2 0 0 0 2 1.6h8.1a2 2 0 0 0 2-1.5L21 7H6" />
              </svg>
            </span>
            <span>
              <b>{c.nt1}</b>
              <small>{c.nt1s}</small>
            </span>
          </div>

          <div className="ls-mk pick" style={{ left: "15%", top: "78.95%" }}>
            <svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
              <path d="M3 21V8l9-5 9 5v13" />
              <path d="M7 21v-8h10v8M7 17h10" />
            </svg>
          </div>
          <span className="ls-mlab" style={{ left: "15%", top: "84%" }}>
            <span className="chip chip-mor">{c.pickLbl}</span>
          </span>
          <div className="ls-mk drop" style={{ left: "85%", top: "19.74%" }}>
            <svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
              <path d="M4 10v10h16V10" />
              <path d="M3 10l2-6h14l2 6zM9 20v-5h6v5" />
            </svg>
          </div>
          <span className="ls-mlab" style={{ left: "85%", top: "22.5%" }}>
            <span className="chip glass">{c.dropLbl}</span>
          </span>
          <span className="ls-etab" style={{ left: "85%", top: "9%" }}>
            <b>
              <span className="ls-etac" /> min
            </b>
            {c.away}
          </span>
          <span className="ls-dchipx" style={{ left: "85%", top: "2%" }}>
            <span className="chip chip-mint">✓ {c.st5}</span>
          </span>
          <Confetti className="cf-drop" />

          <div className="ls-rider">
            <span className="halo" />
            <span className="arw">
              <svg viewBox="0 0 24 24" aria-hidden="true" fill="currentColor">
                <path d="M3 11l18-8-8 18-2-8z" />
              </svg>
            </span>
          </div>
        </div>

        <div className="ls-rphone">
          <div className="ls-rscr">
            <div className="ls-rmap">
              <svg viewBox="0 0 300 170" aria-hidden="true">
                <path className="rm-o" d="M0 140H300M0 100H300M0 50H300M30 0V170M140 0V170M270 0V170" />
                <path className="rm-f" d="M0 140H300M0 100H300M0 50H300M30 0V170M140 0V170M270 0V170" />
                <path className="rm-rem" d="M30 140V100H140V50H270" />
                <path className="rm-done" d="M30 140V100H140V50H270" />
              </svg>
              <span className="ls-rmk" style={{ left: "10%", top: "82.35%" }}>
                <svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                  <path d="M3 21V8l9-5 9 5v13" />
                </svg>
              </span>
              <span className="ls-rmk rdrop" style={{ left: "90%", top: "29.41%" }}>
                <svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                  <path d="M4 10v10h16V10" />
                  <path d="M3 10l2-6h14l2 6z" />
                </svg>
              </span>
              <span className="ls-rrider">
                <span className="arw">
                  <svg viewBox="0 0 24 24" aria-hidden="true" fill="currentColor">
                    <path d="M3 11l18-8-8 18-2-8z" />
                  </svg>
                </span>
              </span>
            </div>
            <div className="ls-sheet">
              <div className="ls-stbox">
                <div className="ls-stt k1">
                  <b>{c.st1}</b>
                  <small>{c.st1s}</small>
                </div>
                <div className="ls-stt k2">
                  <b>{c.st2}</b>
                  <small>{c.st2s}</small>
                </div>
                <div className="ls-stt k3">
                  <b>
                    {c.st3a} <span className="ls-etac" /> min
                  </b>
                  <small>{c.st3s}</small>
                </div>
                <div className="ls-stt k4">
                  <b>{c.st4}</b>
                  <small>{c.st4s}</small>
                </div>
                <div className="ls-stt k5">
                  <b>{c.st5}</b>
                  <small>{c.st5s}</small>
                </div>
              </div>
              <div className="ls-prog4">
                <span>
                  <i className="pf1" />
                </span>
                <span>
                  <i className="pf2" />
                </span>
                <span>
                  <i className="pf3" />
                </span>
                <span>
                  <i className="pf4" />
                </span>
              </div>
              <div className="ls-plabs">
                <span>{c.pl1}</span>
                <span>{c.pl2}</span>
                <span>{c.pl3}</span>
                <span>{c.pl4}</span>
              </div>
              <div className="ls-rcard">
                <span className="ls-rav">RK</span>
                <span style={{ minWidth: 0 }}>
                  <b>Ravi Kumar</b>
                  <small>{c.riderMeta}</small>
                </span>
                <span className="ls-rbtn">
                  <svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                    <path d="M5 4h4l2 5-2.5 1.5a11 11 0 0 0 5 5L15 13l5 2v4a2 2 0 0 1-2 2A16 16 0 0 1 3 6a2 2 0 0 1 2-2" />
                  </svg>
                </span>
              </div>
              <div className="ls-osum">
                <span>
                  SETU-1042 · 14 {c.itemsW}
                  <span style={{ display: "block", fontSize: 11, color: "var(--muted)" }}>{c.cod}</span>
                </span>
                <b>₹4,133</b>
              </div>
              <div className="ls-dov">
                <span className="okc">
                  <svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round">
                    <path d="M5 12.5l4.5 4.5L19 7" />
                  </svg>
                </span>
                <Confetti className="cf-ph" />
                <b>{c.dTitle}</b>
                <small>{c.dSub}</small>
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
