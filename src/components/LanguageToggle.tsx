"use client";

import { useLanguage } from "@/lib/i18n/LanguageProvider";

export default function LanguageToggle() {
  const { lang, setLang } = useLanguage();

  return (
    <div
      className="inline-flex rounded-xl p-[3px] text-xs font-bold bg-white/60 border border-ink/10"
      role="group"
      aria-label="Language"
    >
      <button
        type="button"
        onClick={() => setLang("en")}
        aria-pressed={lang === "en"}
        className={`px-2.5 py-1 rounded-lg transition ${
          lang === "en" ? "bg-gradient-to-br from-mor to-[#0c3634] text-white" : "text-ink-2"
        }`}
      >
        EN
      </button>
      <button
        type="button"
        onClick={() => setLang("hi")}
        aria-pressed={lang === "hi"}
        className={`px-2.5 py-1 rounded-lg transition ${
          lang === "hi" ? "bg-gradient-to-br from-mor to-[#0c3634] text-white" : "text-ink-2"
        }`}
      >
        हिं
      </button>
    </div>
  );
}
