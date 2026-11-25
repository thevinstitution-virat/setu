"use client";

import Link from "next/link";
import { useLanguage } from "@/lib/i18n/LanguageProvider";
import { landingContent } from "@/lib/i18n/landing-content";
import { proContent } from "@/lib/i18n/landing-pro-content";
import LanguageToggle from "@/components/LanguageToggle";
import { Logo } from "@/components/BrandMark";
import { APP_NAME } from "@/lib/brand";

const WHATSAPP_NUMBER = process.env.NEXT_PUBLIC_WHATSAPP_NUMBER;
const CONTACT_EMAIL = process.env.NEXT_PUBLIC_CONTACT_EMAIL;
const INK = "#0F2A2A";
const SAFFRON = "#DB5C17";

/** The V mark as a large decorative watermark (decorative art, the logo files themselves are untouched). */
function Mark({ className, light }: { className?: string; light?: boolean }) {
  return (
    <svg className={className} viewBox="7 15 86 71" aria-hidden="true">
      <path
        d="M 8.49 19.04 Q 7.50 16.00 10.70 16.00 L 23.30 16.00 Q 26.50 16.00 27.55 19.02 L 37.75 48.48 Q 38.80 51.50 37.89 54.57 L 32.59 72.50 Q 32.00 74.50 29.91 74.50 L 28.59 74.50 Q 26.50 74.50 25.85 72.51 Z"
        fill={light ? "#FFFFFF" : INK}
      />
      <path
        d="M 36.71 81.93 Q 35.80 85.00 39.00 85.00 L 48.00 85.00 Q 51.20 85.00 52.24 81.97 L 73.76 19.03 Q 74.80 16.00 71.60 16.00 L 59.40 16.00 Q 56.20 16.00 55.29 19.07 Z"
        fill={SAFFRON}
      />
      <path
        d="M 69.50 51.97 Q 68.46 55.00 71.66 55.00 L 79.76 55.00 Q 82.96 55.00 84.00 51.97 L 91.50 30.03 Q 92.54 27.00 89.34 27.00 L 81.24 27.00 Q 78.04 27.00 77.00 30.03 Z"
        fill={SAFFRON}
      />
    </svg>
  );
}

const CONTACT_PHONE = process.env.NEXT_PUBLIC_CONTACT_PHONE || "+91 93109 59596";

function FootIcon({ d }: { d: string }) {
  return (
    <span className="vp-foot-ic" aria-hidden="true">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d={d} />
      </svg>
    </span>
  );
}

const ICON = {
  phone: "M22 16.9v3a2 2 0 0 1-2.2 2 19.8 19.8 0 0 1-8.6-3.1 19.5 19.5 0 0 1-6-6A19.8 19.8 0 0 1 2.1 4.2 2 2 0 0 1 4.1 2h3a2 2 0 0 1 2 1.7c.1 1 .4 1.9.7 2.8a2 2 0 0 1-.5 2.1L8 9.9a16 16 0 0 0 6 6l1.3-1.3a2 2 0 0 1 2.1-.4c.9.3 1.8.6 2.8.7a2 2 0 0 1 1.7 2z",
  chat: "M21 11.5a8.4 8.4 0 0 1-12.3 7.4L3 21l2.1-5.6A8.4 8.4 0 1 1 21 11.5z",
  mail: "M4 5h16a1 1 0 0 1 1 1v12a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1zM3 7l9 6 9-6",
  pin: "M12 21s-7-6.2-7-11.5a7 7 0 0 1 14 0C19 14.8 12 21 12 21zM12 12a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5z",
};

export function BtFooter() {
  const { lang } = useLanguage();
  const p = proContent[lang];
  const f = p.foot;
  const year = new Date().getFullYear();
  const product = [
    { href: "#product", label: p.nav.features },
    { href: "#solutions", label: p.nav.problems },
    { href: "#features", label: p.grid.kick },
    { href: "#devices", label: f.devices },
    { href: "#how", label: p.nav.how },
    { href: "#faq", label: p.nav.faq },
  ];
  return (
    <footer className="vp-foot" id="contact">
      <Mark className="vp-foot-wm" light />
      <div className="vp-wrap vp-foot-grid">
        <div className="vp-foot-brand">
          <a href="#top" className="vp-foot-logo" aria-label={APP_NAME}>
            <Logo kind="onDark" height={38} />
          </a>
          <p>{f.about}</p>
          <ul className="vp-foot-chips">
            {f.chips.map((c) => (
              <li key={c}>{c}</li>
            ))}
          </ul>
          <span className="vp-foot-badge">
            <i aria-hidden="true" />
            {f.badge}
          </span>
          <div className="vp-foot-lang">
            <LanguageToggle />
          </div>
        </div>
        <nav aria-label={f.product}>
          <h3>{f.product}</h3>
          {product.map((l) => (
            <a key={l.href} href={l.href}>
              {l.label}
            </a>
          ))}
        </nav>
        <div>
          <h3>{f.builtFor}</h3>
          <ul className="vp-foot-list">
            {p.trust.items.map((t) => (
              <li key={t}>{t}</li>
            ))}
          </ul>
        </div>
        <nav aria-label={f.start}>
          <h3>{f.start}</h3>
          <Link href="/start">{p.hero.cta1}</Link>
          <Link href="/login">{landingContent[lang].signIn}</Link>
          <Link href="/legal/terms">{f.terms}</Link>
          <Link href="/legal/privacy">{f.privacy}</Link>
        </nav>
        <div className="vp-foot-contact">
          <h3>{f.contact}</h3>
          <a href={`tel:${CONTACT_PHONE.replace(/\s/g, "")}`}>
            <FootIcon d={ICON.phone} />
            <span>
              <small>{f.call}</small>
              {CONTACT_PHONE}
            </span>
          </a>
          {WHATSAPP_NUMBER && (
            <a href={`https://wa.me/${WHATSAPP_NUMBER}`} target="_blank" rel="noopener noreferrer">
              <FootIcon d={ICON.chat} />
              <span>
                <small>{f.whatsapp}</small>+{WHATSAPP_NUMBER}
              </span>
            </a>
          )}
          {CONTACT_EMAIL && (
            <a href={`mailto:${CONTACT_EMAIL}`}>
              <FootIcon d={ICON.mail} />
              <span>
                <small>{f.email}</small>
                {CONTACT_EMAIL}
              </span>
            </a>
          )}
          <p>
            <FootIcon d={ICON.pin} />
            <span>{f.address}</span>
          </p>
        </div>
      </div>
      <div className="vp-wrap vp-foot-bar">
        <span>{f.brandLine}</span>
        <span className="vp-foot-links">
          <Link href="/legal/terms">{f.terms}</Link>
          <Link href="/legal/privacy">{f.privacy}</Link>
          <Link href="/login">{landingContent[lang].signIn}</Link>
        </span>
      </div>
      <div className="vp-wrap vp-foot-legal">
        <p>PAN: AAMCV2938B · GSTIN: 07AAMCV2938B1ZA · ISO 9001:2015 Certified</p>
        <p>
          © {year} VPD Vastus Ventures Pvt. Ltd. {f.rights} · {f.designedBy}{" "}
          <a href="https://vgraphics.in" target="_blank" rel="noopener noreferrer">
            VGraphics.in
          </a>
        </p>
      </div>
    </footer>
  );
}
