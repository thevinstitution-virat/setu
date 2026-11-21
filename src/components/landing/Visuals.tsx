"use client";

import { useLanguage } from "@/lib/i18n/LanguageProvider";
import { landingContent } from "@/lib/i18n/landing-content";
import { Logo } from "@/components/BrandMark";
import { Confetti, CountUp } from "./use-landing";
import { Phone } from "./pro/Devices";
import { Toast } from "./pro/ProHero";

/**
 * The product mock-ups shown beside the "problems we solve" tabs. They are
 * pictures of real screens (stock, live map, beat, bill), drawn in HTML so they
 * stay sharp, translate with the page and animate.
 */

const Bell = () => (
  <svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
    <path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9M10 21h4" />
  </svg>
);
const Shop = () => (
  <svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
    <path d="M4 10v10h16V10M3 10l2-6h14l2 6zM9 20v-5h6v5" />
  </svg>
);
const Scooter = () => (
  <svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
    <circle cx="6" cy="17" r="2.5" />
    <circle cx="18" cy="17" r="2.5" />
    <path d="M8.5 17h7M15 6h3l2.5 8.5M12 17l-2-7h5" />
  </svg>
);
const Clock = () => (
  <svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
    <circle cx="12" cy="12" r="9" />
    <path d="M12 7v5l3 2" />
  </svg>
);

/**
 * "Orders by phone": the retailer types the list in a chat with the
 * distributor's VBiz Pro order desk and gets a priced cart back to confirm.
 */
export function OrderVisual() {
  const { lang } = useLanguage();
  const c = landingContent[lang];
  const hi = lang === "hi";
  return (
    <div className="vp-ordervis" role="img" aria-label={c.catalogue}>
      <Phone bar={false} className="vp-phone-lg">
        <div className="vp-chatapp">
          <div className="vp-chat-h">
            <svg className="vp-chat-back" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" aria-hidden="true">
              <path d="M15 5l-7 7 7 7" />
            </svg>
            <span className="vp-chat-av">
              <Logo kind="mark" height={14} />
            </span>
            <span>
              <b>
                {hi ? "ऑर्डर डेस्क" : "Order desk"}
                <svg className="vp-chat-ok" viewBox="0 0 24 24" aria-hidden="true">
                  <circle cx="12" cy="12" r="10" />
                  <path d="M7.5 12.5l3 3 6-6.5" fill="none" stroke="#fff" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              </b>
              <small>{hi ? "VBiz Pro · तुरंत जवाब" : "VBiz Pro · replies instantly"}</small>
            </span>
          </div>
          <div className="vp-chat-log">
            <span className="vp-chat-day">{hi ? "आज" : "Today"}</span>
            <span className="vp-msg out" style={{ "--i": 0 } as React.CSSProperties}>
              {hi ? "बासमती 4, सरसों तेल 6, अरहर दाल 4" : "Basmati 4, mustard oil 6, toor dal 4"}
              <small>9:41 ✓✓</small>
            </span>
            <div className="vp-msg in vp-msg-card" style={{ "--i": 1 } as React.CSSProperties}>
              <span className="vp-msg-k">{hi ? "आपका कार्ट · VB-1042" : "Your cart · VB-1042"}</span>
              {[
                ["🧺", c.p1, 4],
                ["🛢️", c.p2, 6],
                ["🫘", c.p4, 4],
              ].map(([e, n, q]) => (
                <span className="vp-msg-line" key={n as string}>
                  <i>{e}</i>
                  <span>{n}</span>
                  <em>× {q}</em>
                </span>
              ))}
              <span className="vp-msg-offer">{c.offerApplied}</span>
              <span className="vp-msg-tot">
                <span>{hi ? "कुल (GST सहित)" : "Total (incl. GST)"}</span>
                <b className="tnum">₹4,133</b>
              </span>
              <span className="vp-msg-btn">{hi ? "ऑर्डर पक्का करें" : "Confirm order"}</span>
              <small>9:41</small>
            </div>
            <span className="vp-msg in vp-msg-done" style={{ "--i": 2 } as React.CSSProperties}>
              {hi ? "✓ ऑर्डर पक्का · कल सुबह 11 बजे तक डिलीवरी" : "✓ Order confirmed · delivery by 11 am tomorrow"}
              <small>9:42</small>
            </span>
          </div>
          <div className="vp-chat-in" aria-hidden="true">
            <span>{hi ? "संदेश लिखें या बोलें…" : "Type or say your order…"}</span>
            <i>
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round">
                <rect x="9" y="3" width="6" height="11" rx="3" />
                <path d="M5 11a7 7 0 0 0 14 0M12 18v3" />
              </svg>
            </i>
          </div>
        </div>
      </Phone>
      <Toast t={[hi ? "ऑफ़िस में नया ऑर्डर" : "New order in the office", "VB-1042 · ₹4,133"]} side="r" icon="bell" />
    </div>
  );
}

