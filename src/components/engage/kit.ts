"use client";

/** Small shared bits for the Phase 7 screens (bell, notifications, complaints). */

/** Fired after notifications are read here, so the bell refreshes its count straight away. */
export const NOTIFY_EVENT = "setu:notifications";

export const notifyChanged = () => {
  if (typeof window !== "undefined") window.dispatchEvent(new Event(NOTIFY_EVENT));
};

/** "3 min ago", "5 h ago", then a short date. */
export function ago(iso: string, now = Date.now()) {
  const s = Math.max(0, Math.round((now - new Date(iso).getTime()) / 1000));
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  if (s < 86_400) return `${Math.floor(s / 3600)} h ago`;
  if (s < 7 * 86_400) return `${Math.floor(s / 86_400)} d ago`;
  return new Date(iso).toLocaleDateString("en-IN", { day: "numeric", month: "short", timeZone: "Asia/Kolkata" });
}

export type TicketStatusKey = "OPEN" | "IN_PROGRESS" | "WAITING" | "RESOLVED" | "CLOSED";
/** STATUS_TEXT from lib/tickets (server-only module), handed to client screens by their page. */
export type StatusText = Record<TicketStatusKey, { en: string; hi: string }>;

export const STATUS_CHIP: Record<TicketStatusKey, string> = {
  OPEN: "chip-kesar",
  IN_PROGRESS: "chip-genda",
  WAITING: "chip-kesar",
  RESOLVED: "chip-mint",
  CLOSED: "",
};

export const capital = (s: string) => (s ? s[0].toUpperCase() + s.slice(1) : s);
