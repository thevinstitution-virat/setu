"use client";

import { useLanguage } from "@/lib/i18n/LanguageProvider";
import { landingContent } from "@/lib/i18n/landing-content";
import { CountUp } from "./use-landing";

export default function BillingSection() {
  const { lang } = useLanguage();
  const c = landingContent[lang];

  return (
    <section className="ls-sec" id="billing" style={{ paddingTop: 0 }}>
      <div className="ls-split">
        <div className="ls-bill ls-float ls-media-first ls-rv" role="img" aria-label={c.billAria}>
          <div className="ls-bill-h">
            <span>
              <span style={{ fontSize: 12.5, fontWeight: 700, color: "var(--kesar-text)" }}>{c.taxInvoice}</span>
              <b>{c.shop}</b>
            </span>
            <span style={{ textAlign: "right" }}>
              <span style={{ fontSize: 12.5, fontWeight: 700, color: "var(--kesar-text)" }}>SETU-1042</span>
              <span style={{ display: "block", fontSize: 12.5, color: "var(--muted)" }}>18 Nov 2026</span>
            </span>
          </div>
          <div className="ls-bl" style={{ "--i": 1 } as React.CSSProperties}>
            <span>{c.p1} × 4</span>
            <span>5%</span>
            <span className="tnum">₹2,340</span>
          </div>
          <div className="ls-bl" style={{ "--i": 2 } as React.CSSProperties}>
            <span>{c.p2} × 6</span>
            <span>5%</span>
            <span className="tnum">₹1,032</span>
          </div>
          <div className="ls-bl" style={{ "--i": 3 } as React.CSSProperties}>
            <span>{c.p4} × 4</span>
            <span>0%</span>
            <span className="tnum">₹592</span>
          </div>
          <div className="ls-bl offer" style={{ "--i": 4 } as React.CSSProperties}>
            <span>{c.offerLine}</span>
            <span />
            <span className="tnum">₹396</span>
          </div>
          <div className="ls-bl" style={{ "--i": 5 } as React.CSSProperties}>
            <span>GST 5%</span>
            <span />
            <span className="tnum">₹169</span>
          </div>
          <div className="ls-bl" style={{ "--i": 6 } as React.CSSProperties}>
            <span>GST 0%</span>
            <span />
            <span className="tnum">₹0</span>
          </div>
          <div className="ls-btot">
            <span>{c.total}</span>
            <CountUp to={4133} prefix="₹" className="big tnum" />
          </div>
          <div className="ls-pays">
            <div className="ls-pay">
              <small>{c.cash}</small>
              <b><CountUp to={38420} prefix="₹" /></b>
            </div>
            <div className="ls-pay">
              <small>{c.online}</small>
              <b><CountUp to={21760} prefix="₹" /></b>
            </div>
            <div className="ls-pay">
              <small>{c.credit}</small>
              <b><CountUp to={12300} prefix="₹" /></b>
            </div>
          </div>
        </div>
        <div className="ls-rv">
          <div className="ls-kick">{c.biKick}</div>
          <h2 className="ls-h2">{c.biTitle}</h2>
          <p className="ls-sub">{c.biSub}</p>
          <ul className="ls-points">
            <li>
              <span className="ls-tile chip-kesar">
                <svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                  <path d="M6 4h12M6 9h12M14 20L7 13h3a4 4 0 0 0 0-9" />
                </svg>
              </span>
              <span>
                <b>{c.bi1}</b>
                <span>{c.bi1d}</span>
              </span>
            </li>
            <li>
              <span className="ls-tile chip-mint">
                <svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                  <path d="M20 12l-8 8-9-9V3h8z" />
                  <circle cx="7.5" cy="7.5" r="1.5" />
                </svg>
              </span>
              <span>
                <b>{c.bi2}</b>
                <span>{c.bi2d}</span>
              </span>
            </li>
            <li>
              <span className="ls-tile chip-genda">
                <svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                  <rect x="2" y="6" width="20" height="13" rx="2" />
                  <circle cx="12" cy="12.5" r="2.5" />
                  <path d="M6 10v5M18 10v5" />
                </svg>
              </span>
              <span>
                <b>{c.bi3}</b>
                <span>{c.bi3d}</span>
              </span>
            </li>
          </ul>
        </div>
      </div>
    </section>
  );
}