/** Godown stock card with low-stock alert and a moving stock register. */
export function InventoryVisual() {
  const { lang } = useLanguage();
  const c = landingContent[lang];
  const rows = [
    { name: c.p1, sku: "RICE-BAS-5", w: "78%", n: 186 },
    { name: c.p2, sku: "OIL-MUS-1L", w: "58%", n: 118 },
    { name: c.p3, sku: "ATTA-10", w: "8%", n: 14, low: true },
    { name: c.p4, sku: "DAL-TOOR-1", w: "88%", n: 204 },
  ];
  return (
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
          <b>
            <CountUp to={248} />
          </b>
        </div>
        <div className="ls-kpi">
          <small>{c.kPacked}</small>
          <b>
            <CountUp to={128} />
          </b>
        </div>
        <div className="ls-kpi">
          <small>{c.kLow}</small>
          <b style={{ color: "var(--kesar-text)" }}>3</b>
        </div>
      </div>
      <div style={{ marginTop: 8 }}>
        {rows.map((r, i) => (
          <div className="ls-sku" key={r.sku}>
            <span>
              <b>{r.name}</b>
              <small>{r.sku}</small>
            </span>
            <span className="bar">
              <i className={`b${i + 1}`} style={{ width: r.w, ...(r.low ? { background: "var(--kesar)" } : {}) }} />
            </span>
            <span className="n" style={r.low ? { color: "var(--kesar-text)" } : undefined}>
              {r.n}
            </span>
          </div>
        ))}
      </div>
      <div className="ls-alert">
        <Bell />
        <span>
          <b>{c.reTitle}</b>
          {c.reBody}
        </span>
      </div>
    </div>
  );
}

/** Sales agent's beat for the day, visit by visit. */
export function BeatVisual() {
  const { lang } = useLanguage();
  const c = landingContent[lang];
  const visits = [
    { n: 7, name: "Gupta General Store", s: c.v1, chip: <span className="chip chip-mint">₹3,120</span> },
    { n: 8, name: c.shop, s: c.v2, chip: <span className="chip chip-mint">₹4,133</span> },
    { n: 9, name: "Verma Traders", s: c.v3, chip: <span className="chip chip-genda">{c.noOrder}</span> },
    { n: 10, name: "Ansari Store", s: c.next, chip: <span className="chip">0.6 km</span> },
  ];
  return (
    <div className="ls-beat vp-surface">
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
      {visits.map((v, i) => (
        <div className="ls-visit vp-in" key={v.n} style={{ "--i": i + 1 } as React.CSSProperties}>
          <span className="ls-visit-n">{v.n}</span>
          <span>
            <b>{v.name}</b>
            <small>{v.s}</small>
          </span>
          {v.chip}
        </div>
      ))}
      <div className="ls-clockin vp-in" style={{ "--i": 5 } as React.CSSProperties}>
        <span className="tile">
          <Clock />
        </span>
        <span>
          <b>{c.attendance}</b>
          <small>{c.attendanceS}</small>
        </span>
        <span className="time">09:02</span>
      </div>
    </div>
  );
}

