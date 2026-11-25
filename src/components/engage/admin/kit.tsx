"use client";

/**
 * Shared bits for the office's complaints and engage screens (Phase 7):
 * the Engage sub-navigation, ticket status words, SLA "time left" text and
 * small formatting helpers.
 */

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { FEEDBACK_TAGS, TICKET_CATEGORIES, TICKET_NEXT } from "@/lib/engage-settings";

const LINKS = [
  { href: "/admin/engage", label: "Overview" },
  { href: "/admin/engage/announcements", label: "Announcements" },
  { href: "/admin/engage/ratings", label: "Ratings" },
  { href: "/admin/engage/referrals", label: "Referrals" },
  { href: "/admin/engage/messages", label: "Message log" },
  { href: "/admin/engage/wording", label: "Wording" },
] as const;

export function EngageNav() {
  const path = usePathname();
  const active = (href: string) => (href === "/admin/engage" ? path === href : path === href || path.startsWith(`${href}/`));
  return (
    <nav aria-label="Engage" className="-mx-4 overflow-x-auto px-4 sm:mx-0 sm:px-0">
      <ul className="flex w-max gap-1.5 pb-1">
        {LINKS.map((l) => (
          <li key={l.href}>
            <Link
              href={l.href}
              aria-current={active(l.href) ? "page" : undefined}
              className={`inline-flex h-9 items-center whitespace-nowrap rounded-full border px-3.5 text-sm font-medium transition-colors ${
                active(l.href) ? "border-[var(--kesar)] bg-[var(--kesar)] text-white" : "border-foreground/15 bg-white/60 text-foreground/75 hover:bg-white"
              }`}
            >
              {l.label}
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  );
}

/** Round pill filter row (same look as Stock's filters). */
export function Pills<K extends string>({
  items,
  value,
  onChange,
  label,
}: {
  items: readonly { key: K; label: string; count?: number | null; alert?: boolean }[];
  value: K;
  onChange: (k: K) => void;
  label: string;
}) {
  return (
    <div className="-mx-4 overflow-x-auto px-4 sm:mx-0 sm:px-0">
      <div className="flex w-max gap-1.5 pb-1" role="tablist" aria-label={label}>
        {items.map((f) => {
          const on = value === f.key;
          return (
            <button
              key={f.key}
              type="button"
              role="tab"
              aria-selected={on}
              onClick={() => onChange(f.key)}
              className={`inline-flex h-10 items-center gap-1.5 whitespace-nowrap rounded-full border px-3.5 text-sm font-semibold transition-colors ${
                on ? "border-[var(--mor)] bg-[var(--mor)] text-white" : "border-foreground/15 bg-white/60 text-foreground/75 hover:bg-white"
              }`}
            >
              {f.label}
              {typeof f.count === "number" && (
                <span
                  className={`text-xs ${
                    f.alert && f.count > 0 ? (on ? "rounded-full bg-white/20 px-1.5 text-white" : "rounded-full bg-[var(--risk-tint)] px-1.5 text-[var(--risk-text)]") : on ? "text-white/75" : "text-[var(--muted)]"
                  }`}
                >
                  {f.count}
                </span>
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}

export const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/** A clock that ticks every minute (for "time left" text). */
export function useNow(everyMs = 60_000) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), everyMs);
    return () => clearInterval(t);
  }, [everyMs]);
  return now;
}

/** 95 minutes → "1 h 35 min"; 50 hours → "2 days 2 h". */
export function spanText(ms: number) {
  const mins = Math.max(0, Math.round(Math.abs(ms) / 60_000));
  if (mins < 60) return `${mins} min`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) {
    const m = mins % 60;
    return m ? `${hours} h ${m} min` : `${hours} h`;
  }
  const days = Math.floor(hours / 24);
  const h = hours % 24;
  return h ? `${plural(days, "day")} ${h} h` : plural(days, "day");
}

/** "5 min ago", "3 h ago", "2 days ago". */
export function ago(iso: string, now: number) {
  const ms = now - new Date(iso).getTime();
  if (ms < 60_000) return "just now";
  return `${spanText(ms)} ago`;
}

// ───────────────────────────── complaints ─────────────────────────────

export type TicketStatus = "OPEN" | "IN_PROGRESS" | "WAITING" | "RESOLVED" | "CLOSED";

export const STATUS: Record<TicketStatus, { label: string; chip: string }> = {
  OPEN: { label: "Open", chip: "chip-kesar" },
  IN_PROGRESS: { label: "In progress", chip: "chip-mor" },
  WAITING: { label: "Waiting for shop", chip: "chip-genda" },
  RESOLVED: { label: "Resolved", chip: "chip-mint" },
  CLOSED: { label: "Closed", chip: "" },
};

export const statusLabel = (s: string) => STATUS[s as TicketStatus]?.label ?? s;

/** The moves the server allows (shared with src/lib/tickets.ts). */
export const NEXT: Record<TicketStatus, TicketStatus[]> = TICKET_NEXT;

export const categoryLabel = (c: string) => (TICKET_CATEGORIES as Record<string, { label: string }>)[c]?.label ?? c;
export const tagLabel = (t: string) => (FEEDBACK_TAGS as Record<string, { label: string }>)[t]?.label ?? t;
export const tagGood = (t: string) => (FEEDBACK_TAGS as Record<string, { good: boolean }>)[t]?.good ?? true;

export const isOpenStatus = (s: string) => s === "OPEN" || s === "IN_PROGRESS" || s === "WAITING";

export function StatusChip({ status }: { status: string }) {
  const s = STATUS[status as TicketStatus];
  return <span className={`chip !py-0.5 !px-2 !text-[11.5px] whitespace-nowrap ${s?.chip ?? ""}`}>{s?.label ?? status}</span>;
}

/** SLA text for an open complaint: "4 h left" or "Overdue by 2 h". */
export function SlaText({ status, slaDueAt, now, className = "" }: { status: string; slaDueAt: string; now: number; className?: string }) {
  if (!isOpenStatus(status)) return null;
  const left = new Date(slaDueAt).getTime() - now;
  if (left < 0) {
    return <span className={`font-bold text-[var(--risk-text)] whitespace-nowrap ${className}`}>Overdue by {spanText(left)}</span>;
  }
  const soon = left < 4 * 3600_000;
  return <span className={`whitespace-nowrap ${soon ? "font-bold text-[var(--scheme-text)]" : "text-[var(--ink-2)]"} ${className}`}>{spanText(left)} left</span>;
}

export function Stars({ value, className = "" }: { value: number; className?: string }) {
  const full = Math.round(value);
  return (
    <span className={`whitespace-nowrap tracking-tight ${className}`} aria-label={`${value} out of 5 stars`}>
      <span className="text-[var(--genda)]">{"★".repeat(full)}</span>
      <span className="text-black/15">{"★".repeat(Math.max(0, 5 - full))}</span>
    </span>
  );
}
