/**
 * Shared bits for the stock overview, history and places screens: API JSON
 * types, quantity / date text and one history row.
 */

import Link from "next/link";
import type { InventorySettings } from "@/lib/inventory-settings";

export type PlaceKind = "WAREHOUSE" | "VAN" | "DAMAGED";

export type StockRow = {
  id: string;
  name: string;
  sku: string;
  unit: string;
  caseUnit: string | null;
  caseSize: number | null;
  reorderLevel: number | null;
  reorderQty: number | null;
  trackExpiry: boolean;
  lastCost: number | null;
  supplier: { id: string; name: string } | null;
  category: { name: string } | null;
  warehouse: number;
  van: number;
  damaged: number;
  expired: number;
  reserved: number;
  available: number;
  value: number;
  low: boolean;
  out: boolean;
  nextExpiry: { date: string; qty: number; expired: boolean } | null;
};

export type StockData = {
  settings: InventorySettings;
  products: StockRow[];
  locations: { id: string; kind: PlaceKind; name: string; isDefault: boolean; vehicleId: string | null }[];
  totals: { value: number; low: number; out: number; expiringSoon: number; expired: number };
};

export type Lot = {
  id: string;
  product: { id: string; name: string; sku: string; unit: string };
  location: { id: string; name: string; kind: PlaceKind };
  batch: string;
  expiry: string | null;
  mfgDate: string | null;
  qty: number;
  unitCost: number | null;
  receivedAt: string;
  expired: boolean;
};

export type Move = {
  id: string;
  kind: string;
  label: string;
  product: { id: string; name: string; unit: string };
  qty: number;
  from: string | null;
  to: string | null;
  batch: string;
  expiry: string | null;
  reason: string | null;
  reasonLabel: string;
  note: string | null;
  orderId: string | null;
  orderNumber: string | null;
  tripId: string | null;
  purchaseId: string | null;
  by: string | null;
  at: string;
};

export type Place = {
  id: string;
  kind: PlaceKind;
  name: string;
  address: string | null;
  isDefault: boolean;
  active: boolean;
  vehicle: { number: string } | null;
  units: number;
  batches: number;
};

export const KIND_LABEL: Record<PlaceKind, string> = { WAREHOUSE: "Warehouse", VAN: "Van", DAMAGED: "Damaged bin" };

export const plural = (n: number, w: string, many = `${w}s`) => `${n.toLocaleString("en-IN")} ${n === 1 ? w : many}`;

/** "1,240 pc" */
export const qtyText = (n: number, unit: string) => `${n.toLocaleString("en-IN")} ${unit}`;

/** "10 box + 4 pc" when there is at least one full case, else null. */
export function caseText(n: number, p: { unit: string; caseUnit: string | null; caseSize: number | null }) {
  if (!p.caseSize || p.caseSize < 2 || !p.caseUnit || Math.abs(n) < p.caseSize) return null;
  const sign = n < 0 ? "−" : "";
  const a = Math.abs(n);
  const cases = Math.floor(a / p.caseSize);
  const rest = a % p.caseSize;
  return `${sign}${cases.toLocaleString("en-IN")} ${p.caseUnit}${rest ? ` + ${rest} ${p.unit}` : ""}`;
}

/** Today in India as YYYY-MM-DD. */
export const todayYmd = () => new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata" }).format(new Date());

/** "19 Nov 2026" from YYYY-MM-DD. */
export function ymdText(ymd: string | null | undefined) {
  if (!ymd) return "";
  return new Date(`${ymd}T00:00:00.000Z`).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
}

/** Whole days from today (IST) to a YYYY-MM-DD; negative = past. */
export function daysUntil(ymd: string) {
  return Math.round((Date.parse(`${ymd}T00:00:00Z`) - Date.parse(`${todayYmd()}T00:00:00Z`)) / 86_400_000);
}

/** Expiry in words and its colour: red when expired, marigold when within the warning days. */
export function expiryInfo(ymd: string, alertDays: number) {
  const d = daysUntil(ymd);
  if (d < 0) return { text: `Expired ${ymdText(ymd)}`, tone: "text-[var(--risk-text)]", chip: "chip !bg-[var(--risk-tint)] !text-[var(--risk-text)] !border-transparent" };
  const when = d === 0 ? "today" : d === 1 ? "tomorrow" : `in ${d} days`;
  if (d <= alertDays) return { text: `Expires ${when} · ${ymdText(ymd)}`, tone: "text-[var(--scheme-text)]", chip: "chip chip-genda" };
  return { text: `Expires ${ymdText(ymd)}`, tone: "text-[var(--muted)]", chip: "chip" };
}

