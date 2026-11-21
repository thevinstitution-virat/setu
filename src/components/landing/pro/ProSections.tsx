"use client";

import { useRef, useState } from "react";
import Link from "next/link";
import { useLanguage } from "@/lib/i18n/LanguageProvider";
import { landingContent } from "@/lib/i18n/landing-content";
import { proContent } from "@/lib/i18n/landing-pro-content";
import LanguageToggle from "@/components/LanguageToggle";
import { CountUp } from "../use-landing";
import { BeatVisual, BillVisual, InventoryVisual, MapVisual, OrderVisual } from "../Visuals";
import { Arrow, Check, Icon } from "./Icon";
import { Logo } from "@/components/BrandMark";
import { APP_NAME } from "@/lib/brand";
import { OfficeScreen, OwnerScreen, RetailerScreen, SalesScreen, Toast } from "./ProHero";
import { AppBar, Laptop, Phone, Tablet } from "./Devices";
import { Coin, Dot, Mark, Parcel, RouteHub, TrendLine } from "./Deco";

const WHATSAPP_NUMBER = process.env.NEXT_PUBLIC_WHATSAPP_NUMBER;
const CONTACT_EMAIL = process.env.NEXT_PUBLIC_CONTACT_EMAIL;

export function TrustStrip() {
  const { lang } = useLanguage();
  const p = proContent[lang];
  return (
    <section className="vp-trust ls-rv" aria-label={p.trust.lead}>
      <p>{p.trust.lead}</p>
      <ul>
        {p.trust.items.map((t) => (
          <li key={t}>{t}</li>
        ))}
      </ul>
    </section>
  );
}

const VISUALS = [OrderVisual, InventoryVisual, BeatVisual, MapVisual, BillVisual];

export function ProblemsSection() {
  const { lang } = useLanguage();
  const p = proContent[lang].problems;
  const [i, setI] = useState(0);
  const tabs = useRef<(HTMLButtonElement | null)[]>([]);
  const tab = p.tabs[i];
  const Visual = VISUALS[i];

  const onKey = (e: React.KeyboardEvent) => {
    if (e.key !== "ArrowRight" && e.key !== "ArrowLeft") return;
    e.preventDefault();
    const n = (i + (e.key === "ArrowRight" ? 1 : p.tabs.length - 1)) % p.tabs.length;
    setI(n);
    tabs.current[n]?.focus();
  };

  return (
    <section className="vp-dark" id="solutions">
      <div className="vp-wrap ls-rv">
        <div className="vp-head center">
          <span className="vp-kick">{p.kick}</span>
          <h2 className="vp-h2">{p.title}</h2>
          <p className="vp-sub">{p.sub}</p>
        </div>
        <div className="vp-ptabs" role="tablist" aria-label={p.title} onKeyDown={onKey}>
          {p.tabs.map((t, k) => (
            <button
              key={k}
              ref={(el) => {
                tabs.current[k] = el;
              }}
              type="button"
              role="tab"
              id={`vp-ptab-${k}`}
              aria-selected={k === i}
              aria-controls="vp-ppanel"
              tabIndex={k === i ? 0 : -1}
              className={k === i ? "on" : ""}
              onClick={() => setI(k)}
            >
              <span className="vp-ptab-n">{String(k + 1).padStart(2, "0")}</span>
              {t.tab}
            </button>
          ))}
        </div>
        <div className="vp-ppanel" id="vp-ppanel" role="tabpanel" aria-labelledby={`vp-ptab-${i}`} key={`${lang}-${i}`}>
          <div className="vp-ptext">
            <h3>{tab.title}</h3>
            <p>{tab.body}</p>
            <ul>
              {tab.points.map((pt) => (
                <li key={pt}>
                  <Check />
                  {pt}
                </li>
              ))}
            </ul>
            <Link href="/start" className="vp-link">
              {proContent[lang].hero.cta1}
              <Arrow />
            </Link>
          </div>
          <div className="vp-pvis">
            <Coin className="vp-pvis-coin" />
            <Dot className="vp-pvis-dot" />
            <Visual />
          </div>
        </div>
      </div>
    </section>
  );
}

