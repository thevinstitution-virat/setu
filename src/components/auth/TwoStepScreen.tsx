"use client";

import Link from "next/link";
import { useLanguage } from "@/lib/i18n/LanguageProvider";
import LanguageToggle from "@/components/LanguageToggle";
import { BrandLockup } from "@/components/BrandMark";
import TwoStepPanel from "@/components/auth/TwoStepPanel";

/** The full-page second step after signing in on a business address (/login/2fa). */
export default function TwoStepScreen({
  appName,
  logoUrl,
  mode,
  smsPhone,
}: {
  appName?: string;
  logoUrl: string | null;
  mode: "setup" | "verify";
  smsPhone: string | null;
}) {
  const { t } = useLanguage();
  return (
    <div className="min-h-screen flex flex-col items-center justify-center px-4 py-10">
      <div className="w-full max-w-sm">
        <div className="flex items-center justify-between gap-3 mb-8">
          <Link href="/" aria-label={appName ?? "Home"} className="min-w-0">
            <BrandLockup name={appName} logoUrl={logoUrl} large />
          </Link>
          <LanguageToggle />
        </div>
        <div className="card card-deco p-6 sm:p-7">
          <p className="page-kick">{t("mfa.kick")}</p>
          <h1 className="page-title">{mode === "setup" ? t("mfa.setupTitle") : t("mfa.title")}</h1>
          <p className="page-sub mb-6">{mode === "setup" ? t("mfa.setupSub") : t("mfa.sub")}</p>
          <TwoStepPanel endpoint="/api/auth/mfa" mode={mode} smsPhone={smsPhone} restartHref="/login" lostNote />
        </div>
        <p className="text-sm text-center mt-5">
          <a href="/login" className="text-[var(--ink-2)] hover:underline">
            {t("mfa.startOver")}
          </a>
        </p>
      </div>
    </div>
  );
}