/** Office view of the city: agents moving, drops ticking off. */
export function MapVisual() {
  const { lang } = useLanguage();
  const c = landingContent[lang];
  return (
    <div className="ls-mapwrap vp-surface vp-mapvis" role="img" aria-label={c.mapAria}>
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
          <Shop />
        </div>
        <div className="ls-pin" style={{ left: "70%", top: "79.03%" }}>
          <Shop />
        </div>
        <div className="ls-pin" style={{ left: "32%", top: "20.97%" }}>
          <Shop />
        </div>
        <span className="ls-mchip mc-ravi" style={{ left: "89%", top: "24%" }}>
          <span className="chip chip-mint">✓ {c.st5}</span>
        </span>
        <span className="ls-mchip mc-imran" style={{ left: "70%", top: "83%" }}>
          <span className="chip chip-mint">✓ {c.st5}</span>
        </span>
        <Confetti className="cf-a" />
        <div className="ls-agent mv-ravi" style={{ left: "11%", top: "79.03%" }}>
          <Scooter />
          <span className="ls-atag">
            Ravi<em>12 min</em>
          </span>
        </div>
        <div className="ls-agent mv-imran" style={{ left: "22%", top: "79.03%" }}>
          <Scooter />
          <span className="ls-atag">
            Imran<em>6 min</em>
          </span>
        </div>
        <div className="ls-agent ls-agent-walk" style={{ left: "38%", top: "20.97%" }}>
          <svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
            <circle cx="12" cy="7" r="3.5" />
            <path d="M5 21a7 7 0 0 1 14 0" />
          </svg>
          <span className="ls-atag">
            Amit<em>{c.visit}</em>
          </span>
        </div>
      </div>
      <div className="vp-mapfoot">
        <span className="ls-live">
          <span className="ls-ldot" />
          LIVE
        </span>
        <span>{c.agentsLive}</span>
        <span className="vp-mapfoot-av">
          <span className="ls-av chip-kesar">RK</span>
          <span className="ls-av chip-genda">IM</span>
          <span className="ls-av chip-mint">SU</span>
          <span className="ls-av chip-mor">AM</span>
        </span>
      </div>
    </div>
  );
}

/** A GST tax invoice with an offer line, plus the day's collections. */
export function BillVisual() {
  const { lang } = useLanguage();
  const c = landingContent[lang];
  const lines = [
    { a: `${c.p1} × 4`, b: "5%", v: "₹2,340" },
    { a: `${c.p2} × 6`, b: "5%", v: "₹1,032" },
    { a: `${c.p4} × 4`, b: "0%", v: "₹592" },
    { a: c.offerLine, b: "", v: "₹396", offer: true },
    { a: "GST 5%", b: "", v: "₹169" },
  ];
  return (
    <div className="ls-bill" role="img" aria-label={c.billAria}>
      <div className="ls-bill-h">
        <span>
          <span style={{ fontSize: 12.5, fontWeight: 700, color: "var(--kesar-text)" }}>{c.taxInvoice}</span>
          <b>{c.shop}</b>
        </span>
        <span style={{ textAlign: "right" }}>
          <span style={{ fontSize: 12.5, fontWeight: 700, color: "var(--kesar-text)" }}>VB-1042</span>
          <span style={{ display: "block", fontSize: 12.5, color: "var(--muted)" }}>18 Nov 2026</span>
        </span>
      </div>
      {lines.map((l, i) => (
        <div className={`ls-bl vp-in ${l.offer ? "offer" : ""}`} key={i} style={{ "--i": i + 1 } as React.CSSProperties}>
          <span>{l.a}</span>
          <span>{l.b}</span>
          <span className="tnum">{l.v}</span>
        </div>
      ))}
      <div className="ls-btot">
        <span>{c.total}</span>
        <b className="big tnum">₹4,133</b>
      </div>
      <div className="ls-pays">
        <div className="ls-pay">
          <small>{c.cash}</small>
          <b>₹38,420</b>
        </div>
        <div className="ls-pay">
          <small>{c.online}</small>
          <b>₹21,760</b>
        </div>
        <div className="ls-pay">
          <small>{c.credit}</small>
          <b>₹12,300</b>
        </div>
      </div>
    </div>
  );
}
