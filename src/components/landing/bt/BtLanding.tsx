"use client";

import { useEffect, useState, type CSSProperties, type ReactNode } from "react";
import Link from "next/link";
import { useLanguage } from "@/lib/i18n/LanguageProvider";
import { landingContent } from "@/lib/i18n/landing-content";
import { proContent, type IconKey } from "@/lib/i18n/landing-pro-content";
import { btContent } from "@/lib/i18n/landing-bt-content";
import LanguageToggle from "@/components/LanguageToggle";
import { Logo } from "@/components/BrandMark";
import { APP_NAME } from "@/lib/brand";
import Icon, { type IconName } from "@/components/Icon";
import { Icon3D } from "@/components/icons3d/Icon3D";
import type { Icon3DName } from "@/lib/ui/icons3d";
import { BtFooter } from "./BtFooter";
import "./bt.css";

/**
 * The public landing page (22 Nov 2026 redesign; design canvas CjCZ9gjHo44VV9fmajante): a deep-teal hero
 * with floating product cards, five problems, three feature stories, the "Ask your business" band, the
 * feature grid, go-live steps, FAQ and CTA. All copy comes from proContent / landingContent / btContent,
 * so EN / हिं switches the whole page. Mock-ups are decorative (aria-hidden) sample data.
 * Styles: bt.css (scoped under .bt).
 */

const WHATSAPP_NUMBER = process.env.NEXT_PUBLIC_WHATSAPP_NUMBER;

const MIC = (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" aria-hidden="true">
    <rect x="9" y="3" width="6" height="11" rx="3" />
    <path d="M5 11a7 7 0 0 0 14 0M12 18v3" />
  </svg>
);

/** The older content keys (landing-pro-content) mapped onto the shared line icons and the 3D set. */
const LINE: Record<IconKey, IconName> = {
  bill: "receipt", box: "box", truck: "truck", pin: "pin", tag: "tag", wallet: "wallet", bank: "cash", chart: "chart", chat: "chat",
  camera: "camera", brand: "sparkle", cart: "cart", mic: "mic", bell: "bell", star: "star", route: "route", clock: "clock", shield: "lock",
  lang: "chat", phone: "phone",
};
const TILE: Record<IconKey, Icon3DName> = {
  bill: "invoice", box: "warehouse", truck: "truck", pin: "beat-map", tag: "percent-tag", wallet: "wallet", bank: "cash-stack", chart: "target",
  chat: "chat-order", camera: "camera", brand: "sparkle", cart: "kirana-shop", mic: "mic", bell: "bell", star: "trophy", route: "beat-map",
  clock: "calendar-slot", shield: "success-tick", lang: "chat-order", phone: "upi-phone",
};
/** The shop's catalogue in the retailer phone mock-up: name, price line, 3D icon, tile tint. */
const PRODS = [
  ["Atta 10 kg", "₹395 · MRP ₹430", "atta", "#fcefd0"],
  ["Mustard oil 1 L", "₹162 · MRP ₹180", "hair-oil", "#ddf6ec"], // switch to "cooking-oil" once that icon exists
  ["Tea 500 g", "₹238 · MRP ₹260", "tea", "#fde7d7"],
  ["Detergent 1 kg", "₹96 · MRP ₹110", "detergent", "#e3eeec"],
] as const satisfies readonly (readonly [string, string, Icon3DName, string])[];

function LineIcon({ name }: { name: IconKey }) {
  return <Icon name={LINE[name]} className="h-full w-full" />;
}
function Arrow() {
  return <Icon name="arrow" className="h-[18px] w-[18px]" weight="bold" />;
}

function Svg({ d, w = 2.2 }: { d: string; w?: number }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={w} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d={d} />
    </svg>
  );
}
const D = {
  tick: "M5 12.5l4.5 4.5L19 7.5",
  card: "M5.5 6h13A2.5 2.5 0 0 1 21 8.5v8a2.5 2.5 0 0 1-2.5 2.5h-13A2.5 2.5 0 0 1 3 16.5v-8A2.5 2.5 0 0 1 5.5 6zM3 10h18M16 15h2",
  tag: "M3 12V4h8l10 10-8 8zM7.5 7a1.5 1.5 0 1 0 0 3 1.5 1.5 0 0 0 0-3z",
  camera: "M4 8h3l2-3h6l2 3h3v11H4zM12 9.5a3.5 3.5 0 1 0 0 7 3.5 3.5 0 0 0 0-7z",
  bolt: "M13 2L4 14h7l-1 8 9-12h-7z",
  burger: "M4 7h16M4 12h16M4 17h10",
  close: "M6 6l12 12M18 6L6 18",
};

