"use client";

import { useLanguage } from "@/lib/i18n/LanguageProvider";
import { landingContent } from "@/lib/i18n/landing-content";
import { ROADMAP } from "@/lib/brand";
import { Confetti } from "./use-landing";

export default function LiveMapSection() {
  const { lang } = useLanguage();
  const c = landingContent[lang];

  return (
    <section className="ls-sec" id="map" style={{ paddingTop: 0 }}>
      <div className="ls-rv" style={{ maxWidth: 780 }}>
        <div className="ls-kick">
          {c.mKick}
          {!ROADMAP.liveTracking && <span className="chip chip-genda" style={{ marginLeft: 10 }}>{c.soon}</span>}
        </div>
        <h2 className="ls-h2">{c.mTitle}</h2>
        <p className="ls-sub">{c.mSub}</p>
      </div>

      <div className="ls-mapwrap glass ls-rv ls" role="img" aria-label={c.mapAria}>
        <div className="ls-mapgrid">
          <div className="ls-map">
            <svg viewBox="0 0 1000 620" preserveAspectRatio="none" aria-hidden="true">
              <rect className="m-blk" x="12" y="12" width="86" height="106" rx="10" />
              <rect className="m-blk" x="124" y="12" width="182" height="106" rx="10" />
              <rect className="m-park" x="334" y="12" width="352" height="106" rx="10" />
              <rect className="m-blk" x="714" y="12" width="162" height="106" rx="10" />
              <rect className="m-blk" x="904" y="12" width="84" height="106" rx="10" />
              <rect className="m-blk" x="12" y="144" width="86" height="152" rx="10" />
              <rect className="m-park" x="124" y="144" width="182" height="152" rx="10" />
              <rect className="m-blk" x="334" y="144" width="352" height="152" rx="10" />
              <rect className="m-blk" x="714" y="144" width="162" height="152" rx="10" />
              <rect className="m-blk" x="904" y="144" width="84" height="152" rx="10" />
              <rect className="m-blk" x="12" y="324" width="86" height="152" rx="10" />
              <rect className="m-blk" x="124" y="324" width="182" height="152" rx="10" />
              <rect className="m-blk" x="334" y="324" width="352" height="152" rx="10" />
              <rect className="m-park" x="714" y="324" width="162" height="152" rx="10" />
              <rect className="m-blk" x="904" y="324" width="84" height="152" rx="10" />
              <rect className="m-blk" x="12" y="504" width="86" height="104" rx="10" />
              <rect className="m-blk" x="124" y="504" width="182" height="104" rx="10" />
              <rect className="m-blk" x="334" y="504" width="352" height="104" rx="10" />
              <rect className="m-blk" x="714" y="504" width="162" height="104" rx="10" />
              <rect className="m-blk" x="904" y="504" width="84" height="104" rx="10" />
              <path className="m-river" d="M470 0 C 440 130, 525 220, 492 310 S 455 490, 505 620 L 562 620 C 515 490, 556 400, 548 310 S 520 130, 530 0 Z" />
              <path className="m-road-o" d="M0 130H1000M0 310H1000M0 490H1000M110 0V620M320 0V620M700 0V620M890 0V620" />
              <path className="m-road" d="M0 130H1000M0 310H1000M0 490H1000M110 0V620M320 0V620M700 0V620M890 0V620" />
              <path className="m-brg" d="M466 310H568" />
              <path className="m-route" d="M110 490V310H890V130" />
            </svg>
            <div className="ls-pin hub" style={{ left: "11%", top: "79.03%" }}>
              <svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                <path d="M3 21V8l9-5 9 5v13M7 21v-8h10v8M7 17h10" />
              </svg>
            </div>
            <div className="ls-pin" style={{ left: "89%", top: "20.97%" }}>
              <svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                <path d="M4 10v10h16V10M3 10l2-6h14l2 6zM9 20v-5h6v5" />
              </svg>
            </div>
            <div className="ls-pin" style={{ left: "70%", top: "79.03%" }}>
              <svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                <path d="M4 10v10h16V10M3 10l2-6h14l2 6zM9 20v-5h6v5" />
              </svg>
            </div>
            <div className="ls-pin" style={{ left: "32%", top: "20.97%" }}>
              <svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                <path d="M4 10v10h16V10M3 10l2-6h14l2 6zM9 20v-5h6v5" />
              </svg>
            </div>
            <span className="ls-mchip" style={{ left: "89%", top: "28%" }}>
              <span className="chip chip-mint">✓ {c.st5}</span>
            </span>
            <span className="ls-mchip" style={{ left: "70%", top: "86%" }}>
              <span className="chip chip-mint">✓ {c.st5}</span>
            </span>
            <Confetti className="cf-a" />
            <div className="ls-agent" style={{ left: "50%", top: "50%" }}>
              <svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                <circle cx="6" cy="17" r="2.5" />
                <circle cx="18" cy="17" r="2.5" />
                <path d="M8.5 17h7M15 6h3l2.5 8.5M12 17l-2-7h5" />
              </svg>
              <span className="ls-atag">
                Ravi<em>12 min</em>
              </span>
            </div>
            <div className="ls-agent" style={{ left: "40%", top: "79.03%" }}>
              <svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                <circle cx="6" cy="17" r="2.5" />
                <circle cx="18" cy="17" r="2.5" />
                <path d="M8.5 17h7M15 6h3l2.5 8.5M12 17l-2-7h5" />
              </svg>
              <span className="ls-atag">
                Imran<em>6 min</em>
              </span>
            </div>
            <div className="ls-agent" style={{ left: "76%", top: "20.97%" }}>
              <svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                <circle cx="12" cy="7" r="3.5" />
                <path d="M5 21a7 7 0 0 1 14 0" />
              </svg>
              <span className="ls-atag">
                Amit<em>{c.visit}</em>
              </span>
            </div>
          </div>
          <div className="ls-agents">
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 4 }}>
              <b style={{ fontSize: 15 }}>{c.agentsLive}</b>
              <span className="ls-live">
                <span className="ls-ldot" />
                LIVE
              </span>
            </div>
            <div className="ls-ag">
              <span className="ls-av chip-kesar">RK</span>
              <span>
                <b>Ravi Kumar</b>
                <small>{c.ag1}</small>
              </span>
              <span className="e">12m</span>
            </div>
            <div className="ls-ag">
              <span className="ls-av chip-genda">IM</span>
              <span>
                <b>Imran</b>
                <small>{c.ag2}</small>
              </span>
              <span className="e">6m</span>
            </div>
            <div className="ls-ag">
              <span className="ls-av chip-mint">SU</span>
              <span>
                <b>Sunita</b>
                <small>{c.ag3}</small>
              </span>
              <span className="e" style={{ color: "var(--mint-text)" }}>4/4</span>
            </div>
            <div className="ls-ag">
              <span className="ls-av chip-mor">AM</span>
              <span>
                <b>Amit</b>
                <small>{c.ag4}</small>
              </span>
              <span className="e" style={{ color: "var(--mor)" }}>11:40</span>
            </div>
            <div className="ls-fence">
              <svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M12 3l8 3v6c0 4.5-3.4 8.3-8 9-4.6-.7-8-4.5-8-9V6z" />
                <path d="M9 12l2 2 4-4" />
              </svg>
              <span>{c.fence}</span>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
