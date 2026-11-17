"use client";

import { useLanguage } from "@/lib/i18n/LanguageProvider";
import { landingContent } from "@/lib/i18n/landing-content";

export default function BilingualDemoSection() {
  const { lang, setLang } = useLanguage();
  const en = landingContent.en;
  const hi = landingContent.hi;

  return (
    <section className="bg-ink text-white py-20">
      <div className="max-w-3xl mx-auto px-4 text-center">
        <p className="text-sm font-bold uppercase tracking-widest text-gold">{landingContent[lang].bilingualKicker}</p>
        <h2 className="mt-2 text-2xl sm:text-3xl font-bold [text-wrap:balance]">
          {landingContent[lang].bilingualTitle}
        </h2>
        <p className="mt-3 text-white/60 max-w-lg mx-auto">{landingContent[lang].bilingualSub}</p>

        <div className="mt-10 grid sm:grid-cols-2 gap-4">
          <button
            onClick={() => setLang("en")}
            className={`text-left rounded-2xl border p-5 transition ${
              lang === "en" ? "border-gold bg-white/[0.06] scale-[1.02]" : "border-white/10 bg-white/[0.02] opacity-60"
            }`}
          >
            <p className="text-xs font-semibold text-white/40 mb-3">English</p>
            <p className="text-sm text-white/70">{en.bilingualCardBody}</p>
            <span className="inline-block mt-3 text-xs font-medium px-2 py-1 rounded-full bg-purple-400/20 text-purple-200">
              {en.bilingualCardStatus}
            </span>
          </button>
          <button
            onClick={() => setLang("hi")}
            className={`text-left rounded-2xl border p-5 transition ${
              lang === "hi" ? "border-gold bg-white/[0.06] scale-[1.02]" : "border-white/10 bg-white/[0.02] opacity-60"
            }`}
          >
            <p className="text-xs font-semibold text-white/40 mb-3" style={{ fontFamily: "var(--font-deva)" }}>
              हिंदी
            </p>
            <p className="text-sm text-white/70" style={{ fontFamily: "var(--font-deva)" }}>
              {hi.bilingualCardBody}
            </p>
            <span
              className="inline-block mt-3 text-xs font-medium px-2 py-1 rounded-full bg-purple-400/20 text-purple-200"
              style={{ fontFamily: "var(--font-deva)" }}
            >
              {hi.bilingualCardStatus}
            </span>
          </button>
        </div>
        <p className="mt-5 text-xs text-white/40">
          {lang === "en" ? "Tap a card to switch the whole app." : "पूरा ऐप बदलने के लिए किसी कार्ड पर टैप करें।"}
        </p>
      </div>
    </section>
  );
}
