"use client";

/**
 * Shared bits for the supervisor's /team screens: API JSON types, text
 * helpers (IST times, km, hours, ₹), day and month pickers, a progress bar
 * and summary tiles.
 */

import Icon from "@/components/Icon";
import { formatINR } from "@/lib/money";
import { addDay } from "@/lib/field-math";
import { EXCEPTION_LABEL, type ExceptionKind } from "@/lib/field-settings";

// ───────────────────────────── API types ─────────────────────────────

export type Member = { id: string; name: string; role: string; phone: string | null; supervisorId: string | null; salesAgentId: string | null };

export type TodayMember = {
  userId: string;
  name: string;
  role: string;
  phone: string | null;
  attendance: {
    checkInAt: string | null;
    checkOutAt: string | null;
    late: boolean;
    minutes: number | null;
    checkInSelfie: string | null;
    checkOutSelfie: string | null;
    checkInLat: number | null;
    checkInLng: number | null;
  } | null;
  onLeave: boolean;
  lastPosition: { lat: number; lng: number; at: string; accuracy: number | null } | null;
  distanceM: number | null;
  visits: number;
  noOrder: number;
  orders: number;
  orderValue: number;
  collected: number;
  beat: { name: string; planned: number; covered: number } | null;
  exceptions: ExceptionKind[];
};

export type TeamToday = {
  date: string;
  settings: { trackLocation: boolean; workStart: string; visitRadiusM: number };
  members: TodayMember[];
};

export type AttendanceRow = {
  id: string;
  userId: string;
  date: string;
  checkInAt: string | null;
  checkInLat: number | null;
  checkInLng: number | null;
  checkInAccuracy: number | null;
  checkInSelfie: string | null;
  checkOutAt: string | null;
  checkOutLat: number | null;
  checkOutLng: number | null;
  checkOutAccuracy: number | null;
  checkOutSelfie: string | null;
  minutes: number | null;
  distanceM: number | null;
  late: boolean;
};

export type Track = {
  user: { name: string; role: string };
  date: string;
  attendance: AttendanceRow | null;
  pings: { at: string; lat: number; lng: number; accuracy: number | null; battery: number | null }[];
  visits: {
    id: string;
    checkInAt: string;
    checkOutAt: string | null;
    checkInLat: number | null;
    checkInLng: number | null;
    outcome: "ORDER" | "NO_ORDER" | null;
    noOrderReason: string | null;
    distanceM: number | null;
    offBeat: boolean;
    retailer: { outletName: string; lat: number | null; lng: number | null };
    order: { orderNumber: string; totalAmount: number } | null;
  }[];
  distanceM: number | null;
  /** All orders they placed that day (on a visit or not), and money they collected. */
  orders: number;
  orderValue: number;
  collected: number;
};

// ───────────────────────────── text ─────────────────────────────

export const ROLE_LABEL: Record<string, string> = {
  SALES_AGENT: "Sales",
  DELIVERY_AGENT: "Delivery",
  SUPERVISOR: "Supervisor",
  ADMIN: "Admin",
};

export const roleText = (r: string) => ROLE_LABEL[r] ?? r;

export const plural = (n: number, w: string, many = `${w}s`) => `${n} ${n === 1 ? w : many}`;

/** "9:42 am" in IST. */
export function timeText(iso: string | null | undefined) {
  if (!iso) return "";
  return new Date(iso).toLocaleTimeString("en-IN", { hour: "numeric", minute: "2-digit", timeZone: "Asia/Kolkata" });
}

/** 445 → "7h 25m". */
export function hoursText(min: number | null | undefined) {
  if (min == null) return "—";
  const h = Math.floor(min / 60);
  const m = Math.round(min % 60);
  return h ? `${h}h ${m}m` : `${m}m`;
}

export const kmText = (m: number | null | undefined) => (m == null ? "—" : `${(m / 1000).toFixed(1)} km`);

export const rupees = (p: number) => formatINR(p, { whole: true });

/** "Thu, 19 Nov" (UTC maths on a YYYY-MM-DD, so no time-zone drift). */
export function dayLabel(ymd: string, withYear = false) {
  return new Date(`${ymd}T00:00:00.000Z`).toLocaleDateString("en-IN", {
    weekday: "short",
    day: "numeric",
    month: "short",
    ...(withYear ? { year: "numeric" } : {}),
    timeZone: "UTC",
  });
}

/** "19 Nov" */
export function shortDay(ymd: string) {
  return new Date(`${ymd}T00:00:00.000Z`).toLocaleDateString("en-IN", { day: "numeric", month: "short", timeZone: "UTC" });
}

/** "November 2026" */
export function monthLabel(ym: string) {
  return new Date(`${ym}-01T00:00:00.000Z`).toLocaleDateString("en-IN", { month: "long", year: "numeric", timeZone: "UTC" });
}

export function addMonth(ym: string, n: number) {
  const [y, m] = ym.split("-").map(Number);
  const d = new Date(Date.UTC(y, m - 1 + n, 1));
  return d.toISOString().slice(0, 7);
}

export const mapsUrl = (lat: number, lng: number) => `https://www.google.com/maps/search/?api=1&query=${lat},${lng}`;

