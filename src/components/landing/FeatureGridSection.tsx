"use client";

import { useState } from "react";
import { useLanguage } from "@/lib/i18n/LanguageProvider";
import { landingContent } from "@/lib/i18n/landing-content";

export default function FeatureGridSection() {
  const { lang } = useLanguage();
  const c = landingContent[lang];
  const [filter, setFilter] = useState<(typeof c.roleFilters)[number]["key"]>("all");

  const visible = filter === "all" ? c.features : c.features.filter((f) => f.role === filter);

  return (
    <section className="bg-background py-20">
      <div className="max-w-5xl mx-auto px-4">
        <div className="text-center mb-10">
          <p className="text-sm font-bold uppercase tracking-widest text-brand-dark">{c.featuresKicker}</p>
          <h2 className="mt-2 text-2xl sm:text-3xl font-bold [text-wrap:balance]">{c.featuresTitle}</h2>
        </div>

        <div className="flex flex-wrap justify-center gap-2 mb-10">
          {c.roleFilters.map((f) => (
            <button
              key={f.key}
              onClick={() => setFilter(f.key)}
              className={`rounded-full px-4 py-1.5 text-sm font-medium transition ${
                filter === f.key ? "bg-brand text-white" : "bg-black/5 text-foreground/60 hover:bg-black/10"
              }`}
            >
              {f.label}
            </button>
          ))}
        </div>

        <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-4">
          {visible.map((f) => (
            <div key={f.title} className="card p-5">
              <span className="text-2xl">{f.icon}</span>
              <h3 className="mt-3 font-semibold text-sm">{f.title}</h3>
              <p className="mt-1 text-sm text-foreground/60">{f.desc}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
