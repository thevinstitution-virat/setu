"use client";

import { useLanguage } from "@/lib/i18n/LanguageProvider";
import { landingContent } from "@/lib/i18n/landing-content";

export default function BuiltForStrip() {
  const { lang } = useLanguage();
  const c = landingContent[lang];

  const items = [
    { label: c.bf1, path: "M3 21V8l9-5 9 5v13M7 21v-8h10v8" },
    { label: c.bf2, path: "M21 8l-9-5-9 5v8l9 5 9-5zM3 8l9 5 9-5M12 13v8" },
    { label: c.bf3, path: "M4 10v10h16V10M3 10l2-6h14l2 6zM9 20v-5h6v5" },
    { label: c.bf4, path: "M3 6h11v10H3zM14 9h4l3 3v4h-7" },
    { label: c.tick2, path: "M12 3l8 3v6c0 4.5-3.4 8.3-8 9-4.6-.7-8-4.5-8-9V6zM9 12l2 2 4-4" },
    { label: c.tick3, path: "M6 4h12M6 9h12M14 20L7 13h3a4 4 0 0 0 0-9" },
  ];

  const row = (hidden: boolean) => (
    <ul aria-hidden={hidden || undefined}>
      {items.map((it) => (
        <li key={it.label}>
          <svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d={it.path} />
          </svg>
          {it.label}
        </li>
      ))}
    </ul>
  );

  return (
    <div className="ls-strip">
      <span className="ls-strip-lbl">{c.builtFor}</span>
      <div className="ls-marq">
        <div className="ls-marq-track">
          {row(false)}
          {row(true)}
        </div>
      </div>
    </div>
  );
}
