"use client";

/**
 * Small shared pieces for the platform console (us, not tenants): money and
 * date formatting in Indian style and time, status chips, a two-step
 * confirm button, and the signed-in role.
 */

import { createContext, useContext, useState } from "react";

export type PlatformRole = "OWNER" | "SUPPORT";

// ───────────────────────────── role ─────────────────────────────

const RoleContext = createContext<PlatformRole>("SUPPORT");

export function PlatformRoleProvider({ role, children }: { role: PlatformRole; children: React.ReactNode }) {
  return <RoleContext.Provider value={role}>{children}</RoleContext.Provider>;
}

/** True for the platform owner (OWNER-only actions are hidden for SUPPORT). */
export function useIsOwner() {
  return useContext(RoleContext) === "OWNER";
}

// ───────────────────────────── formatting ─────────────────────────────

/** Paise → "₹1,23,456" or "₹1,23,456.50" (Indian grouping). */
export function inr(p: number | null | undefined) {
  const v = (p ?? 0) / 100;
  const frac = Math.round(Math.abs(p ?? 0)) % 100 !== 0;
  return `₹${v.toLocaleString("en-IN", { minimumFractionDigits: frac ? 2 : 0, maximumFractionDigits: 2 })}`;
}

export const num = (n: number | null | undefined) => (n ?? 0).toLocaleString("en-IN");

/** ISO → date (and time) in India. Blank for null. */
export function when(iso: string | Date | null | undefined, withTime = false) {
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

/** ISO → "YYYY-MM-DDTHH:mm" in India time, for <input type="datetime-local">. */
export function isoToIst(iso: string | null | undefined) {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return new Date(d.getTime() + 330 * 60_000).toISOString().slice(0, 16);
}

/** "YYYY-MM-DDTHH:mm" typed as India time → ISO; blank → null. */
export function istToIso(v: string): string | null {
  if (!v) return null;
  const d = new Date(`${v}:00+05:30`);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

/** "3 days ago" style, for last activity. */
export function ago(iso: string | null | undefined) {
  if (!iso) return "never";
  const ms = Date.now() - new Date(iso).getTime();
  const m = Math.round(ms / 60_000);
  if (m < 1) return "just now";
  if (m < 60) return `${m} min ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h} hr ago`;
  const d = Math.round(h / 24);
  return `${d} day${d === 1 ? "" : "s"} ago`;
}

/** Rupee text → paise; blank → 0 when allowBlank; "bad" otherwise. */
export function toPaiseText(s: string, allowBlank = true): number | "bad" {
  const t = s.replace(/[,₹\s]/g, "");
  if (!t) return allowBlank ? 0 : "bad";
  const n = Number(t);
  if (!Number.isFinite(n) || n < 0) return "bad";
  return Math.round(n * 100);
}

export const paiseToText = (p: number | null | undefined) => (p ? String(p / 100) : "0");

// ───────────────────────────── chips ─────────────────────────────

const CHIP = "chip !py-0.5 !px-2 !text-[11.5px]";
const RED = "!bg-[var(--risk-tint)] !text-[var(--risk-text)] !border-transparent";

const TONES: Record<string, string> = {
  TRIAL: "chip-genda",
  ACTIVE: "chip-mint",
  SUSPENDED: RED,
  CLOSED: "",
  PAST_DUE: "chip-kesar",
  CANCELLED: "",
  ISSUED: "chip-genda",
  PAID: "chip-mint",
  VOID: "",
  QUEUED: "chip-genda",
  RUNNING: "chip-genda",
  READY: "chip-mint",
  FAILED: RED,
  EXPIRED: "",
  READ: "",
  WRITE: "chip-kesar",
  info: "",
  warning: "chip-genda",
};

const LABELS: Record<string, string> = {
  TRIAL: "Trial",
  ACTIVE: "Active",
  SUSPENDED: "Paused",
  CLOSED: "Closed",
  PAST_DUE: "Past due",
  CANCELLED: "Cancelled",
  ISSUED: "Unpaid",
  PAID: "Paid",
  VOID: "Void",
  QUEUED: "Queued",
  RUNNING: "Running",
  READY: "Ready",
  FAILED: "Failed",
  EXPIRED: "Expired",
  READ: "Read only",
  WRITE: "Can change",
  info: "Info",
  warning: "Warning",
};

export function StatusChip({ value, label, tone }: { value: string | null | undefined; label?: string; tone?: "red" | "mint" | "genda" | "kesar" }) {
  if (!value && !label) return <span className="text-[var(--muted)]">—</span>;
  const t = tone === "red" ? RED : tone ? `chip-${tone}` : TONES[value ?? ""] ?? "";
  return <span className={`${CHIP} ${t}`}>{label ?? LABELS[value ?? ""] ?? value}</span>;
}

// ───────────────────────────── confirm ─────────────────────────────

/**
 * A button that asks once more before doing something hard to undo. The
 * first click shows the question with "Yes" and "Cancel".
 */
export function ConfirmButton({
  label,
  question,
  yes = "Yes, do it",
  onConfirm,
  busy,
  disabled,
  danger = true,
  className = "btn btn-xs",
}: {
  label: React.ReactNode;
  question: string;
  yes?: string;
  onConfirm: () => void | Promise<void>;
  busy?: boolean;
  disabled?: boolean;
  danger?: boolean;
  className?: string;
}) {
  const [asking, setAsking] = useState(false);
  if (!asking) {
    return (
      <button type="button" className={`${className} ${danger ? "btn-danger" : "btn-quiet"}`} disabled={disabled || busy} onClick={() => setAsking(true)}>
        {label}
      </button>
    );
  }
  return (
    <span className="inline-flex flex-wrap items-center gap-2 rounded-xl bg-[var(--risk-tint)]/60 px-2.5 py-1.5">
      <span className="text-sm font-semibold text-[var(--risk-text)]">{question}</span>
      <button
        type="button"
        className="btn btn-xs btn-danger"
        disabled={busy}
        onClick={async () => {
          await onConfirm();
          setAsking(false);
        }}
      >
        {busy ? "Working…" : yes}
      </button>
      <button type="button" className="btn btn-xs btn-quiet" disabled={busy} onClick={() => setAsking(false)}>
        Cancel
      </button>
    </span>
  );
}

/** An error line under a form or action. */
export function ErrLine({ text }: { text: string | null }) {
  if (!text) return null;
  return <p className="text-sm text-[var(--risk-text)]">{text}</p>;
}

/** Card section with a heading. */
export function Section({ title, sub, children, right }: { title: string; sub?: React.ReactNode; children: React.ReactNode; right?: React.ReactNode }) {
  return (
    <section className="card p-4 sm:p-5 space-y-4 min-w-0">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="font-heading font-bold">{title}</p>
          {sub && <p className="text-sm text-[var(--muted)] mt-0.5">{sub}</p>}
        </div>
        {right}
      </div>
      {children}
    </section>
  );
}

/** Wide table that scrolls sideways on phones. */
export function TableWrap({ children, bleed = true }: { children: React.ReactNode; bleed?: boolean }) {
  return (
    <div className={`overflow-x-auto ${bleed ? "-mx-4 sm:mx-0" : ""}`}>
      <table className="w-full min-w-[640px] text-sm border-collapse [&_th]:text-left [&_th]:font-semibold [&_th]:text-xs [&_th]:text-[var(--muted)] [&_th]:px-3 [&_th]:py-2 [&_td]:px-3 [&_td]:py-2.5 [&_td]:align-top [&_tbody_tr]:border-t [&_tbody_tr]:border-[var(--line)]">
        {children}
      </table>
    </div>
  );
}
