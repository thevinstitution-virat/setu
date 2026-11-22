"use client";

import { useEffect } from "react";
import { useLanguage } from "@/lib/i18n/LanguageProvider";
import { reportClientError } from "@/lib/error-report-client";

/**
 * Friendly page for an error inside any page (the root layout still renders).
 * Server errors arrive with a digest and were already reported by
 * instrumentation.ts, so only browser-side errors are reported here.
 */
export default function ErrorPage({ error, retry }: { error: unknown; retry: () => void }) {
  const { t } = useLanguage();
  const digest = typeof error === "object" && error !== null && "digest" in error ? String((error as { digest: unknown }).digest) : "";

  useEffect(() => {
    if (!digest) reportClientError(error, { kind: "error-boundary" });
  }, [error, digest]);

  return (
    <main className="min-h-[70vh] grid place-items-center px-4 py-10">
      <div className="card p-6 sm:p-8 max-w-md w-full text-center">
        <h1 className="page-title">{t("error.title")}</h1>
        <p className="page-sub mt-2">{t("error.body")}</p>
        <div className="mt-6 flex flex-col sm:flex-row gap-3 justify-center">
          <button type="button" className="btn btn-kesar" onClick={() => retry()}>
            {t("error.retry")}
          </button>
          {/* A full page load on purpose: the app's own navigation may be what broke. */}
          {/* eslint-disable-next-line @next/next/no-html-link-for-pages */}
          <a href="/" className="btn btn-outline">
            {t("error.home")}
          </a>
        </div>
        {digest && (
          <p className="mt-5 text-xs text-[var(--muted)]">
            {t("error.ref")}: <span className="font-mono">{digest}</span>
          </p>
        )}
      </div>
    </main>
  );
}