export function RetailSection() {
  const { lang } = useLanguage();
  const r = proContent[lang].retail;
  const retailer = proContent[lang].roles.find((x) => x.key === "retailer")!;
  return (
    <section className="vp-sec" id="retailers">
      <div className="vp-wrap vp-split">
        <div className="vp-retail-vis ls-rv">
          <RouteHub className="vp-retail-hub" />
          <Parcel className="vp-retail-parcel" />
          <Tablet className="vp-retail-tab">
            <CounterScreen />
          </Tablet>
          <Phone sub={retailer.label}>
            <RetailerScreen />
          </Phone>
          <Toast t={retailer.toasts[0]} side="tl" icon="tag" />
          <Toast t={retailer.toasts[1]} side="br" icon="truck" />
        </div>
        <div className="ls-rv">
          <span className="vp-kick">{r.kick}</span>
          <h2 className="vp-h2">{r.title}</h2>
          <p className="vp-sub">{r.sub}</p>
          <ul className="vp-flist">
            {r.items.map((it, k) => (
              <li key={it.t} style={{ "--i": k } as React.CSSProperties}>
                <span className="vp-ficon">
                  <Icon name={it.icon} />
                </span>
                <span>
                  <b>{it.t}</b>
                  <span>{it.d}</span>
                </span>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </section>
  );
}

/** The retailer's catalogue on a counter tablet: product tiles and the cart. */
function CounterScreen() {
  const { lang } = useLanguage();
  const c = landingContent[lang];
  const m = proContent[lang].mock;
  const items = [
    { e: "🧺", n: c.p1, pr: "₹585", q: 4 },
    { e: "🛢️", n: c.p2, pr: "₹172", q: 6 },
    { e: "🌾", n: c.p3, pr: "₹412", q: 0 },
    { e: "🫘", n: c.p4, pr: "₹148", q: 4 },
    { e: "🧂", n: lang === "hi" ? "नमक 1 किलो" : "Salt 1 kg", pr: "₹24", q: 0 },
    { e: "🍵", n: lang === "hi" ? "चाय पत्ती 500 ग्रा" : "Tea 500 g", pr: "₹265", q: 0 },
  ];
  return (
    <div className="vp-counter">
      <AppBar sub={`${c.shop} · ${proContent[lang].suite.counter}`} />
      <div className="vp-counter-in">
        <div>
          <div className="vp-counter-h">
            <b>{c.catalogue}</b>
            <span className="vp-ps-offer">
              <Icon name="tag" />
              {m.offer}
            </span>
          </div>
          <div className="vp-counter-grid">
            {items.map((it, k) => (
              <div className={`vp-counter-card ${it.q ? "on" : ""}`} key={it.n} style={{ "--i": k } as React.CSSProperties}>
                <span className="vp-counter-th">{it.e}</span>
                <b>{it.n}</b>
                <span className="vp-counter-row">
                  <small>{it.pr}</small>
                  {it.q ? <em>× {it.q}</em> : <i>+</i>}
                </span>
              </div>
            ))}
          </div>
        </div>
        <aside className="vp-counter-cart">
          <b>{m.cart}</b>
          {items
            .filter((it) => it.q)
            .map((it) => (
              <span key={it.n}>
                <span>{it.n}</span>
                <em>× {it.q}</em>
              </span>
            ))}
          <small>{c.offerApplied}</small>
          <span className="vp-counter-tot">
            <span>{c.total}</span>
            <b className="tnum">₹4,133</b>
          </span>
          <span className="vp-ps-btn">{m.placeOrder}</span>
        </aside>
      </div>
    </div>
  );
}

const DEVICE_ICONS = [
  <svg key="l" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <rect x="4" y="4" width="16" height="11" rx="1.5" />
    <path d="M2 19h20" />
  </svg>,
  <svg key="t" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <rect x="2.5" y="5" width="19" height="14" rx="2.5" />
    <path d="M18.5 12h.01" />
  </svg>,
  <svg key="p" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <rect x="7" y="2.5" width="10" height="19" rx="2.5" />
    <path d="M11 18.5h2" />
  </svg>,
];

/** The same app on a laptop, a tablet and a phone at once. */
export function DeviceSuite() {
  const { lang } = useLanguage();
  const s = proContent[lang].suite;
  const roles = proContent[lang].roles;
  return (
    <section className="vp-sec vp-suite-sec" id="devices">
      <div className="vp-wrap">
        <div className="vp-head center ls-rv">
          <span className="vp-kick">{s.kick}</span>
          <h2 className="vp-h2">{s.title}</h2>
          <p className="vp-sub">{s.sub}</p>
        </div>
        <div className="vp-suite ls-rv" role="img" aria-label={s.title}>
          <span className="vp-suite-live">
            <span className="ls-ldot" />
            {s.live}
          </span>
          <Laptop className="vp-suite-laptop">
            <OwnerScreen />
          </Laptop>
          <Tablet className="vp-suite-tablet">
            <OfficeScreen />
          </Tablet>
          <Phone className="vp-suite-phone" sub={roles.find((r) => r.key === "sales")!.label}>
            <SalesScreen />
          </Phone>
        </div>
        <ul className="vp-suite-list ls-rv">
          {s.devices.map((d, k) => (
            <li key={d.t} style={{ "--i": k } as React.CSSProperties}>
              <span className="vp-suite-ic">{DEVICE_ICONS[k]}</span>
              <span>
                <b>{d.t}</b>
                <small>{d.d}</small>
              </span>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}

export function StatsBand() {
  const { lang } = useLanguage();
  const c = landingContent[lang];
  return (
    <section className="vp-stats ls-rv" aria-label={proContent[lang].statsKick}>
      <TrendLine className="vp-stats-trend" />
      <RouteHub className="vp-stats-hub" light />
      <div className="vp-wrap vp-stats-grid">
        {c.stats.map((s, i) => (
          <div className="vp-stat" key={i} style={{ "--i": i } as React.CSSProperties}>
            <CountUp to={s.n} from={s.from} suffix={s.suffix} className="vp-stat-n" duration={s.n > 10 ? 1600 : 1100} />
            <span className="vp-stat-l">{s.label}</span>
          </div>
        ))}
      </div>
    </section>
  );
}

export function FeatureGrid() {
  const { lang } = useLanguage();
  const g = proContent[lang].grid;
  return (
    <section className="vp-sec vp-soft" id="features">
      <div className="vp-wrap">
        <div className="vp-head center ls-rv">
          <span className="vp-kick">{g.kick}</span>
          <h2 className="vp-h2">{g.title}</h2>
          <p className="vp-sub">{g.sub}</p>
        </div>
        <div className="vp-grid ls-rv">
          {g.items.map((it, k) => (
            <article className="vp-gcard" key={it.t} data-tone={k % 4} style={{ "--i": k } as React.CSSProperties}>
              <Icon name={it.icon} className="vp-gcard-wm" />
              <span className="vp-gicon">
                <Icon name={it.icon} />
              </span>
              <h3>{it.t}</h3>
              <p>{it.d}</p>
            </article>
          ))}
        </div>
      </div>
    </section>
  );
}

export function StepsSection() {
  const { lang } = useLanguage();
  const c = landingContent[lang];
  const s = proContent[lang].steps;
  const steps = [
    { t: c.g1, d: c.g1d },
    { t: c.g2, d: c.g2d },
    { t: c.g3, d: c.g3d },
  ];
  return (
    <section className="vp-sec" id="how">
      <div className="vp-wrap">
        <div className="vp-head center ls-rv">
          <span className="vp-kick">{s.kick}</span>
          <h2 className="vp-h2">{s.title}</h2>
        </div>
        <ol className="vp-steps ls-rv">
          {steps.map((st, i) => (
            <li key={i} style={{ "--i": i } as React.CSSProperties}>
              <span className="vp-step-n">{i + 1}</span>
              <span className="vp-step-wm" aria-hidden="true">
                0{i + 1}
              </span>
              <h3>{st.t}</h3>
              <p>{st.d}</p>
            </li>
          ))}
        </ol>
      </div>
    </section>
  );
}

export function FaqSection() {
  const { lang } = useLanguage();
  const c = landingContent[lang];
  const [open, setOpen] = useState(0);
  return (
    <section className="vp-sec vp-soft" id="faq">
      <div className="vp-wrap vp-faq-wrap">
        <div className="vp-head ls-rv">
          <span className="vp-kick">{c.faqKick}</span>
          <h2 className="vp-h2">{c.faqTitle}</h2>
        </div>
        <div className="vp-faq">
          {c.faq.map((item, i) => (
            <div className={`vp-qa ls-rv ${i === open ? "open" : ""}`} key={i}>
              <button type="button" aria-expanded={i === open} aria-controls={`vp-faq-${i}`} onClick={() => setOpen(i === open ? -1 : i)}>
                <span>{item.q}</span>
                <span className="vp-qx" aria-hidden="true" />
              </button>
              <div className="vp-answ" id={`vp-faq-${i}`} role="region" aria-hidden={i !== open}>
                <p>{item.a}</p>
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

export function CtaBand() {
  const { lang } = useLanguage();
  const k = proContent[lang].cta;
  const c = landingContent[lang];
  return (
    <section className="vp-cta" id="demo">
      <div className="vp-cta-in ls-rv">
        <RouteHub className="vp-cta-hub" light />
        <Mark className="vp-cta-mark" light />
        <Dot className="vp-cta-dot" />
        <h2 className="vp-h2">{k.title}</h2>
        <p className="vp-sub">{k.sub}</p>
        <div className="vp-hero-cta">
          <Link href="/start" className="vp-btn vp-btn-solid vp-btn-lg">
            {k.primary}
            <Arrow />
          </Link>
          {WHATSAPP_NUMBER ? (
            <a href={`https://wa.me/${WHATSAPP_NUMBER}`} target="_blank" rel="noopener noreferrer" className="vp-btn vp-btn-ghost vp-btn-lg">
              {c.ctaWa}
            </a>
          ) : (
            <Link href="/login" className="vp-btn vp-btn-ghost vp-btn-lg">
              {k.secondary}
            </Link>
          )}
        </div>
      </div>
    </section>
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

export function ProFooter() {
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
