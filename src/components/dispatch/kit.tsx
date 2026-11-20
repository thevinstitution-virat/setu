/**
 * Shared bits for the office dispatch screens: API JSON types, date helpers
 * and the trip status chip.
 */

import type { TripStop } from "@/lib/trip-api";
import type { TripSummary } from "@/lib/trips";
import { FAIL_REASONS } from "@/lib/delivery-settings";

export type TripStatus = "PLANNED" | "STARTED" | "CLOSED";
export type SlotJson = { key: string; label: string; labelHi?: string };
export type DriverJson = { id: string; name: string; phone: string | null };
export type VehicleJson = { id: string; number: string; name: string | null; capacityKg: number | null };

export type BoardTrip = {
  id: string;
  number: string;
  slot: string;
  status: TripStatus;
  note: string | null;
  driver: DriverJson;
  vehicle: { id: string; number: string; name: string | null } | null;
  stops: number;
  delivered: number;
  failed: number;
  value: number;
  startedAt: string | null;
  closedAt: string | null;
};

export type ReadyOrder = {
  id: string;
  orderNumber: string;
  status: string;
  total: number;
  deliveryDate: string | null;
  createdAt: string;
  lines: number;
  retry: { reason: string; attempts: number } | null;
  retailer: { id: string; outletName: string; pinCode: string; area: { id: string; name: string }; located: boolean };
};

export type Board = {
  date: string;
  today: string;
  slots: SlotJson[];
  trips: BoardTrip[];
  ready: ReadyOrder[];
  drivers: DriverJson[];
  vehicles: VehicleJson[];
};

export type StopJson = Omit<TripStop, "deliveredAt"> & { deliveredAt: string | null };

export type TripDetail = {
  trip: {
    id: string;
    number: string;
    date: string;
    slot: string;
    slotLabel: string;
    status: TripStatus;
    note: string | null;
    driver: DriverJson;
    vehicle: { id: string; number: string; name: string | null } | null;
    startedAt: string | null;
    closedAt: string | null;
  };
  stops: StopJson[];
  summary: TripSummary;
  directions: string | null;
  canManage: boolean;
};

export const STATUS_LABEL: Record<TripStatus, string> = {
  PLANNED: "Planned",
  STARTED: "On the road",
  CLOSED: "Closed",
};

const STATUS_CHIP: Record<TripStatus, string> = {
  PLANNED: "chip chip-genda",
  STARTED: "chip chip-kesar",
  CLOSED: "chip chip-mint",
};

export function StatusChip({ status, small }: { status: TripStatus; small?: boolean }) {
  return <span className={`${STATUS_CHIP[status]} ${small ? "!py-0.5 !px-2 !text-[11.5px]" : ""}`}>{STATUS_LABEL[status]}</span>;
}

export const failLabel = (reason: string | null | undefined) =>
  reason ? ((FAIL_REASONS as Record<string, string>)[reason] ?? reason) : "No reason given";

/** YYYY-MM-DD ± days (calendar maths in UTC, so no time-zone drift). */
export function addDays(ymd: string, days: number) {
  const d = new Date(`${ymd}T00:00:00.000Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** "Thu, 19 Nov 2026" */
export function dayLabel(ymd: string) {
  return new Date(`${ymd}T00:00:00.000Z`).toLocaleDateString("en-IN", {
    weekday: "short",
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  });
}

/** "19 Nov" */
export function shortDay(ymd: string) {
  return new Date(`${ymd}T00:00:00.000Z`).toLocaleDateString("en-IN", { day: "numeric", month: "short", timeZone: "UTC" });
}

export function timeLabel(iso: string | null) {
  if (!iso) return "";
  return new Date(iso).toLocaleTimeString("en-IN", { hour: "numeric", minute: "2-digit", timeZone: "Asia/Kolkata" });
}

export const plural = (n: number, w: string, many = `${w}s`) => `${n} ${n === 1 ? w : many}`;

export const vehicleText = (v: { number: string; name: string | null } | null) => (v ? (v.name ? `${v.number} · ${v.name}` : v.number) : "No vehicle");
