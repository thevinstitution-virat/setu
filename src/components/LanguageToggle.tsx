"use client";

import { useLanguage } from "@/lib/i18n/LanguageProvider";

export default function LanguageToggle() {
  const { lang, setLang } = useLanguage();

  return (
    <div
      className="inline-flex shrink-0 rounded-[10px] p-[3px] text-xs font-bold bg-[#eef2f1]"
      role="group"
      aria-label="Language"
    >
      <button
        type="button"
        onClick={() => setLang("en")}
        aria-pressed={lang === "en"}
        className={`min-w-9 h-8 px-2 rounded-[8px] transition ${
          lang === "en" ? "bg-white text-ink shadow-[0_1px_2px_rgba(15,42,42,.14)]" : "text-ink-2 hover:text-ink"
        }`}
      >
        EN
      </button>
      <button
        type="button"
        onClick={() => setLang("hi")}
        aria-pressed={lang === "hi"}
        className={`min-w-9 h-8 px-2 rounded-[8px] transition ${
          lang === "hi" ? "bg-white text-ink shadow-[0_1px_2px_rgba(15,42,42,.14)]" : "text-ink-2 hover:text-ink"
        }`}
      >
        हिं
      </button>
    </div>
  );
}
