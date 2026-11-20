"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useLanguage } from "@/lib/i18n/LanguageProvider";
import { landingContent } from "@/lib/i18n/landing-content";
import { proContent } from "@/lib/i18n/landing-pro-content";
import LanguageToggle from "@/components/LanguageToggle";
import { Logo } from "@/components/BrandMark";
import { APP_NAME } from "@/lib/brand";
import { Arrow } from "./Icon";

export function ProLogo({ stacked }: { stacked?: boolean }) {
  return (
    <a className={`vp-logo ${stacked ? "stacked" : ""}`} href="#top" aria-label={APP_NAME}>
      {stacked ? <Logo kind="stacked" height={112} /> : <Logo kind="wide" height={56} priority />}
    </a>
  );
}

export default function ProNav() {
  const { lang } = useLanguage();
  const c = landingContent[lang];
  const p = proContent[lang];
  const [open, setOpen] = useState(false);

  const links = [
    { href: "#product", label: p.nav.features },
    { href: "#solutions", label: p.nav.problems },
    { href: "#how", label: p.nav.how },
    { href: "#faq", label: p.nav.faq },
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
    <nav className={`vp-nav ${open ? "open" : ""}`} aria-label="Primary">
      <div className="vp-nav-row">
        <ProLogo />
        <div className="vp-links">
          {links.map((l) => (
            <a key={l.href} href={l.href}>
              {l.label}
            </a>
          ))}
        </div>
        <span style={{ flex: 1 }} />
        <span className="vp-nav-lang">
          <LanguageToggle />
        </span>
        <Link href="/login" className="vp-signin">
          {c.signIn}
        </Link>
        <Link href="/start" className="vp-btn vp-btn-line vp-nav-cta">
          {p.hero.cta1}
        </Link>
        <button
          type="button"
          className="vp-burger"
          aria-expanded={open}
          aria-controls="vp-menu"
          aria-label={open ? c.menuClose : c.menuOpen}
          onClick={() => setOpen((o) => !o)}
        >
          <span />
          <span />
          <span />
        </button>
      </div>
      <span className="ls-prog" aria-hidden="true" />

      <div id="vp-menu" className="vp-menu" hidden={!open}>
        {links.map((l) => (
          <a key={l.href} href={l.href} onClick={() => setOpen(false)}>
            {l.label}
            <Arrow />
          </a>
        ))}
        <div className="vp-menu-foot">
          <LanguageToggle />
          <Link href="/login" className="vp-btn vp-btn-line" onClick={() => setOpen(false)}>
            {c.signIn}
          </Link>
          <Link href="/start" className="vp-btn vp-btn-solid" onClick={() => setOpen(false)}>
            {p.hero.cta1}
          </Link>
        </div>
      </div>
    </nav>
  );
}