/** Puts the part after " — " (or the given ending) in the accent colour; plain when neither fits. */
function accent(title: string, end = ""): ReactNode {
  if (end && title.endsWith(end)) return <>{title.slice(0, -end.length)}<span>{end}</span></>;
  const i = title.lastIndexOf(" — ");
  if (i > 0) return <>{title.slice(0, i + 3)}<span>{title.slice(i + 3)}</span></>;
  return title;
}

const RINGS: { icon: IconKey; a: string; b: string; arc: string; sp: string; bg: string; fg: string }[] = [
  { icon: "cart", a: "#db5c17", b: "#f2b33d", arc: "140deg", sp: "10s", bg: "#fde7d7", fg: "#a93c08" },
  { icon: "box", a: "#f2b33d", b: "#3cc9a0", arc: "150deg", sp: "12s", bg: "#fcefd0", fg: "#6e4e00" },
  { icon: "pin", a: "#3cc9a0", b: "#155651", arc: "160deg", sp: "11s", bg: "#ddf6ec", fg: "#0e6b52" },
  { icon: "truck", a: "#155651", b: "#db5c17", arc: "150deg", sp: "9s", bg: "#e3eeec", fg: "#155651" },
  { icon: "bill", a: "#a93c08", b: "#f2b33d", arc: "170deg", sp: "13s", bg: "#fde7d7", fg: "#a93c08" },
];

const ROUTE = "M60 320 C 130 320 140 250 210 250 S 300 170 300 170 S 380 90 430 90";

