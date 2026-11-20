"use client";

/**
 * Small shared pieces for the owner's Phase 9 screens (set-up, brand, web
 * address, billing, your data): the upgrade note, status chips, money and
 * date helpers. Dates are always shown in Indian time.
 */

import Link from "next/link";
import Icon from "@/components/Icon";
import { formatINR } from "@/lib/money";

export const SMALL_CHIP = "chip !py-0.5 !px-2 !text-[11.5px]";

/** Paise → "₹2,499" (whole rupees) or "₹0.80". Indian digit grouping. */
export const inr = (p: number) => formatINR(p, { whole: p % 100 === 0 });

/** "21 Nov 2026" or "21 Nov 2026, 4:05 pm" in Indian time. */
export function istDate(iso: string | null | undefined, withTime = false) {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleString("en-IN", {
    day: "numeric",
    month: "short",
    year: "numeric",
    ...(withTime ? { hour: "numeric", minute: "2-digit" } : {}),
    timeZone: "Asia/Kolkata",
  });
}

/** Whole days from now until iso (0 when past). */
export function daysUntil(iso: string | null | undefined) {
  if (!iso) return 0;
  return Math.max(0, Math.ceil((new Date(iso).getTime() - Date.now()) / 86_400_000));
}

export const plural = (n: number, one: string, many = `${one}s`) => `${n.toLocaleString("en-IN")} ${n === 1 ? one : many}`;

/** 1536 → "1.5 KB". */
export function fileSize(bytes: number | null | undefined) {
  if (bytes === null || bytes === undefined) return "";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

/** "This is not in your plan" with a link to Billing. */
export function UpgradeNote({ title, children }: { title: string; children?: React.ReactNode }) {
  return (
    <div className="rounded-2xl border border-[var(--line)] bg-[var(--genda-tint)] p-4 flex items-start gap-3">
      <Icon name="lock" className="h-5 w-5 shrink-0 mt-0.5 text-[var(--genda-text)]" />
      <div className="min-w-0 text-sm">
        <p className="font-semibold text-ink">{title}</p>
        {children && <div className="text-[var(--ink-2)] mt-0.5">{children}</div>}
        <Link href="/admin/billing" className="btn btn-primary btn-sm mt-3">
          See plans
        </Link>
      </div>
    </div>
  );
}

/** An inline error line. */
export function ErrorLine({ text }: { text: string | null | undefined }) {
  if (!text) return null;
  return (
    <p role="alert" className="text-sm text-[#a8281e] flex items-start gap-1.5">
      <Icon name="alert" className="h-4 w-4 shrink-0 mt-0.5" /> <span className="min-w-0">{text}</span>
    </p>
  );
}

/** A thin progress bar; value and max are counts. */
export function Bar({ value, max, tone = "mor" }: { value: number; max: number; tone?: "mor" | "kesar" }) {
  const pct = max > 0 ? Math.min(100, Math.round((value / max) * 100)) : 0;
  return (
    <div className="h-2 rounded-full bg-ink/10 overflow-hidden" role="progressbar" aria-valuenow={value} aria-valuemin={0} aria-valuemax={max}>
      <div className={`h-full rounded-full ${tone === "kesar" ? "bg-kesar" : "bg-mor"}`} style={{ width: `${pct}%` }} />
    </div>
  );
}

/** Fetch JSON and keep the status, so a 402 (not in plan) or 423 (paused) can be told apart. */
export async function getJson<T>(url: string, init?: RequestInit): Promise<{ ok: true; data: T } | { ok: false; status: number; error: string; data: Record<string, unknown> }> {
  try {
    const res = await fetch(url, init);
    const data = await res.json().catch(() => ({}));
    if (!res.ok) return { ok: false, status: res.status, error: (data as { error?: string }).error ?? "Something went wrong", data };
    return { ok: true, data: data as T };
  } catch {
    return { ok: false, status: 0, error: "Could not reach the server. Check your internet and try again.", data: {} };
  }
}

export const jsonInit = (method: string, body?: unknown): RequestInit => ({
  method,
  headers: body === undefined ? undefined : { "Content-Type": "application/json" },
  body: body === undefined ? undefined : JSON.stringify(body),
});