export const YMD = /^\d{4}-\d{2}-\d{2}$/;
export const YM = /^\d{4}-(0[1-9]|1[0-2])$/;

/** Change the address bar (no navigation) so a reload or share keeps the view. */
export function setQuery(path: string) {
  try {
    window.history.replaceState(null, "", path);
  } catch {
    /* address bar only */
  }
}

export const errorText = "text-sm text-[var(--risk-text)]";

// ───────────────────────────── pickers ─────────────────────────────

export function DayPicker({
  date,
  today,
  onChange,
  noFuture,
}: {
  date: string;
  today: string;
  onChange: (d: string) => void;
  noFuture?: boolean;
}) {
  return (
    <div className="card p-3 flex flex-wrap items-center gap-2 sm:max-w-md">
      <div className="flex items-center gap-1.5 flex-1 min-w-0">
        <button
          type="button"
          className="btn btn-quiet btn-sm !px-3 !min-h-[44px] shrink-0"
          aria-label="Previous day"
          onClick={() => onChange(addDay(date, -1))}
        >
          <Icon name="chevronLeft" className="h-4 w-4" />
        </button>
        <input
          className="input min-w-0 flex-1"
          type="date"
          aria-label="Day"
          value={date}
          max={noFuture ? today : undefined}
          onChange={(e) => YMD.test(e.target.value) && (!noFuture || e.target.value <= today) && onChange(e.target.value)}
        />
        <button
          type="button"
          className="btn btn-quiet btn-sm !px-3 !min-h-[44px] shrink-0"
          aria-label="Next day"
          disabled={noFuture && date >= today}
          onClick={() => onChange(addDay(date, 1))}
        >
          <Icon name="chevronRight" className="h-4 w-4" />
        </button>
      </div>
      {date !== today && (
        <button type="button" className="btn btn-quiet btn-xs !min-h-[44px]" onClick={() => onChange(today)}>
          Today
        </button>
      )}
      <p className="w-full text-xs text-[var(--muted)]">{date === today ? `Today, ${dayLabel(date, true)}` : dayLabel(date, true)}</p>
    </div>
  );
}

export function MonthPicker({ month, onChange }: { month: string; onChange: (m: string) => void }) {
  return (
    <div className="card p-3 flex items-center gap-1.5 sm:max-w-md">
      <button
        type="button"
        className="btn btn-quiet btn-sm !px-3 !min-h-[44px] shrink-0"
        aria-label="Previous month"
        onClick={() => onChange(addMonth(month, -1))}
      >
        <Icon name="chevronLeft" className="h-4 w-4" />
      </button>
      <input
        className="input min-w-0 flex-1"
        type="month"
        aria-label="Month"
        value={month}
        onChange={(e) => YM.test(e.target.value) && onChange(e.target.value)}
      />
      <button
        type="button"
        className="btn btn-quiet btn-sm !px-3 !min-h-[44px] shrink-0"
        aria-label="Next month"
        onClick={() => onChange(addMonth(month, 1))}
      >
        <Icon name="chevronRight" className="h-4 w-4" />
      </button>
    </div>
  );
}

// ───────────────────────────── bits ─────────────────────────────

/** Progress bar; pct may go past 100 (the bar stops at full). */
export function Bar({ pct, tone, label }: { pct: number; tone?: string; label?: string }) {
  const w = Math.max(0, Math.min(100, pct));
  const colour = tone ?? (pct >= 100 ? "var(--mint)" : pct >= 50 ? "var(--genda)" : "var(--kesar)");
  return (
    <div
      className="h-2 rounded-full bg-ink/10 overflow-hidden"
      role="progressbar"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={Math.round(w)}
      aria-label={label}
    >
      <div className="h-full rounded-full transition-all" style={{ width: `${w}%`, background: colour }} />
    </div>
  );
}

export function Tile({
  label,
  value,
  tone = "",
  active,
  onClick,
}: {
  label: string;
  value: number | string;
  tone?: string;
  active?: boolean;
  onClick?: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={`card p-3 text-left min-h-[44px] min-w-0 transition ${active ? "ring-2 ring-mor" : ""}`}
    >
      <p className={`stat-num !text-2xl leading-none ${tone}`}>{value}</p>
      <p className="stat-lbl mt-1 leading-tight">{label}</p>
    </button>
  );
}

export function ExceptionChips({ list }: { list: ExceptionKind[] }) {
  if (!list.length) return null;
  return (
    <div className="flex flex-wrap gap-1.5">
      {list.map((e) => (
        <span key={e} className="chip chip-kesar !py-0.5 !px-2 !text-[11.5px]">
          <Icon name="alert" className="h-3.5 w-3.5" />
          {EXCEPTION_LABEL[e] ?? e}
        </span>
      ))}
    </div>
  );
}

export function Empty({ title, sub }: { title: string; sub?: string }) {
  return (
    <div className="card p-6 text-center space-y-1">
      <p className="text-sm font-semibold">{title}</p>
      {sub && <p className="text-sm text-[var(--muted)]">{sub}</p>}
    </div>
  );
}

export function Loading() {
  return <p className="text-sm text-[var(--muted)]">Loading…</p>;
}
