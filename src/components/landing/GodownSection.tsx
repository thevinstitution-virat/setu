"use client";

import { useLanguage } from "@/lib/i18n/LanguageProvider";
import { landingContent } from "@/lib/i18n/landing-content";
import { ROADMAP } from "@/lib/brand";

export default function GodownSection() {
  const { lang } = useLanguage();
  const c = landingContent[lang];

  return (
    <section className="ls-sec" id="godown" style={{ paddingTop: 0 }}>
      <div className="ls-gdn ls-rv">
        <div className="ls-split">
          <div>
            <div className="ls-kick">
              {c.gKick}
              {!ROADMAP.inventory && <span className="chip chip-genda" style={{ marginLeft: 10 }}>{c.soon}</span>}
            </div>
            <h2 className="ls-h2">{c.gTitle}</h2>
            <p className="ls-sub">{c.gSub}</p>
            <div className="ls-flow">
              <span>
                <b className="out">−14</b>
                {c.flow1}
              </span>
              <span>
                <b className="in">+120</b>
                {c.flow2}
              </span>
              <span>
                <b className="in">+2</b>
                {c.flow3}
              </span>
            </div>
            <ul className="ls-points">
              <li>
                <span className="ls-tile" style={{ background: "rgba(242,179,61,.16)", color: "var(--genda)" }}>
                  <svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                    <path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9M10 21h4" />
                  </svg>
                </span>
                <span>
                  <b>{c.gp1}</b>
                  <span>{c.gp1d}</span>
                </span>
              </li>
              <li>
                <span className="ls-tile" style={{ background: "rgba(111,224,189,.14)", color: "var(--mint)" }}>
                  <svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                    <path d="M4 20V10M10 20V4M16 20v-7M22 20H2" />
                  </svg>
                </span>
                <span>
                  <b>{c.gp2}</b>
                  <span>{c.gp2d}</span>
                </span>
              </li>
            </ul>
          </div>

          <div className="ls-inv" role="img" aria-label={c.invAria}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
              <b style={{ fontSize: 15 }}>{c.godown} · Aminabad</b>
              <span className="ls-live">
                <span className="ls-ldot" />
                LIVE
              </span>
            </div>
            <div className="ls-kpis">
              <div className="ls-kpi">
                <small>{c.kSku}</small>
                <b>248</b>
              </div>
              <div className="ls-kpi">
                <small>{c.kPacked}</small>
                <b>128</b>
              </div>
              <div className="ls-kpi">
                <small>{c.kLow}</small>
                <b style={{ color: "#db7a54" }}>3</b>
              </div>
            </div>
            <div style={{ marginTop: 8 }}>
              <div className="ls-sku">
                <span>
                  <b>{c.p1}</b>
                  <small>RICE-BAS-5</small>
                </span>
                <span className="bar">
                  <i className="b1" style={{ width: "78%" }} />
                </span>
                <span className="n">186</span>
              </div>
              <div className="ls-sku">
                <span>
                  <b>{c.p2}</b>
                  <small>OIL-MUS-1L</small>
                </span>
                <span className="bar">
                  <i className="b2" style={{ width: "58%" }} />
                </span>
                <span className="n">118</span>
              </div>
              <div className="ls-sku">
                <span>
                  <b>{c.p3}</b>
                  <small>ATTA-10</small>
                </span>
                <span className="bar">
                  <i className="b3" style={{ width: "8%", background: "#f08a4b" }} />
                </span>
                <span className="n" style={{ color: "#db7a54" }}>14</span>
              </div>
              <div className="ls-sku">
                <span>
                  <b>{c.p4}</b>
                  <small>DAL-TOOR-1</small>
                </span>
                <span className="bar">
                  <i className="b4" style={{ width: "88%" }} />
                </span>
                <span className="n">204</span>
              </div>
            </div>
            <div className="ls-alert">
              <svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                <path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9M10 21h4" />
              </svg>
              <span>
                <b>{c.reTitle}</b>
                {c.reBody}
              </span>
            </div>
            <div className="ls-ticker">
              <div className="ls-tk">
                {[...c.register, ...c.register].map((r, i) => (
                  <div className="ls-tick-row" key={i}>
                    <b className={r.dir}>{r.qty}</b>
                    <span>{r.label}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
