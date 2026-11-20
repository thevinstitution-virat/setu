"use client";

import Link from "next/link";
import { useLanguage } from "@/lib/i18n/LanguageProvider";
import { landingContent } from "@/lib/i18n/landing-content";
import { CountUp } from "./use-landing";

export default function OwnerDashboardSection() {
  const { lang } = useLanguage();
  const c = landingContent[lang];

  const stages = [
    { label: c.s1, value: 14, cls: "" },
    { label: c.s2, value: 11, cls: "" },
    { label: c.s3, value: 9, cls: "" },
    { label: c.s4, value: 6, cls: "hl" },
    { label: c.s5, value: 41, cls: "ok" },
  ];
  const regions = [
    { name: "Aminabad", pct: 86, value: 32 },
    { name: "Hazratganj", pct: 64, value: 24 },
    { name: "Alambagh", pct: 48, value: 18 },
    { name: "Chowk", pct: 30, value: 11 },
  ];

  return (
    <section className="ls-sec" id="owner" style={{ paddingTop: 0 }}>
      <div className="ls-rv" style={{ maxWidth: 780 }}>
        <div className="ls-kick">{c.oKick}</div>
        <h2 className="ls-h2">{c.oTitle}</h2>
        <p className="ls-sub">{c.oSub}</p>
      </div>
      <div className="ls-own glass ls-glow ls-rv">
        <div className="ls-own-grid">
          <div style={{ minWidth: 0 }}>
            <div className="ls-stages">
              {stages.map((s) => (
                <div className={`ls-sbox ${s.cls}`} key={s.label}>
                  <small>{s.label}</small>
                  <b><CountUp to={s.value} /></b>
                </div>
              ))}
            </div>
            <div className="ls-regions">
              <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 6 }}>
                <b style={{ fontSize: 14 }}>{c.byRegion}</b>
                <span style={{ color: "var(--muted)", fontSize: 12, fontWeight: 700 }}>{c.today}</span>
              </div>
              {regions.map((r) => (
                <div className="ls-rg" key={r.name}>
                  <span>{r.name}</span>
                  <span className="bar">
                    <i style={{ width: `${r.pct}%` }} />
                  </span>
                  <span className="tnum">{r.value}</span>
                </div>
              ))}
            </div>
          </div>
          <div className="ls-team">
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <b style={{ fontSize: 15 }}>{c.teamToday}</b>
              <span className="ls-live">
                <span className="ls-ldot" />
                LIVE
              </span>
            </div>
            <div className="ls-trow">
              <span>{c.salesAgents}</span>
              <b><CountUp to={8} /> / 9</b>
            </div>
            <div className="ls-trow">
              <span>{c.delAgents}</span>
              <b>5 / 5</b>
            </div>
            <div className="ls-trow">
              <span>{c.retailersOrdering}</span>
              <b><CountUp to={86} /></b>
            </div>
            <div className="ls-trow">
              <span>{c.cashToday}</span>
              <b style={{ color: "var(--genda)" }}><CountUp to={72480} prefix="₹" duration={1800} /></b>
            </div>
            <Link href="/start" className="btn btn-kesar ls-shine" style={{ marginTop: 6, width: "100%" }}>
              {c.seeDash}
            </Link>
          </div>
        </div>
      </div>
    </section>
  );
}
