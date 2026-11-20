/**
 * Shared bits for the field staff screens (sales agents, drivers,
 * supervisors): API JSON types, formatting and a page-wide "field changed"
 * event so one card can tell the others (and the duty tracker) to reload.
 */

import { istTime } from "@/app/delivery/maps";

export { istTime };

/** Fired after a check in / out, duty switch, leave or visit change. */
export const FIELD_EVENT = "setu:field";
export const fieldChanged = () => {
  if (typeof window !== "undefined") window.dispatchEvent(new Event(FIELD_EVENT));
};

export type Attendance = {
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

export type LeaveStatus = "PENDING" | "APPROVED" | "REJECTED" | "CANCELLED";
export type LeaveRequest = {
  id: string;
  userId: string;
  fromDate: string;
  toDate: string;
  days: number;
  type: string;
  reason: string | null;
  status: LeaveStatus;
  decidedAt: string | null;
  decisionNote: string | null;
  user?: { name: string; role: string };
  decidedBy?: { name: string } | null;
};

export type FieldRules = { selfie: boolean; geo: boolean; trackLocation: boolean; pingMinutes: number; workStart: string };

export type AttendanceData = {
  user: { name: string; role: string; joined?: string };
  today: Attendance | null;
  onDuty: boolean;
  rules: FieldRules;
  month: {
    days: Attendance[];
    leave: LeaveRequest[];
    totals: { present: number; late: number; minutes: number; distanceM: number; leaveDays: number };
  };
};

export type Visit = {
  id: string;
  retailerId: string;
  checkInAt: string;
  checkOutAt: string | null;
  outcome: "ORDER" | "NO_ORDER" | null;
  noOrderReason: string | null;
  orderId: string | null;
  offBeat: boolean;
  distanceM: number | null;
  retailer: { outletName: string };
  order?: { orderNumber: string; totalAmount: number } | null;
};

export type RouteShop = {
  seq: number;
  retailer: {
    id: string;
    outletName: string;
    shopNumber: string;
    complexName: string;
    pinCode: string;
    lat: number | null;
    lng: number | null;
    area: { name: string };
    user: { phone: string | null; name: string };
  };
  visit: Visit | null;
  /** Why the office wants this shop seen today (VisitReason keys, from an accepted visit plan). */
  reasons?: string[];
};

export type DayRoute = {
  date: string;
  source: "plan" | "weekday" | null;
  plan: { id: string; note: string | null } | null;
  beat: { id: string; name: string } | null;
  route: RouteShop[];
  /** Shops added to the day by a visit plan that aren't on the beat. */
  extra?: (Omit<RouteShop, "seq"> & { taskId: string; note: string })[];
  extraCovered?: number;
  offRoute: Visit[];
  planned: number;
  covered: number;
  ordered: number;
};

export type VisitsToday = { visits: Visit[]; open: Visit | null };

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

/** "19 Nov" from YYYY-MM-DD. */
export function dayText(day: string, withWeekday = false) {
  const d = new Date(`${day}T00:00:00Z`);
  const s = `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]}`;
  return withWeekday ? `${WEEKDAYS[d.getUTCDay()]}, ${s}` : s;
}

/** "November 2026" from YYYY-MM. */
export function monthText(month: string) {
  const d = new Date(`${month}-01T00:00:00Z`);
  return d.toLocaleString("en-IN", { month: "long", year: "numeric", timeZone: "UTC" });
}

/** Clock time only, IST ("9:12 am"). */
export function clock(iso: string) {
  const IST = 19_800_000;
  const d = new Date(new Date(iso).getTime() + IST);
  const h = d.getUTCHours();
  return `${h % 12 || 12}:${String(d.getUTCMinutes()).padStart(2, "0")} ${h >= 12 ? "pm" : "am"}`;
}

/** 125 → "2 h 5 min". */
export function hoursText(minutes: number | null | undefined) {
  const m = Math.max(0, Math.round(minutes ?? 0));
  const h = Math.floor(m / 60);
  const r = m % 60;
  if (!h) return `${r} min`;
  return r ? `${h} h ${r} min` : `${h} h`;
}

/** 12345 → "12.3 km", 800 → "800 m". */
export function distanceText(m: number | null | undefined) {
  const v = Math.max(0, Math.round(m ?? 0));
  return v >= 1000 ? `${(v / 1000).toFixed(1)} km` : `${v} m`;
}

/** Paise → "₹1,234" (whole rupees). */
export const rupees = (paise: number) => `₹${Math.round(paise / 100).toLocaleString("en-IN")}`;

/** YYYY-MM ± n months. */
export function addMonth(month: string, n: number) {
  const [y, m] = month.split("-").map(Number);
  const d = new Date(Date.UTC(y, m - 1 + n, 1));
  return d.toISOString().slice(0, 7);
}

export const telHref = (phone: string) => `tel:${phone.replace(/[^\d+]/g, "")}`;
