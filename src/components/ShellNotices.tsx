"use client";

import { useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useLanguage } from "@/lib/i18n/LanguageProvider";
import Icon from "@/components/Icon";
import type { Chrome } from "@/lib/chrome";

/** Pages a paused business's owner can still open. */
const PAUSED_PAGES = ["/admin/billing", "/admin/account"];
const under = (path: string, prefix: string) => path === prefix || path.startsWith(`${prefix}/`);

const fmtDate = (iso: string) => new Date(iso).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric", timeZone: "Asia/Kolkata" });

/**
 * Banners above every page (Phase 9): a support session in progress,
 * platform announcements, the trial / bill / pause / deletion notice. Then
 * either the page, or a card in its place when the business is paused or the
 * page's module is not in the plan.
 */
export default function ShellNotices({ chrome, isOffice, children }: { chrome: Chrome; isOffice: boolean; children: React.ReactNode }) {
  const pathname = usePathname();
  const { t } = useLanguage();
  const [hidden, setHidden] = useState<string[]>([]);

  const paused = chrome.notice?.kind === "paused" && !PAUSED_PAGES.some((p) => under(pathname, p));
  const locked = chrome.lockedPages.find((l) => under(pathname, l.prefix));

  return (
    <>
      {chrome.support && <SupportBanner support={chrome.support} />}

      {chrome.announcements
        .filter((a) => !hidden.includes(a.id))
        .map((a) => (
          <div
            key={a.id}
            role="status"
            className={`mb-4 flex items-start gap-3 rounded-2xl border px-4 py-3 text-sm ${
              a.level === "warning" ? "border-[#e8b27a] bg-[#fff4e6] text-[#7a3d06]" : "border-[var(--line)] bg-white/70 text-[var(--ink-2)]"
            }`}
          >
            <Icon name={a.level === "warning" ? "alert" : "megaphone"} className="h-5 w-5 shrink-0 mt-0.5" />
            <div className="min-w-0 flex-1">
              <p className="font-bold text-ink">{a.title}</p>
              <p className="whitespace-pre-line">{a.body}</p>
            </div>
            <button className="btn btn-quiet btn-xs" aria-label="Hide" onClick={() => setHidden((h) => [...h, a.id])}>
              <Icon name="x" className="h-4 w-4" />
            </button>
          </div>
        ))}

      {chrome.notice && <Notice notice={chrome.notice} />}

      {paused ? (
        <section className="card p-6 max-w-xl">
          <div className="flex items-center gap-3 mb-2">
            <Icon name="lock" className="h-6 w-6 text-[var(--accent-text)]" />
            <h1 className="font-heading text-xl font-bold">{t("shell.paused")}</h1>
          </div>
          {chrome.notice?.kind === "paused" && chrome.notice.reason && !chrome.notice.reason.startsWith("billing:") && (
            <p className="text-sm text-[var(--ink-2)] mb-2">{chrome.notice.reason}</p>
          )}
          <p className="text-sm text-[var(--ink-2)] mb-4">{t("shell.pausedBody")}</p>
          <div className="flex flex-wrap gap-2">
            <Link href="/admin/billing" className="btn btn-primary">{t("nav.billing")}</Link>
            <Link href="/admin/account" className="btn btn-quiet">Your data</Link>
          </div>
        </section>
      ) : locked ? (
        <section className="card p-6 max-w-xl">
          <div className="flex items-center gap-3 mb-2">
            <Icon name="lock" className="h-6 w-6 text-[var(--accent-text)]" />
            <h1 className="font-heading text-xl font-bold">{t("shell.notInPlan")}</h1>
          </div>
          <p className="font-semibold mb-1">{locked.label}</p>
          <p className="text-sm text-[var(--ink-2)] mb-4">{isOffice ? t("shell.upgradeBody") : t("shell.askOwner")}</p>
          {isOffice && <Link href="/admin/billing" className="btn btn-primary">{t("shell.seePlans")}</Link>}
        </section>
      ) : (
        children
      )}
    </>
  );
}

function Notice({ notice }: { notice: NonNullable<Chrome["notice"]> }) {
  const { t } = useLanguage();
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (notice.kind === "paused") return null; // the page card says it

  async function keep() {
    setBusy(true);
    setError(null);
    const res = await fetch("/api/admin/account", { method: "DELETE" });
    setBusy(false);
    if (!res.ok) {
      setError((await res.json().catch(() => ({}))).error ?? "Could not cancel. Try again.");
      return;
    }
    router.refresh();
  }

  const box = "mb-4 flex flex-wrap items-center gap-3 rounded-2xl border px-4 py-3 text-sm";
  if (notice.kind === "trial") {
    return (
      <div className={`${box} border-[var(--line)] bg-[var(--accent-tint)] text-[var(--accent-text)]`} role="status">
        <Icon name="clock" className="h-5 w-5 shrink-0" />
        <p className="flex-1 min-w-0 font-semibold">
          {t("shell.trial")}: {notice.daysLeft} {t("shell.daysLeft")} ({fmtDate(notice.endsAt)})
        </p>
        {!notice.planPicked && (
          <Link href="/admin/billing" className="btn btn-primary btn-xs">{t("shell.pickPlan")}</Link>
        )}
      </div>
    );
  }
  if (notice.kind === "past_due") {
    return (
      <div className={`${box} border-[#e8b27a] bg-[#fff4e6] text-[#7a3d06]`} role="alert">
        <Icon name="alert" className="h-5 w-5 shrink-0" />
        <p className="flex-1 min-w-0 font-semibold">{notice.message}</p>
        <Link href="/admin/billing" className="btn btn-primary btn-xs">{t("shell.payNow")}</Link>
      </div>
    );
  }
  return (
    <div className={`${box} border-[#e0a49d] bg-[#fdeeee] text-[#8a1f15]`} role="alert">
      <Icon name="trash" className="h-5 w-5 shrink-0" />
      <p className="flex-1 min-w-0 font-semibold">
        {t("shell.deleting")} {fmtDate(notice.deleteAfter)}.
      </p>
      {error && <p className="w-full text-xs">{error}</p>}
      <button className="btn btn-primary btn-xs" disabled={busy} onClick={keep}>{t("shell.keepIt")}</button>
    </div>
  );
}

function SupportBanner({ support }: { support: NonNullable<Chrome["support"]> }) {
  const { t } = useLanguage();
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  async function end() {
    setBusy(true);
    await fetch("/api/auth/support/end", { method: "POST" }).catch(() => null);
    router.push("/login");
    router.refresh();
  }
  return (
    <div className="mb-4 flex flex-wrap items-center gap-3 rounded-2xl border border-[#9cc3e6] bg-[#eef6fd] px-4 py-3 text-sm text-[#123f66]" role="status">
      <Icon name="eye" className="h-5 w-5 shrink-0" />
      <p className="flex-1 min-w-0">
        <span className="font-bold">{t("shell.support")}</span> ({support.mode === "READ" ? t("shell.readOnly") : t("shell.canChange")}) · {support.reason} ·
        until {new Date(support.expiresAt).toLocaleTimeString("en-IN", { hour: "numeric", minute: "2-digit", timeZone: "Asia/Kolkata" })}
      </p>
      <button className="btn btn-quiet btn-xs" disabled={busy} onClick={end}>{t("shell.endSupport")}</button>
    </div>
  );
}