export function whenText(iso: string) {
  return new Date(iso).toLocaleString("en-IN", { day: "numeric", month: "short", hour: "numeric", minute: "2-digit", timeZone: "Asia/Kolkata" });
}

export const SMALL_CHIP = "!py-0.5 !px-2 !text-[11.5px]";

/** Kinds that take stock away from the business (shown in red). */
const OUT_KINDS = new Set(["SALE", "WRITE_OFF", "SUPPLIER_RETURN", "DAMAGE"]);

/** One stock move: kind, product, ±qty with from → to, batch, reason, order, who and when. */
export function MoveRow({ m, showProduct = true }: { m: Move; showProduct?: boolean }) {
  const into = m.to && !m.from;
  const outOf = m.from && !m.to;
  const sign = into ? "+" : outOf ? "−" : "";
  const tone = into ? "text-[var(--success-text)]" : outOf || OUT_KINDS.has(m.kind) ? "text-[var(--risk-text)]" : "text-[var(--ink)]";
  const path = m.from && m.to ? `${m.from} → ${m.to}` : m.from ? `from ${m.from}` : m.to ? `into ${m.to}` : "";
  return (
    <div className="flex items-start gap-3 px-4 py-3 min-w-0">
      <div className="min-w-0 flex-1 space-y-0.5">
        <div className="flex flex-wrap items-center gap-1.5">
          <span className={`chip ${SMALL_CHIP} ${into ? "chip-mint" : OUT_KINDS.has(m.kind) ? "chip-kesar" : ""}`}>{m.label}</span>
          {showProduct && <span className="text-sm font-semibold min-w-0 break-words">{m.product.name}</span>}
        </div>
        {path && <p className="text-xs text-[var(--ink-2)] break-words">{path}</p>}
        {(m.batch || m.expiry) && (
          <p className="text-xs text-[var(--muted)] break-words">
            {m.batch ? `Batch ${m.batch}` : "No batch"}
            {m.expiry ? ` · Exp ${ymdText(m.expiry)}` : ""}
          </p>
        )}
        {(m.reasonLabel || m.note) && (
          <p className="text-xs text-[var(--ink-2)] break-words">
            {m.reasonLabel}
            {m.reasonLabel && m.note ? ": " : ""}
            {m.note && <span className="text-[var(--muted)]">{m.note}</span>}
          </p>
        )}
        <p className="text-[11.5px] text-[var(--muted)]">
          {whenText(m.at)}
          {m.by ? ` · ${m.by}` : ""}
          {m.orderNumber && (
            <>
              {" · "}
              <Link href={`/admin/orders?q=${encodeURIComponent(m.orderNumber)}`} className="font-semibold text-[var(--accent-text)] hover:underline">
                {m.orderNumber}
              </Link>
            </>
          )}
        </p>
      </div>
      <p className={`shrink-0 font-heading font-bold text-base ${tone}`}>
        {sign}
        {qtyText(m.qty, m.product.unit)}
      </p>
    </div>
  );
}

/** Segmented two- or three-way choice with big tap targets. */
export function Segmented<T extends string>({
  value,
  onChange,
  options,
  label,
}: {
  value: T;
  onChange: (v: T) => void;
  options: readonly (readonly [T, string])[];
  label: string;
}) {
  return (
    <div className="flex rounded-2xl p-1 bg-ink/5" role="radiogroup" aria-label={label}>
      {options.map(([v, text]) => (
        <button
          key={v}
          type="button"
          role="radio"
          aria-checked={value === v}
          onClick={() => onChange(v)}
          className={`flex-1 min-h-[40px] rounded-xl px-3 text-sm font-bold transition ${
            value === v ? "bg-gradient-to-br from-mor to-[var(--mor-mid)] text-white" : "text-[var(--ink-2)]"
          }`}
        >
          {text}
        </button>
      ))}
    </div>
  );
}

/** Footer for the stock action sheets: error, cancel, primary. */
export function SheetFooter({
  error,
  busy,
  onCancel,
  onSave,
  label,
  busyLabel = "Saving…",
  disabled,
  danger,
}: {
  error: string | null;
  busy: boolean;
  onCancel: () => void;
  onSave: () => void;
  label: string;
  busyLabel?: string;
  disabled?: boolean;
  danger?: boolean;
}) {
  return (
    <div className="space-y-2">
      {error && (
        <p className="text-sm text-[var(--risk-text)]" role="alert">
          {error}
        </p>
      )}
      <div className="flex gap-2 justify-end">
        <button type="button" className="btn btn-quiet" onClick={onCancel} disabled={busy}>
          Cancel
        </button>
        <button type="button" className={`btn ${danger ? "btn-danger" : "btn-kesar"}`} onClick={onSave} disabled={busy || disabled}>
          {busy ? busyLabel : label}
        </button>
      </div>
    </div>
  );
}
