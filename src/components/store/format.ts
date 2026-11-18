/**
 * Display helpers shared by the storefront (client) and the order pages
 * (server and client). Pure functions only — no React, no "use client".
 */

/** Storage key → URL served by /api/files/[...key]. */
export const fileUrl = (key: string) => `/api/files/${key.split("/").map(encodeURIComponent).join("/")}`;

const dayFmt = new Intl.DateTimeFormat("en-IN", { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" });

/**
 * "2026-11-20" or an ISO timestamp / Date of a @db.Date column → "Fri 20 Nov".
 * Read as a calendar date (UTC), so it never shifts a day with the time zone.
 */
export function formatDay(d: string | Date | null | undefined): string {
  if (!d) return "";
  const s = typeof d === "string" ? d.slice(0, 10) : d.toISOString().slice(0, 10);
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  if (!m) return "";
  const date = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
  const parts = dayFmt.formatToParts(date);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
  return `${get("weekday")} ${get("day")} ${get("month")}`;
}

/** "2 box × 24 (48 pack)" when ordered in cases, else "48 pack". */
export function qtyLabel(
  quantity: number,
  unit: string | null | undefined,
  cases?: number | null,
  caseSize?: number | null,
  caseUnit?: string | null
): string {
  const base = `${quantity}${unit ? ` ${unit}` : ""}`;
  if (cases && caseSize) return `${cases} ${caseUnit || "case"} × ${caseSize} (${base})`;
  return base;
}
