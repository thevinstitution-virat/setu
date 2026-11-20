"use client";

import { useEffect, useState } from "react";
import { useLanguage } from "@/lib/i18n/LanguageProvider";
import { landingContent } from "@/lib/i18n/landing-content";
import { useReducedMotion } from "./use-landing";

const WHO_CLASS: Record<string, string> = {
  kesar: "chip-kesar",
  mor: "chip-mor",
  genda: "chip-genda",
  mint: "chip-mint",
};

export default function JourneySection() {
  const { lang } = useLanguage();
  const c = landingContent[lang];
  const reduced = useReducedMotion();
  const [stage, setStage] = useState(0);
  const [held, setHeld] = useState(false);
  const count = c.stages.length;

  useEffect(() => {
    if (reduced || held) return;
    const id = setInterval(() => {
      if (document.hidden) return;
      setStage((s) => (s + 1) % count);
    }, 5000);
    const onVisibility = () => {
      /* interval already skips ticks while hidden */
    };
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      clearInterval(id);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [reduced, held, count]);

  return (
    <section className="ls-sec" id="journey">
      <div className="ls-rv" style={{ maxWidth: 780 }}>
        <div className="ls-kick">{c.jKick}</div>
        <h2 className="ls-h2">{c.jTitle}</h2>
        <p className="ls-sub">{c.jSub}</p>
      </div>

      <div className="ls-jr glass ls-glow ls-rv">
        <div className="ls-jrail">
          <span className="ls-jfill" style={{ width: `${(stage / (count - 1)) * 100}%` }} />
          <span className="ls-jpkg" style={{ left: `${(stage / (count - 1)) * 100}%` }}>
            <svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M21 8l-9-5-9 5v8l9 5 9-5zM3 8l9 5 9-5M12 13v8" />
            </svg>
          </span>
        </div>
        <div className="ls-jgrid">
          <div className="ls-stgs">
            {c.stages.map((st, i) => (
              <div key={st.title}>
                <button
                  type="button"
                  className={`ls-stg ${i === stage ? "on" : i < stage ? "done" : ""}`}
                  aria-expanded={i === stage}
                  onClick={() => {
                    setStage(i);
                    setHeld(true);
                  }}
                >
                  <span className="ls-stg-n">{String(i + 1).padStart(2, "0")}</span>
                  <span style={{ minWidth: 0 }}>
                    <b>{st.title}</b>
                    <small style={{ display: "block", color: "var(--muted)", fontSize: 12 }}>{st.time}</small>
                  </span>
                  <span className={`chip ls-stg-who ${WHO_CLASS[st.whoClass]}`}>{st.who}</span>
                </button>
                {i === stage && <div className="ls-stg-body">{st.body}</div>}
              </div>
            ))}
            {!reduced && (
              <div className="ls-autoplay">
                <span className="ls-ldot" />
                {c.autoplay}
              </div>
            )}
          </div>
          <StagePhone stage={stage} />
        </div>
      </div>
    </section>
  );
}

function StagePhone({ stage }: { stage: number }) {
  const { lang } = useLanguage();
  const c = landingContent[lang];

  return (
    <div className="ls-phone">
      <div className="ls-pscr" key={stage}>
        {stage === 0 && (
          <>
            <b style={{ fontSize: 13 }}>{c.shop}</b>
            <small style={{ color: "rgba(255,255,255,.6)" }}>{c.catalogue}</small>
            <div className="item">
              <span className="thumb chip-kesar">🧺</span>
              <span>
                <b>{c.p1}</b>
                <small>× 4</small>
              </span>
            </div>
            <div className="item">
              <span className="thumb chip-kesar">🛢️</span>
              <span>
                <b>{c.p2}</b>
                <small>× 6</small>
              </span>
            </div>
            <small style={{ color: "var(--mint)" }}>{c.offerApplied}</small>
            <div className="bigbtn">
              {c.placeOrder}
              <svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                <path d="M5 12h14M13 6l6 6-6 6" />
              </svg>
            </div>
          </>
        )}
        {stage === 1 && (
          <>
            <b style={{ fontSize: 13 }}>
              {c.beat} · Aminabad
            </b>
            <small style={{ color: "rgba(255,255,255,.6)" }}>{c.checkedIn}</small>
            <div className="item">
              <span className="thumb chip-mint">✓</span>
              <span>
                <b>SETU-1042</b>
                <small>{c.linkedVisit}</small>
              </span>
            </div>
            <div className="item">
              <span className="thumb chip-kesar">📝</span>
              <span>
                <b>{c.visitNote}</b>
                <small>{c.visitNoteS}</small>
              </span>
            </div>
            <div style={{ marginTop: 4 }}>
              <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12, fontWeight: 700, marginBottom: 6 }}>
                <span>{c.beatProgress}</span>
                <span>9 / 14</span>
              </div>
              <div className="bar">
                <i style={{ width: "64%" }} />
              </div>
            </div>
            <div className="bigbtn">
              {c.checkOut}
              <svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                <path d="M5 12h14M13 6l6 6-6 6" />
              </svg>
            </div>
          </>
        )}
        {stage === 2 && (
          <>
            <b style={{ fontSize: 13 }}>{c.office}</b>
            <small style={{ color: "rgba(255,255,255,.6)" }}>{c.packAssign}</small>
            <div className="item">
              <span className="thumb chip-genda">📦</span>
              <span>
                <b>SETU-1042</b>
                <small>{c.stockWord} −14</small>
              </span>
            </div>
            <div className="item">
              <span className="thumb chip-mor">🛵</span>
              <span>
                <b>{c.assignedTo} Ravi</b>
                <small>{c.lgDel} · 5 {c.drops}</small>
              </span>
            </div>
            <div className="bigbtn">
              {c.markPacked}
              <svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                <path d="M5 12h14M13 6l6 6-6 6" />
              </svg>
            </div>
          </>
        )}
        {stage === 3 && (
          <>
            <b style={{ fontSize: 13 }}>{c.onWay}</b>
            <small style={{ color: "rgba(255,255,255,.6)" }}>{c.toShop}</small>
            <div className="item">
              <span className="thumb chip-kesar">🛵</span>
              <span>
                <b>Ravi Kumar</b>
                <small>12 min</small>
              </span>
            </div>
            <div className="bar">
              <i style={{ width: "70%", background: "var(--kesar)" }} />
            </div>
          </>
        )}
        {stage === 4 && (
          <div style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", flex: 1, gap: 8, textAlign: "center" }}>
            <span className="okc" style={{ width: 52, height: 52, borderRadius: "50%", background: "linear-gradient(var(--mint), #3cc9a0)", display: "grid", placeItems: "center", color: "#08302a" }}>
              <svg viewBox="0 0 24 24" className="h-6 w-6" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round">
                <path d="M5 12.5l4.5 4.5L19 7" />
              </svg>
            </span>
            <b>{c.deliveredBang}</b>
            <small style={{ color: "rgba(255,255,255,.7)" }}>
              {c.cashCollected} · {c.signed}
            </small>
            <small style={{ color: "rgba(255,255,255,.5)" }}>{c.retailerNotified}</small>
          </div>
        )}
      </div>
    </div>
  );
}