export default function BtLanding() {
  const { lang } = useLanguage();
  const p = proContent[lang];
  const c = landingContent[lang];
  const t = btContent[lang];
  const m = p.mock;
  const [menu, setMenu] = useState(false);

  useEffect(() => {
    if (!menu) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setMenu(false);
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [menu]);

  const links = [
    { href: "#product", label: p.nav.features },
    { href: "#solutions", label: p.nav.problems },
    { href: "#how", label: p.nav.how },
    { href: "#faq", label: p.nav.faq },
  ];
  const toast = (role: string, i: number) => p.roles.find((r) => r.key === role)!.toasts[i];
  const lowStock = toast("office", 1);
  const delivered = toast("delivery", 0);
  const cash = toast("delivery", 1);
  const offer = toast("retailer", 0);
  const [delivery, billing] = [p.problems.tabs[3], p.problems.tabs[4]];
  const steps = [
    { t: c.g1, d: c.g1d, bg: "linear-gradient(135deg, #f2b33d, #db5c17)", fg: "#fff" },
    { t: c.g2, d: c.g2d, bg: "linear-gradient(135deg, #3cc9a0, #155651)", fg: "#fff" },
    { t: c.g3, d: c.g3d, bg: "linear-gradient(135deg, #0c3634, #155651)", fg: "#f2b33d" },
  ];
  const dots = ["#f2b33d", "#3cc9a0", "#db5c17"];

  return (
    <div className="bt" id="top">
      {/* ================= HERO ================= */}
      <header className="bt-hero">
        <div className="bt-hero-bg" aria-hidden="true">
          <div className="bt-glow" style={{ width: 760, height: 760, right: -160, top: -260, background: "radial-gradient(circle, rgba(219,92,23,.62) 0%, rgba(219,92,23,0) 66%)", animationDuration: "9s" }} />
          <div className="bt-glow" style={{ width: 640, height: 640, left: -220, top: 260, background: "radial-gradient(circle, rgba(60,201,160,.32) 0%, rgba(60,201,160,0) 66%)", animationDuration: "11s", animationDelay: "2s" }} />
          <div className="bt-glow" style={{ width: 520, height: 520, left: "42%", top: 380, background: "radial-gradient(circle, rgba(242,179,61,.26) 0%, rgba(242,179,61,0) 66%)", animationDuration: "13s", animationDelay: "4s" }} />
          <div className="bt-dots" />
        </div>

        <nav className="bt-nav" aria-label="Primary">
          <a href="#top" className="bt-logo" aria-label={APP_NAME}>
            <Logo kind="onDark" height={33} priority />
          </a>
          <div className="bt-links">
            {links.map((l) => (
              <a key={l.href} href={l.href}>{l.label}</a>
            ))}
          </div>
          <div className="bt-navr">
            <span className="bt-lang"><LanguageToggle /></span>
            <Link href="/login" className="bt-signin">{c.signIn}</Link>
            <Link href="/start" className="bt-navcta">{p.hero.cta1}</Link>
            <button type="button" className="bt-burger" aria-expanded={menu} aria-controls="bt-menu" aria-label={menu ? t.closeMenu : t.menu} onClick={() => setMenu((o) => !o)}>
              <Svg d={menu ? D.close : D.burger} />
            </button>
          </div>
          <div id="bt-menu" className="bt-menu" hidden={!menu}>
            {links.map((l) => (
              <a key={l.href} href={l.href} onClick={() => setMenu(false)}>{l.label}</a>
            ))}
            <div className="bt-menu-foot">
              <LanguageToggle />
              <Link href="/login" className="bt-btn bt-btn-line" onClick={() => setMenu(false)}>{c.signIn}</Link>
              <Link href="/start" className="bt-btn bt-btn-k" onClick={() => setMenu(false)}>{p.hero.cta1}</Link>
            </div>
          </div>
        </nav>

        <div className="bt-hcopy">
          <p className="bt-eyebrow"><i aria-hidden="true" />{p.hero.eyebrow}</p>
          <h1 className="bt-h1">{p.hero.title1} <span>{p.hero.title2}</span></h1>
          <p className="bt-hsub">{p.hero.sub}</p>
          <div className="bt-hcta">
            <Link href="/start" className="bt-btn bt-btn-k">{p.hero.cta1}<Arrow /></Link>
            <a href="#how" className="bt-btn bt-btn-glass">
              <span className="bt-play" aria-hidden="true"><svg viewBox="0 0 24 24" fill="currentColor"><path d="M7 4l13 8-13 8z" /></svg></span>
              {p.hero.cta2}
            </a>
          </div>
          <ul className="bt-notes">
            {p.hero.notes.map((n) => (
              <li key={n}><Svg d={D.tick} w={2.6} />{n}</li>
            ))}
          </ul>
        </div>

        {/* desktop / tablet scene */}
        <div className="bt-stage" aria-hidden="true">
          <div className="bt-dash">
            <div className="bt-win">
              <div className="bt-winbar">
                <i style={{ background: "#e8846a" }} /><i style={{ background: "#f2b33d" }} /><i style={{ background: "#3cc9a0" }} />
                <span>{m.search}</span>
              </div>
              <div className="bt-wingrid">
                <div className="bt-side">{m.menu.map((x) => <span key={x}>{x}</span>)}</div>
                <div className="bt-main">
                  <div className="bt-main-h"><b className="bt-disp">{m.today}</b><small>{t.mock.weekday}</small></div>
                  <div className="bt-kpis">
                    <div className="bt-kpi" style={{ background: "#fde7d7" }}><small style={{ color: "#a93c08" }}>{m.ordersToday}</small><b className="bt-disp">86</b></div>
                    <div className="bt-kpi" style={{ background: "#ddf6ec" }}><small style={{ color: "#0e6b52" }}>{m.collected}</small><b className="bt-disp">₹1.42L</b></div>
                    <div className="bt-kpi" style={{ background: "#e3eeec" }}><small style={{ color: "#155651" }}>{m.outForDelivery}</small><b className="bt-disp">23</b></div>
                    <div className="bt-kpi" style={{ background: "#fcefd0" }}><small style={{ color: "#6e4e00" }}>{m.lowStock}</small><b className="bt-disp">4</b></div>
                  </div>
                  <div className="bt-dgrid">
                    <div className="bt-box">
                      <b>{m.recentOrders}</b>
                      <div className="bt-rows">
                        {([["Gupta General Store", "₹3,120", "placed"], ["Sharma Kirana", "₹4,133", "packed"], ["Ansari Store", "₹2,870", "onWay"], ["Sai Super Mart", "₹6,410", "delivered"]] as const).map(([shop, amt, st]) => (
                          <div key={shop}><span>{shop}</span><span><b>{amt}</b><span className={`bt-st bt-st-${st}`}>{m.st[st]}</span></span></div>
                        ))}
                      </div>
                    </div>
                    <div className="bt-box">
                      <b>{t.mock.week}</b>
                      <div className="bt-bars">{[42, 58, 50, 72, 64, 96].map((h) => <i key={h} style={{ height: `${h}%` }} />)}</div>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>

          <div className="bt-inv bt-f1">
            <div className="bt-card">
              <span className="bt-shine" />
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
                <div><div className="bt-card-cap">{t.mock.taxInvoice}</div><div className="bt-card-no bt-disp">INV/2026/0418</div></div>
                <QrTile />
              </div>
              <div><div style={{ fontSize: 13, opacity: 0.9 }}>Gupta General Store · {t.mock.items}</div><div className="bt-card-amt bt-disp">₹3,120.00</div></div>
              <div className="bt-card-foot"><span>CGST 2.5% · SGST 2.5%</span><span>GSTIN 07AAMC…1ZA</span></div>
            </div>
          </div>

          <div className="bt-rphone bt-f2">
            <div className="bt-phone">
              <RetailerCart t={t} placeOrder={m.placeOrder} offer={m.offer} />
            </div>
          </div>

          <div className="bt-gchip bt-f1" style={{ left: 380, top: 0, animationDelay: "1s", animationDuration: "6s" }}>
            <span className="bt-chip-ic" style={{ background: "#f2b33d", color: "#0f2a2a" }}><Icon name="box" /></span>
            <span><b>{lowStock[0]}</b><small>{lowStock[1]}</small></span>
          </div>
          <div className="bt-chip bt-f2" style={{ position: "absolute", left: 90, top: 430, animationDuration: "7s" }}>
            <span className="bt-chip-ic" style={{ background: "#ddf6ec", color: "#0e6b52" }}><Svg d={D.tick} w={2.6} /></span>
            <span><b>{delivered[0]}</b><small>{delivered[1]}</small></span>
          </div>
          <div className="bt-chip bt-f1" style={{ position: "absolute", right: 200, top: 470, animationDelay: "2s", animationDuration: "8s" }}>
            <span className="bt-chip-ic" style={{ background: "#fde7d7", color: "#a93c08" }}><Svg d={D.card} /></span>
            <span><b>{cash[0]}</b><small>{cash[1]}</small></span>
          </div>
        </div>

        {/* phone scene */}
        <div className="bt-stage-m" aria-hidden="true">
          <div className="bt-phone" style={{ position: "absolute", left: "50%", top: 10, marginLeft: -105, width: 210, height: 410, borderRadius: 36, padding: 9 }}>
            <RetailerCart t={t} placeOrder={m.placeOrder} offer={m.offer} small />
          </div>
          <div className="bt-f1" style={{ position: "absolute", left: 8, top: 60 }}>
            <div className="bt-card" style={{ width: 150, height: 96, padding: 12, borderRadius: 16, transform: "rotate(-10deg)", justifyContent: "flex-start" }}>
              <span className="bt-shine" />
              <div className="bt-card-cap" style={{ fontSize: 9.5 }}>{t.mock.taxInvoice}</div>
              <div className="bt-disp" style={{ fontSize: 22, fontWeight: 800, marginTop: 14 }}>₹3,120</div>
            </div>
          </div>
          <div className="bt-chip bt-f2" style={{ position: "absolute", right: 6, top: 210, padding: "9px 12px 9px 9px", borderRadius: 14 }}>
            <span className="bt-chip-ic" style={{ width: 30, height: 30, borderRadius: 10, background: "#ddf6ec", color: "#0e6b52" }}><Svg d={D.tick} w={2.8} /></span>
            <span><b style={{ fontSize: 12 }}>{delivered[0]}</b><small style={{ fontSize: 10.5 }}>{delivered[1]}</small></span>
          </div>
          <div className="bt-chip bt-f1" style={{ position: "absolute", left: 10, top: 320, padding: "9px 12px 9px 9px", borderRadius: 14, animationDelay: "1s" }}>
            <span className="bt-chip-ic" style={{ width: 30, height: 30, borderRadius: 10, background: "#fde7d7", color: "#a93c08" }}><Svg d={D.card} /></span>
            <span><b style={{ fontSize: 12 }}>{cash[0]}</b><small style={{ fontSize: 10.5 }}>{cash[1]}</small></span>
          </div>
        </div>
      </header>

      <main>
        {/* ================= TRUST ================= */}
        <section className="bt-trust bt-in" aria-label={p.trust.lead}>
          <p>{p.trust.lead}</p>
          <ul>{p.trust.items.map((x) => <li key={x}>{x}</li>)}</ul>
        </section>

        {/* ================= FIVE PROBLEMS ================= */}
        <section id="solutions" className="bt-sec bt-in">
          <div className="bt-head">
            <span className="bt-bolt" aria-hidden="true"><Svg d={D.bolt} w={2.4} /></span>
            <h2 className="bt-h2">{p.problems.title}</h2>
            <p className="bt-sub">{p.problems.sub}</p>
          </div>
          <ul className="bt-five">
            {p.problems.tabs.map((tab, i) => {
              const r = RINGS[i];
              return (
                <li key={tab.tab}>
                  <span className="bt-ring" aria-hidden="true" style={{ "--bt-a": r.a, "--bt-b": r.b, "--bt-arc": r.arc, "--bt-sp": r.sp } as CSSProperties}>
                    <span><span style={{ background: r.bg, color: r.fg }}><Icon3D name={TILE[r.icon]} size={46} /></span></span>
                  </span>
                  <div>
                    <h3>{tab.title}</h3>
                    <p>{tab.body}</p>
                  </div>
                </li>
              );
            })}
          </ul>
        </section>

        {/* ================= RETAILERS ================= */}
        <section id="product" className="bt-sec bt-in" style={{ paddingBottom: 100 }}>
          <div className="bt-split">
            <div className="bt-vis bt-retail-vis" aria-hidden="true">
              <div className="bt-blob" style={{ inset: "40px 20px", background: "linear-gradient(150deg, #fde7d7 0%, #fcefd0 100%)" }} />
              <div className="bt-phone">
                <div className="bt-screen">
                  <div className="bt-scr-h" style={{ padding: "30px 18px 16px" }}>
                    <small>Sai Super Mart · Aminabad</small>
                    <b className="bt-disp" style={{ fontSize: 19 }}>{t.mock.yourCatalogue}</b>
                    <div className="bt-search">{m.typeOrder}</div>
                  </div>
                  <div className="bt-prods">
                    {PRODS.map(([n, pr, icon, tint]) => (
                      <div className="bt-prod" key={n}>
                        <i style={{ background: tint }}><Icon3D name={icon} size={52} /></i>
                        <b>{n}</b>
                        <small>{pr}</small>
                      </div>
                    ))}
                  </div>
                  <div className="bt-place" style={{ justifyContent: "space-between", minHeight: 46, margin: "auto 14px 16px" }}><span>{m.cart} · {t.mock.items}</span><span>₹4,133</span></div>
                </div>
              </div>
              <div className="bt-heard bt-f1" style={{ animationDuration: "6s" }}>
                <div><span className="bt-mic">{MIC}</span>{t.mock.heard}</div>
                <p>{t.mock.heardSay}</p>
                <small>{t.mock.heardNote}</small>
              </div>
              <div className="bt-chip bt-offer bt-f2" style={{ animationDuration: "7s" }}>
                <span className="bt-chip-ic" style={{ background: "#3cc9a0", color: "#0c3634" }}><Svg d={D.tag} /></span>
                <span><b>{offer[0]}</b><small>{offer[1]}</small></span>
              </div>
            </div>
            <div>
              <span className="bt-kick bt-kick-k">{p.retail.kick}</span>
              <h2 className="bt-h2 bt-h2s bt-acc-k">{accent(p.retail.title)}</h2>
              <p className="bt-sub">{p.retail.sub}</p>
              <ul className="bt-feats">
                {p.retail.items.map((it) => (
                  <li key={it.t}>
                    <span aria-hidden="true"><Icon3D name={TILE[it.icon]} size={40} /></span>
                    <span><b>{it.t}</b><small>{it.d}</small></span>
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </section>

        {/* ================= DELIVERY ================= */}
        <section className="bt-dark">
          <div>
            <div className="bt-glow" aria-hidden="true" style={{ width: 560, height: 560, left: -200, bottom: -260, background: "radial-gradient(circle, rgba(219,92,23,.45), rgba(219,92,23,0) 66%)" }} />
            <div className="bt-split">
              <div>
                <span className="bt-kick bt-kick-d">{t.delivery.kick}</span>
                <h2 className="bt-h2 bt-h2s">{accent(delivery.title, t.delivery.accent)}</h2>
                <p className="bt-sub">{delivery.body}</p>
                <ul className="bt-ticks">
                  {delivery.points.map((pt) => (
                    <li key={pt}><span className="bt-tick" aria-hidden="true"><Svg d={D.tick} w={3} /></span>{pt}</li>
                  ))}
                </ul>
              </div>
              <div className="bt-vis bt-route-vis" aria-hidden="true">
                <div className="bt-map">
                  <svg width="520" height="380" viewBox="0 0 520 380">
                    <g stroke="rgba(255,255,255,.07)" strokeWidth="14" fill="none" strokeLinecap="round"><path d="M0 90H520M0 250H520M120 0V380M300 0V380M430 0V380" /></g>
                    <g stroke="rgba(255,255,255,.05)" strokeWidth="6" fill="none"><path d="M0 170H520M0 320H520M60 0V380M210 0V380M370 0V380" /></g>
                    <path d={ROUTE} fill="none" stroke="rgba(242,179,61,.25)" strokeWidth="10" strokeLinecap="round" />
                    <path className="bt-route" d={ROUTE} fill="none" stroke="#f2b33d" strokeWidth="4" strokeLinecap="round" strokeDasharray="14 10" />
                    <g fontSize="12" fontWeight="700" textAnchor="middle" fontFamily="sans-serif">
                      {([[60, 320, "✓", "#3cc9a0"], [210, 250, "✓", "#3cc9a0"], [300, 170, "3", "#fff"], [430, 90, "4", "#fff"]] as const).map(([x, y, s, f]) => (
                        <g key={x}><circle cx={x} cy={y} r="14" fill={f} /><text x={x} y={y + 4} fill="#0c3634">{s}</text></g>
                      ))}
                    </g>
                  </svg>
                  <div className="bt-van" style={{ margin: "-15px 0 0 -15px" }} />
                  <div className="bt-trip">{m.trip} · 9/14</div>
                </div>
                <div className="bt-pod bt-f1" style={{ animationDuration: "6s" }}>
                  <div>
                    <span className="bt-chip-ic" style={{ width: 36, height: 36, background: "#ddf6ec", color: "#0e6b52" }}><Svg d={D.camera} /></span>
                    <span><b>{delivered[0]}</b><small>Sharma Kirana · 09:42</small></span>
                  </div>
                  <div className="bt-sig"><svg width="150" height="40" viewBox="0 0 150 40"><path d="M6 30c14-24 22-24 26-6s10 14 18-2 14-14 18 4 12 10 22-6 16-8 22 2 14 8 32-10" fill="none" stroke="#0f2a2a" strokeWidth="2.4" strokeLinecap="round" /></svg></div>
                  <small style={{ display: "block", marginTop: 8, fontSize: 11.5 }}>{t.mock.signatureSaved}</small>
                </div>
                <div className="bt-cash bt-f2" style={{ animationDuration: "7s" }}>
                  <span><Svg d={D.card} /></span>
                  <span><b className="bt-disp">₹4,133</b><small>{cash[0]} · {cash[1].split("·").pop()?.trim()}</small></span>
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* ================= BILLING ================= */}
        <section className="bt-sec bt-in" style={{ paddingBottom: 110 }}>
          <div className="bt-split">
            <div className="bt-vis bt-bill-vis" aria-hidden="true">
              <div className="bt-blob" style={{ inset: "30px 40px 20px 0", background: "linear-gradient(150deg, #e3eeec 0%, #ddf6ec 100%)" }} />
              <div className="bt-gstr">
                <div className="bt-card-cap">{t.billing.gstrTitle}</div>
                <b className="bt-disp">{t.billing.gstrBig}</b>
                <small>{t.billing.gstrNote}</small>
              </div>
              <div className="bt-khata">
                <div className="bt-khata-top"><span className="bt-card-cap" style={{ opacity: 0.8 }}>{t.billing.khata} · Ansari Store</span><em>{t.billing.within}</em></div>
                <div className="bt-khata-amt bt-disp">₹31,000 <small>{t.billing.of} ₹50,000</small></div>
                <div className="bt-meter"><i /></div>
                <div className="bt-khata-note">{t.billing.khataNote}</div>
              </div>
              <div className="bt-binv bt-f1">
                <div className="bt-card">
                  <span className="bt-shine" style={{ animationDuration: "6s", animationDelay: "1s" }} />
                  <div><div className="bt-card-cap">{t.mock.taxInvoice} · {t.mock.shareLink}</div><div className="bt-card-no bt-disp">Sharma Kirana</div></div>
                  <div className="bt-card-amt bt-disp">₹4,133.00</div>
                  <div className="bt-card-foot" style={{ fontSize: 12 }}><span>{t.mock.paidUpi}</span><span>{t.mock.creditNote} −₹120</span></div>
                </div>
              </div>
            </div>
            <div>
              <span className="bt-kick bt-kick-p">{t.billing.kick}</span>
              <h2 className="bt-h2 bt-h2s bt-acc-m">{accent(billing.title, t.billing.accent)}</h2>
              <p className="bt-sub">{billing.body}</p>
              <ul className="bt-plist">
                {billing.points.map((pt, i) => {
                  const look = [
                    { bg: "#fde7d7", fg: "#a93c08", icon: "bill" as IconKey },
                    { bg: "#fcefd0", fg: "#6e4e00", icon: "wallet" as IconKey },
                    { bg: "#ddf6ec", fg: "#0e6b52", icon: "shield" as IconKey },
                  ][i % 3];
                  return (
                    <li key={pt}><span aria-hidden="true" style={{ background: look.bg, color: look.fg }}><LineIcon name={look.icon} /></span>{pt}</li>
                  );
                })}
              </ul>
            </div>
          </div>
        </section>

        {/* ================= ASK ================= */}
        <section className="bt-ask" aria-label={t.ask.kick}>
          <div>
            <div className="bt-ask-ring" aria-hidden="true" style={{ width: 420, height: 420, right: -120, top: -160, border: "60px solid rgba(255,255,255,.1)" }} />
            <div className="bt-ask-ring" aria-hidden="true" style={{ width: 220, height: 220, left: "38%", bottom: -120, border: "36px solid rgba(255,255,255,.08)" }} />
            <div style={{ position: "relative" }}>
              <p className="bt-ask-k">{t.ask.kick}</p>
              <h2 className="bt-h2">{t.ask.title}</h2>
              <p className="bt-sub">{t.ask.sub}</p>
            </div>
            <div className="bt-chat" aria-hidden="true">
              <div className="bt-q"><span className="bt-type">{t.ask.question}</span><span className="bt-caret" /></div>
              <div className="bt-a bt-f1">
                <div className="bt-a-h"><b className="bt-disp">{t.ask.answer}</b><small>{t.ask.range}</small></div>
                <ul>
                  {([["Verma Provision", 12], ["New Bharat Stores", 9], ["Khan Traders", 8]] as const).map(([s, d]) => (
                    <li key={s}><span>{s}</span><b>{d} {t.ask.days}</b></li>
                  ))}
                </ul>
                <p className="bt-a-more">{t.ask.open} →</p>
              </div>
            </div>
          </div>
        </section>

        {/* ================= GRID ================= */}
        <section id="features" className="bt-sec bt-in">
          <div className="bt-head">
            <span className="bt-kick bt-kick-n">{p.grid.kick}</span>
            <h2 className="bt-h2">{p.grid.title}</h2>
            <p className="bt-sub">{p.grid.sub}</p>
          </div>
          <ul className="bt-grid">
            {p.grid.items.map((it, i) => (
              <li className="bt-gcard" key={it.t}>
                <span className={`bt-gic ${(i + Math.floor(i / 4)) % 2 ? "bt-gic-m" : "bt-gic-k"}`} aria-hidden="true"><Icon3D name={TILE[it.icon]} size={36} /></span>
                <h3>{it.t}</h3>
                <p>{it.d}</p>
              </li>
            ))}
          </ul>
        </section>

        {/* ================= WORKS WITH ================= */}
        <section id="devices" className="bt-works" aria-label={`${t.works.title1} ${t.works.title2}`}>
          <h2>{t.works.title1} <span>{t.works.title2}</span></h2>
          <div className="bt-marq" aria-hidden="true">
            {[...t.works.chips, ...t.works.chips].map((x, i) => (
              <span key={i}><i style={{ background: dots[i % 3] }} />{x}</span>
            ))}
          </div>
        </section>

        {/* ================= STEPS ================= */}
        <section id="how" className="bt-sec bt-in">
          <div className="bt-head">
            <span className="bt-kick bt-kick-k">{p.steps.kick}</span>
            <h2 className="bt-h2">{p.steps.title}</h2>
          </div>
          <ol className="bt-steps">
            {steps.map((s, i) => (
              <li key={s.t}>
                <span className="bt-disp" style={{ background: s.bg, color: s.fg }}>{i + 1}</span>
                <div>
                  <h3>{s.t}</h3>
                  <p>{s.d}</p>
                </div>
              </li>
            ))}
          </ol>
        </section>

        {/* ================= FAQ ================= */}
        <section id="faq" className="bt-faq">
          <h2>{t.faqTitle}</h2>
          <div className="bt-faq-list">
            {c.faq.map((item, i) => (
              <details key={item.q} open={i === 0}>
                <summary>{item.q}<span className="bt-plus" aria-hidden="true">+</span></summary>
                <p>{item.a}</p>
              </details>
            ))}
          </div>
        </section>

        {/* ================= CTA ================= */}
        <section id="start" className="bt-cta bt-in">
          <div className="bt-cta-card">
            <div className="bt-glow" aria-hidden="true" style={{ width: 520, height: 520, left: -140, top: -240, background: "radial-gradient(circle, rgba(219,92,23,.6), rgba(219,92,23,0) 66%)", animationDuration: "9s" }} />
            <div className="bt-glow" aria-hidden="true" style={{ width: 480, height: 480, right: -120, bottom: -260, background: "radial-gradient(circle, rgba(242,179,61,.42), rgba(242,179,61,0) 66%)", animationDuration: "11s", animationDelay: "2s" }} />
            <h2 className="bt-h2">{accent(p.cta.title, lang === "en" ? "VBiz Pro?" : "")}</h2>
            <p className="bt-sub">{p.cta.sub}</p>
            <div className="bt-hcta">
              <Link href="/start" className="bt-btn bt-btn-k">{p.cta.primary}<Arrow /></Link>
              {WHATSAPP_NUMBER ? (
                <a href={`https://wa.me/${WHATSAPP_NUMBER}`} target="_blank" rel="noopener noreferrer" className="bt-btn bt-btn-glass">{c.ctaWa}</a>
              ) : (
                <Link href="/login" className="bt-btn bt-btn-glass">{p.cta.secondary}</Link>
              )}
            </div>
          </div>
        </section>
      </main>

      <div className="vp">
        <BtFooter />
      </div>
    </div>
  );
}

function QrTile() {
  return (
    <svg width="44" height="44" viewBox="0 0 44 44">
      <rect width="44" height="44" rx="8" fill="#fff" />
      <g fill="#0f2a2a">
        <rect x="6" y="6" width="12" height="12" rx="2" /><rect x="26" y="6" width="12" height="12" rx="2" /><rect x="6" y="26" width="12" height="12" rx="2" />
        <rect x="26" y="26" width="5" height="5" /><rect x="33" y="33" width="5" height="5" /><rect x="26" y="33" width="4" height="4" /><rect x="33" y="26" width="4" height="4" />
      </g>
      <g fill="#fff"><rect x="9" y="9" width="6" height="6" /><rect x="29" y="9" width="6" height="6" /><rect x="9" y="29" width="6" height="6" /></g>
    </svg>
  );
}

/** The retailer's phone screen in the hero: a typed / spoken order turning into cart lines. */
function RetailerCart({ t, placeOrder, offer, small }: { t: (typeof btContent)["en"]; placeOrder: string; offer: string; small?: boolean }) {
  const f = small ? 10.5 : 11.5;
  const [a, s, b] = t.mock.lines;
  return (
    <div className="bt-screen" style={small ? { borderRadius: 28 } : undefined}>
      <div className="bt-scr-h" style={small ? { padding: "22px 14px 12px" } : undefined}>
        <small>{t.mock.orderingFor}</small>
        <b className="bt-disp" style={small ? { fontSize: 14.5 } : undefined}>Gupta General Store</b>
      </div>
      <div className="bt-say" style={small ? { margin: 10, padding: "9px 10px" } : undefined}>
        <span className="bt-type" style={{ fontSize: f }}>10 atta, 5 salt, 24 biscuits</span>
        <span className="bt-mic" style={small ? { width: 26, height: 26 } : undefined}>{MIC}</span>
      </div>
      <div className="bt-cart" style={small ? { padding: "0 10px", gap: 6 } : undefined}>
        {([[a, "₹3,950"], [s, "₹140"], [b, "₹480"]] as const).map(([n, v], i) => (
          <div className="bt-line" key={n} style={{ fontSize: f, animationDelay: `${i * 0.25}s` }}><span>{n}</span><b>{v}</b></div>
        ))}
        <div className="bt-line bt-line-offer" style={{ animationDelay: ".75s" }}>{offer} · −₹396</div>
      </div>
      <div className="bt-place" style={small ? { margin: "auto 10px 12px", minHeight: 38, fontSize: 12 } : undefined}>{placeOrder} · ₹4,174</div>
    </div>
  );
}

