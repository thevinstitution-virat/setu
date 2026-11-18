"use client";

import { useLanguage } from "@/lib/i18n/LanguageProvider";
import { landingContent } from "@/lib/i18n/landing-content";

export default function BeatSection() {
  const { lang } = useLanguage();
  const c = landingContent[lang];

  return (
    <section className="ls-sec" id="beat" style={{ paddingTop: 0 }}>
      <div className="ls-split">
        <div className="ls-rv">
          <div className="ls-kick">{c.bKick}</div>
          <h2 className="ls-h2">{c.bTitle}</h2>
          <p className="ls-sub">{c.bSub}</p>
          <ul className="ls-points">
            <li>
              <span className="ls-tile chip-mor">
                <svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                  <circle cx="6" cy="19" r="2" />
                  <circle cx="18" cy="5" r="2" />
                  <path d="M8 19h8a3 3 0 0 0 0-6H8a3 3 0 0 1 0-6h8" />
                </svg>
              </span>
              <span>
                <b>{c.bp1}</b>
                <span>{c.bp1d}</span>
              </span>
            </li>
            <li>
              <span className="ls-tile chip-kesar">
                <svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                  <path d="M12 21s-7-6.2-7-11.5A7 7 0 0 1 19 9.5C19 14.8 12 21 12 21z" />
                  <circle cx="12" cy="9.5" r="2.5" />
                </svg>
              </span>
              <span>
                <b>{c.bp2}</b>
                <span>{c.bp2d}</span>
              </span>
            </li>
            <li>
              <span className="ls-tile chip-genda">
                <svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                  <circle cx="12" cy="12" r="9" />
                  <path d="M12 7v5l3 2" />
                </svg>
              </span>
              <span>
                <b>{c.bp3}</b>
                <span>{c.bp3d}</span>
              </span>
            </li>
          </ul>
        </div>
        <div className="ls-beat glass ls-rv">
          <div className="ls-ringw">
            <span className="ls-ring">
              <span>9/14</span>
            </span>
            <span>
              <span style={{ fontSize: 13, fontWeight: 700 }}>{c.beat} · Aminabad · Amit</span>
              <b style={{ display: "block", marginTop: 4, fontSize: 18 }}>{c.todayBeat}</b>
              <span style={{ fontSize: 13, color: "var(--muted)" }}>{c.beatMeta}</span>
            </span>
          </div>
          <div className="ls-visit">
            <span className="ls-visit-n">7</span>
            <span>
              <b>Gupta General Store</b>
              <small>{c.v1}</small>
            </span>
            <span className="chip chip-mint">₹3,120</span>
          </div>
          <div className="ls-visit">
            <span className="ls-visit-n">8</span>
            <span>
              <b>{c.shop}</b>
              <small>{c.v2}</small>
            </span>
            <span className="chip chip-mint">₹4,133</span>
          </div>
          <div className="ls-visit">
            <span className="ls-visit-n">9</span>
            <span>
              <b>Verma Traders</b>
              <small>{c.v3}</small>
            </span>
            <span className="chip chip-genda">{c.noOrder}</span>
          </div>
          <div className="ls-visit">
            <span className="ls-visit-n">10</span>
            <span>
              <b>Ansari Store</b>
              <small>{c.next}</small>
            </span>
            <span className="chip">0.6 km</span>
          </div>
          <div className="ls-clockin">
            <span className="tile">
              <svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                <circle cx="12" cy="12" r="9" />
                <path d="M12 7v5l3 2" />
              </svg>
            </span>
            <span>
              <b>{c.attendance}</b>
              <small>{c.attendanceS}</small>
            </span>
            <span className="time">09:02</span>
          </div>
        </div>
      </div>
    </section>
  );
}
