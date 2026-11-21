"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useLanguage } from "@/lib/i18n/LanguageProvider";
import { landingContent } from "@/lib/i18n/landing-content";
import { proContent } from "@/lib/i18n/landing-pro-content";
import { Logo } from "@/components/BrandMark";
import { useInView, useReducedMotion } from "../use-landing";
import { Arrow, Check, Icon } from "./Icon";
import { Coin, Dot, Mark, Parcel, RouteHub } from "./Deco";

const TICK = 6500;

export default function ProHero() {
  const { lang } = useLanguage();
  const p = proContent[lang];

  return (
    <header className="vp-hero" id="top-hero">
      <div className="vp-hero-bg" aria-hidden="true" />
      <div className="vp-hero-deco" aria-hidden="true">
        <RouteHub className="d1" />
        <Mark className="d2" />
        <Coin className="d3" />
        <Parcel className="d4" />
        <Dot className="d5" />
      </div>
      <div className="vp-hero-copy">
        <span className="vp-eyebrow ls-in" style={{ "--i": 0 } as React.CSSProperties}>
          {p.hero.eyebrow}
        </span>
        <h1 className="vp-h1 ls-in" style={{ "--i": 1 } as React.CSSProperties}>
          {p.hero.title1} <span className="vp-h1-em">{p.hero.title2}</span>
        </h1>
        <p className="vp-lead ls-in" style={{ "--i": 2 } as React.CSSProperties}>
          {p.hero.sub}
        </p>
        <div className="vp-hero-cta ls-in" style={{ "--i": 3 } as React.CSSProperties}>
          <Link href="/start" className="vp-btn vp-btn-solid vp-btn-lg">
            {p.hero.cta1}
            <Arrow />
          </Link>
          <a href="#solutions" className="vp-btn vp-btn-quiet vp-btn-lg">
            {p.hero.cta2}
          </a>
        </div>
        <ul className="vp-notes ls-in" style={{ "--i": 4 } as React.CSSProperties}>
          {p.hero.notes.map((n) => (
            <li key={n}>
              <Check />
              {n}
            </li>
          ))}
        </ul>
      </div>
      <Showcase />
    </header>
  );
}

function Showcase() {
  const { lang } = useLanguage();
  const p = proContent[lang];
  const reduced = useReducedMotion();
  const [ref, inView] = useInView<HTMLDivElement>();
  const [i, setI] = useState(0);
  const [held, setHeld] = useState(false);
  const [hover, setHover] = useState(false);
  const tabsRef = useRef<HTMLDivElement>(null);
  const roles = p.roles;
  const playing = !reduced && !held && !hover && inView;

  useEffect(() => {
    if (!playing) return;
    const id = setTimeout(() => {
      if (!document.hidden) setI((x) => (x + 1) % roles.length);
    }, TICK);
    return () => clearTimeout(id);
  }, [playing, i, roles.length]);

  // Keep the active tab visible when the tab row scrolls sideways (phones).
  useEffect(() => {
    const list = tabsRef.current;
    const el = list?.children[i] as HTMLElement | undefined;
    if (!list || !el || list.scrollWidth <= list.clientWidth) return;
    list.scrollTo({ left: el.offsetLeft - (list.clientWidth - el.offsetWidth) / 2, behavior: reduced ? "auto" : "smooth" });
  }, [i, reduced]);

  const role = roles[i];
  const desktop = role.key === "owner" || role.key === "office";

  return (
    <div className="vp-show ls-in" id="product" ref={ref} style={{ "--i": 5 } as React.CSSProperties}>
      <div className="vp-tabs" role="tablist" aria-label={p.nav.features} ref={tabsRef}>
        {roles.map((r, k) => (
          <button
            key={r.key}
            type="button"
            role="tab"
            id={`vp-tab-${r.key}`}
            aria-selected={k === i}
            aria-controls="vp-stage"
            className={`vp-tab ${k === i ? "on" : ""}`}
            onClick={() => {
              setI(k);
              setHeld(true);
            }}
          >
            {r.label}
            {k === i && <span className="vp-tab-bar" data-playing={playing ? "" : undefined} key={`${i}-${playing}`} style={{ "--t": `${TICK}ms` } as React.CSSProperties} />}
          </button>
        ))}
      </div>
      <p className="vp-show-cap" key={`cap-${role.key}`}>
        {role.caption}
      </p>
      <div
        className={`vp-stage ${desktop ? "is-desk" : "is-phone"}`}
        id="vp-stage"
        role="tabpanel"
        aria-labelledby={`vp-tab-${role.key}`}
        onMouseEnter={() => setHover(true)}
        onMouseLeave={() => setHover(false)}
      >
        <div className="vp-stage-in" key={role.key}>
          {desktop ? (
            <Browser>{role.key === "owner" ? <OwnerScreen /> : <OfficeScreen />}</Browser>
          ) : (
            <div className="vp-phone-row">
              <Toast t={role.toasts[0]} side="l" icon={role.key === "retailer" ? "tag" : "pin"} />
              <Phone>{role.key === "sales" ? <SalesScreen /> : role.key === "delivery" ? <DeliveryScreen /> : <RetailerScreen />}</Phone>
              <Toast t={role.toasts[1]} side="r" icon={role.key === "delivery" ? "wallet" : role.key === "retailer" ? "truck" : "cart"} />
            </div>
          )}
          {desktop && (
            <>
              <Toast t={role.toasts[0]} side="tl" icon="bell" />
              <Toast t={role.toasts[1]} side="br" icon={role.key === "owner" ? "chart" : "box"} />
            </>
          )}
        </div>
      </div>
    </div>
  );
}

