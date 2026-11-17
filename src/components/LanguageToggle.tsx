"use client";

import { useLanguage } from "@/lib/i18n/LanguageProvider";

export default function LanguageToggle() {
  const { lang, setLang } = useLanguage();

  return (
    <div className="flex rounded-lg bg-black/5 p-0.5 text-xs font-medium">
      <button
        onClick={() => setLang("en")}
        className={`px-2 py-1 rounded-md transition ${
          lang === "en" ? "bg-white shadow text-brand-dark" : "text-foreground/50"
        }`}
      >
        EN
      </button>
      <button
        onClick={() => setLang("hi")}
        className={`px-2 py-1 rounded-md transition ${
          lang === "hi" ? "bg-white shadow text-brand-dark" : "text-foreground/50"
        }`}
      >
        हिं
      </button>
    </div>
  );
}
