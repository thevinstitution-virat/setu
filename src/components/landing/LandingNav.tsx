"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useLanguage } from "@/lib/i18n/LanguageProvider";
import { landingContent } from "@/lib/i18n/landing-content";
import LanguageToggle from "@/components/LanguageToggle";

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

export default function LandingNav() {
  const { lang } = useLanguage();
  const c = landingContent[lang];
  const [open, setOpen] = useState(false);

  const links = [
    { href: "#journey", label: c.navJourney },
    { href: "#godown", label: c.navGodown },
    { href: "#map", label: c.navMap },
    { href: "#beat", label: c.navBeat },
    { href: "#billing", label: c.navBill },
    { href: "#owner", label: c.navOwner },
    { href: "#faq", label: c.navFaq },
  ];

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("keydown", onKey);
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = "";
    };
  }, [open]);

  return (
    <nav className={`ls-nav ${open ? "menu-open" : ""}`} aria-label="Primary">
      <div className="ls-nav-row">
        <a className="ls-brand" href="#top" onClick={() => setOpen(false)}>
          <BrandMark />
          <span>
            <span className="ls-brand-name">Seller&apos;s Setu</span>
            <span className="ls-brand-hi">सेलर्स सेतु</span>
          </span>
        </a>
        <div className="ls-links">
          {links.map((l) => (
            <a key={l.href} href={l.href}>
              {l.label}
            </a>
          ))}
        </div>
        <span style={{ flex: 1 }} />
        <span className="ls-nav-lang">
          <LanguageToggle />
        </span>
        <Link href="/login" className="ls-signin">
          {c.signIn}
        </Link>
        <Link href="/start" className="btn btn-kesar ls-nav-cta">
          {c.demo}
        </Link>
        <button
          type="button"
          className="ls-burger"
          aria-expanded={open}
          aria-controls="ls-menu"
          aria-label={open ? c.menuClose : c.menuOpen}
          onClick={() => setOpen((o) => !o)}
        >
          <span />
          <span />
          <span />
        </button>
      </div>
      <span className="ls-prog" aria-hidden="true" />

      <div id="ls-menu" className="ls-menu" hidden={!open}>
        <div className="ls-menu-links">
          {links.map((l, i) => (
            <a key={l.href} href={l.href} onClick={() => setOpen(false)} style={{ "--i": i } as React.CSSProperties}>
              {l.label}
              <svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                <path d="M5 12h14M13 6l6 6-6 6" />
              </svg>
            </a>
          ))}
        </div>
        <div className="ls-menu-foot">
          <LanguageToggle />
          <Link href="/login" className="btn btn-glass" onClick={() => setOpen(false)}>
            {c.signIn}
          </Link>
          <Link href="/start" className="btn btn-kesar" onClick={() => setOpen(false)}>
            {c.demo}
          </Link>
        </div>
      </div>
    </nav>
  );
}