export function Toast({ t, side, icon }: { t: [string, string]; side: string; icon: Parameters<typeof Icon>[0]["name"] }) {
  return (
    <div className={`vp-toast vp-toast-${side}`} aria-hidden="true">
      <span className="vp-toast-i">
        <Icon name={icon} />
      </span>
      <span>
        <b>{t[0]}</b>
        <small>{t[1]}</small>
      </span>
    </div>
  );
}

function Browser({ children }: { children: React.ReactNode }) {
  return (
    <div className="vp-browser">
      <div className="vp-browser-bar" aria-hidden="true">
        <i />
        <i />
        <i />
        <span className="vp-url">
          <svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round">
            <rect x="5" y="11" width="14" height="10" rx="2" />
            <path d="M8 11V8a4 4 0 0 1 8 0v3" />
          </svg>
          VBiz Pro
        </span>
      </div>
      <div className="vp-browser-body">{children}</div>
    </div>
  );
}

export function Phone({ children }: { children: React.ReactNode }) {
  return (
    <div className="vp-phone">
      <span className="vp-phone-notch" aria-hidden="true" />
      <div className="vp-phone-scr">{children}</div>
    </div>
  );
}

function AppShell({ active, title, children }: { active: number; title: string; children: React.ReactNode }) {
  const { lang } = useLanguage();
  const m = proContent[lang].mock;
  return (
    <div className="vp-app">
      <aside className="vp-side" aria-hidden="true">
        <span className="vp-side-logo">
          <Logo kind="mark" height={17} />
        </span>
        {m.menu.map((x, k) => (
          <span key={x} className={k === active ? "on" : ""}>
            {x}
          </span>
        ))}
      </aside>
      <div className="vp-main">
        <div className="vp-top">
          <b>{title}</b>
          <span className="vp-search">{m.search}</span>
          <span className="vp-av">RS</span>
        </div>
        {children}
      </div>
    </div>
  );
}

type St = "placed" | "packed" | "onWay" | "delivered";
const ST_CLASS: Record<St, string> = { placed: "chip-mor", packed: "chip-genda", onWay: "chip-kesar", delivered: "chip-mint" };

