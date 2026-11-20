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
import { ProLogo } from "./ProNav";
import { Phone, RetailerScreen, Toast } from "./ProHero";

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
          <Phone>
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

export function StatsBand() {
  const { lang } = useLanguage();
  const c = landingContent[lang];
  return (
    <section className="vp-stats" aria-label={proContent[lang].statsKick}>
      <div className="vp-wrap vp-stats-grid">
        {c.stats.map((s, i) => (
          <div className="vp-stat ls-rv" key={i} style={{ "--i": i } as React.CSSProperties}>
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
            <article className="vp-gcard" key={it.t} style={{ "--i": k } as React.CSSProperties}>
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

export function ProFooter() {
  const { lang } = useLanguage();
  const c = landingContent[lang];
  const p = proContent[lang];
  return (
    <footer className="vp-foot">
      <div className="vp-wrap vp-foot-grid">
        <div className="vp-foot-brand">
          <ProLogo />
          <p>{c.footTag}</p>
          <LanguageToggle />
        </div>
        <nav aria-label={c.footExplore}>
          <h3>{c.footExplore}</h3>
          <a href="#product">{p.nav.features}</a>
          <a href="#solutions">{p.nav.problems}</a>
          <a href="#features">{p.grid.kick}</a>
          <a href="#how">{p.nav.how}</a>
        </nav>
        <nav aria-label={c.footStart}>
          <h3>{c.footStart}</h3>
          <Link href="/start">{p.hero.cta1}</Link>
          <Link href="/login">{c.signIn}</Link>
          <a href="#faq">{p.nav.faq}</a>
        </nav>
        {(WHATSAPP_NUMBER || CONTACT_EMAIL) && (
          <nav aria-label={c.footTalk}>
            <h3>{c.footTalk}</h3>
            {WHATSAPP_NUMBER && (
              <a href={`https://wa.me/${WHATSAPP_NUMBER}`} target="_blank" rel="noopener noreferrer">
                {c.ctaWa}
              </a>
            )}
            {CONTACT_EMAIL && <a href={`mailto:${CONTACT_EMAIL}`}>{c.footEmail}</a>}
          </nav>
        )}
      </div>
      <div className="vp-wrap vp-foot-bar">
        <span>
          © {new Date().getFullYear()} {c.footProduct}
        </span>
        <span className="vp-foot-links">
          <a href="https://vgraphics.in" target="_blank" rel="noopener noreferrer">
            {c.footDesign}
          </a>
          <a href="/legal/terms">Terms</a>
          <a href="/legal/privacy">Privacy</a>
        </span>
      </div>
    </footer>
  );
}
