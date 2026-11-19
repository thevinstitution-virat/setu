"use client";

import { createContext, useContext, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { dictionary, type Lang, type DictKey } from "./dictionary";

type Ctx = { lang: Lang; setLang: (l: Lang) => void; t: (key: DictKey) => string };

const LanguageContext = createContext<Ctx | null>(null);

export function LanguageProvider({
  children,
  initialLang = "en",
}: {
  children: React.ReactNode;
  initialLang?: Lang;
}) {
  const [lang, setLangState] = useState<Lang>(initialLang);
  const router = useRouter();

  useEffect(() => {
    try {
      const saved = localStorage.getItem("setu-lang");
      if ((saved === "en" || saved === "hi") && saved !== initialLang) {
        setLangState(saved);
      }
      if (saved === "en" || saved === "hi") {
        document.cookie = `setu-lang=${saved}; path=/; max-age=31536000`;
      }
    } catch {}
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function setLang(l: Lang) {
    setLangState(l);
    try {
      localStorage.setItem("setu-lang", l);
      document.cookie = `setu-lang=${l}; path=/; max-age=31536000`;
    } catch {}
    // Messages (WhatsApp, SMS, push) follow the language picked here. Signed out: nothing to save.
    fetch("/api/notifications/prefs", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ lang: l }),
    }).catch(() => {});
    router.refresh();
  }

  function t(key: DictKey) {
    return dictionary[key]?.[lang] ?? key;
  }

  return (
    <LanguageContext.Provider value={{ lang, setLang, t }}>{children}</LanguageContext.Provider>
  );
}

export function useLanguage() {
  const ctx = useContext(LanguageContext);
  if (!ctx) throw new Error("useLanguage must be used within LanguageProvider");
  return ctx;
}