function OwnerScreen() {
  const { lang } = useLanguage();
  const m = proContent[lang].mock;
  const c = landingContent[lang];
  const kpis = [
    { l: m.ordersToday, v: "128", d: "+14%" },
    { l: m.collected, v: "₹72,480", d: "+9%" },
    { l: m.outForDelivery, v: "14", d: "3 trips" },
    { l: m.lowStock, v: "3", d: c.p3, warn: true },
  ];
  const bars = [42, 58, 50, 66, 61, 78, 88];
  const days = lang === "hi" ? ["सो", "मं", "बु", "गु", "शु", "श", "र"] : ["M", "T", "W", "T", "F", "S", "S"];
  const orders: { s: string; a: string; st: St }[] = [
    { s: "Gupta General Store", a: "₹3,120", st: "delivered" },
    { s: c.shop, a: "₹4,133", st: "onWay" },
    { s: "Verma Traders", a: "₹1,860", st: "packed" },
    { s: "Ansari Store", a: "₹2,450", st: "placed" },
  ];
  return (
    <AppShell active={0} title={`${m.menu[0]} · ${m.today}`}>
      <div className="vp-kpis">
        {kpis.map((k, n) => (
          <div className="vp-kpi" key={k.l} style={{ "--i": n } as React.CSSProperties}>
            <small>{k.l}</small>
            <b className={k.warn ? "warn" : ""}>{k.v}</b>
            <em className={k.warn ? "warn" : ""}>{k.d}</em>
          </div>
        ))}
      </div>
      <div className="vp-dgrid">
        <div className="vp-card">
          <div className="vp-card-h">
            <b>{m.recentOrders}</b>
          </div>
          <div className="vp-table">
            <div className="vp-tr vp-th">
              <span>{m.shop}</span>
              <span>{m.amount}</span>
              <span>{m.status}</span>
            </div>
            {orders.map((o, n) => (
              <div className="vp-tr" key={o.s} style={{ "--i": n } as React.CSSProperties}>
                <span>{o.s}</span>
                <span className="tnum">{o.a}</span>
                <span>
                  <span className={`chip ${ST_CLASS[o.st]}`}>{m.st[o.st]}</span>
                </span>
              </div>
            ))}
          </div>
        </div>
        <div className="vp-card">
          <div className="vp-card-h">
            <b>{m.collected}</b>
            <span className="vp-card-n">₹4.9L</span>
          </div>
          <div className="vp-bars" aria-hidden="true">
            {bars.map((h, n) => (
              <span key={n} style={{ "--h": `${h}%`, "--i": n } as React.CSSProperties}>
                <i />
                <small>{days[n]}</small>
              </span>
            ))}
          </div>
        </div>
      </div>
    </AppShell>
  );
}

function OfficeScreen() {
  const { lang } = useLanguage();
  const m = proContent[lang].mock;
  const c = landingContent[lang];
  const cols: { st: St; cards: { s: string; a: string; n: number }[] }[] = [
    { st: "placed", cards: [{ s: "Ansari Store", a: "₹2,450", n: 9 }, { s: "Mehta Medicos", a: "₹6,210", n: 22 }, { s: "Rizvi Traders", a: "₹1,140", n: 5 }] },
    { st: "packed", cards: [{ s: "Verma Traders", a: "₹1,860", n: 7 }, { s: "Kapoor Stores", a: "₹3,905", n: 16 }] },
    { st: "onWay", cards: [{ s: c.shop, a: "₹4,133", n: 14 }, { s: "Gupta General Store", a: "₹3,120", n: 11 }] },
  ];
  return (
    <AppShell active={2} title={m.dispatch}>
      <div className="vp-dispatch-h">
        <span className="chip chip-mint">{m.tripsReady}</span>
        <span className="vp-mini-btn">
          <Icon name="route" />
          {m.planTrips}
        </span>
      </div>
      <div className="vp-board">
        {cols.map((col, ci) => (
          <div className="vp-col" key={col.st}>
            <div className="vp-col-h">
              <span className={`chip ${ST_CLASS[col.st]}`}>{m.st[col.st]}</span>
              <small>{col.cards.length}</small>
            </div>
            {col.cards.map((k, n) => (
              <div className="vp-ocard" key={k.s} style={{ "--i": ci * 2 + n } as React.CSSProperties}>
                <b>{k.s}</b>
                <span>
                  <small>
                    {k.n} {c.itemsW}
                  </small>
                  <em className="tnum">{k.a}</em>
                </span>
              </div>
            ))}
          </div>
        ))}
      </div>
    </AppShell>
  );
}

function SalesScreen() {
  const { lang } = useLanguage();
  const m = proContent[lang].mock;
  const c = landingContent[lang];
  const visits = [
    { n: 7, s: "Gupta General Store", r: "₹3,120", done: true },
    { n: 8, s: "Verma Traders", r: c.noOrder, done: true },
    { n: 9, s: c.shop, r: "0.2 km", now: true },
    { n: 10, s: "Ansari Store", r: "0.6 km" },
  ];
  return (
    <div className="vp-ps">
      <div className="vp-ps-h">
        <small>{m.beat}</small>
        <b>Aminabad · 9/14</b>
        <span className="vp-ps-bar">
          <i style={{ width: "64%" }} />
        </span>
      </div>
      {visits.map((v, k) => (
        <div className={`vp-ps-row ${v.now ? "now" : ""}`} key={v.n} style={{ "--i": k } as React.CSSProperties}>
          <span className={`vp-ps-n ${v.done ? "done" : ""}`}>{v.done ? "✓" : v.n}</span>
          <span>
            <b>{v.s}</b>
            {v.now && <small>{m.nextShop}</small>}
          </span>
          <em>{v.r}</em>
        </div>
      ))}
      <span className="vp-ps-btn">
        <Icon name="pin" />
        {m.checkIn}
      </span>
    </div>
  );
}

function DeliveryScreen() {
  const { lang } = useLanguage();
  const m = proContent[lang].mock;
  const c = landingContent[lang];
  return (
    <div className="vp-ps">
      <div className="vp-ps-h">
        <small>{m.trip}</small>
        <b>
          5 {m.dropsLeft}
        </b>
      </div>
      <div className="vp-ps-map" aria-hidden="true">
        <svg viewBox="0 0 240 130" preserveAspectRatio="none">
          <path className="r" d="M0 100H240M0 40H240M40 0V130M150 0V130M210 0V130" />
          <path className="rt" d="M40 100V40H150V18H210" />
          <circle cx="40" cy="100" r="6" className="hub" />
          <circle cx="210" cy="18" r="6" className="drop" />
        </svg>
        <span className="vp-ps-rider" />
      </div>
      <div className="vp-ps-drop">
        <span>
          <b>{c.shop}</b>
          <small>
            14 {c.itemsW} · {c.cod}
          </small>
        </span>
        <em className="tnum">₹4,133</em>
      </div>
      <div className="vp-ps-proof">
        <span>
          <Icon name="camera" />
          {lang === "hi" ? "फ़ोटो" : "Photo"}
        </span>
        <span>
          <Icon name="bill" />
          {lang === "hi" ? "साइन" : "Sign"}
        </span>
        <span>
          <Icon name="shield" />
          {lang === "hi" ? "कोड" : "Code"}
        </span>
      </div>
      <div className="vp-ps-row" style={{ "--i": 3 } as React.CSSProperties}>
        <span className="vp-ps-n">2</span>
        <span>
          <b>Ansari Store</b>
          <small>{m.nextShop}</small>
        </span>
        <em>0.6 km</em>
      </div>
      <span className="vp-ps-btn">
        <Icon name="wallet" />
        {m.collect}
      </span>
    </div>
  );
}

export function RetailerScreen() {
  const { lang } = useLanguage();
  const m = proContent[lang].mock;
  const c = landingContent[lang];
  const items = [
    { e: "🧺", n: c.p1, q: 4, pr: "₹585" },
    { e: "🛢️", n: c.p2, q: 6, pr: "₹172" },
    { e: "🫘", n: c.p4, q: 4, pr: "₹148" },
  ];
  return (
    <div className="vp-ps">
      <div className="vp-ps-h">
        <small>{c.catalogue}</small>
        <b>{c.shop}</b>
      </div>
      <div className="vp-ps-search">
        <span>{m.typeOrder}</span>
        <Icon name="mic" />
      </div>
      <div className="vp-ps-offer">
        <Icon name="tag" />
        {m.offer}
      </div>
      {items.map((it, k) => (
        <div className="vp-ps-item" key={it.n} style={{ "--i": k } as React.CSSProperties}>
          <span className="vp-ps-th">{it.e}</span>
          <span>
            <b>{it.n}</b>
            <small>{it.pr}</small>
          </span>
          <span className="vp-step">
            <i>−</i>
            {it.q}
            <i>+</i>
          </span>
        </div>
      ))}
      <span className="vp-ps-btn">
        {m.placeOrder} · ₹4,133
        <Arrow />
      </span>
    </div>
  );
}
