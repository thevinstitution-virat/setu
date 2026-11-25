import Link from "next/link";
import { formatINR } from "@/lib/money";
import { FAIL_REASONS } from "@/lib/delivery-settings";
import type { TripStop } from "@/lib/trip-api";
import Icon from "@/components/Icon";
import { shopMapUrl } from "./maps";
import PrefNote from "./PrefNote";

const failLabel = (r: string | null) => (r && r in FAIL_REASONS ? FAIL_REASONS[r as keyof typeof FAIL_REASONS] : "No reason");

/** Stop number badge. */
function Seq({ n, tone }: { n: number; tone: "open" | "done" | "failed" }) {
  const cls =
    tone === "open"
      ? "bg-[var(--accent-tint)] text-[var(--accent-text)]"
      : tone === "done"
        ? "bg-[var(--success-tint)] text-[var(--success-text)]"
        : "bg-[var(--risk-tint)] text-[var(--risk-text)]";
  return <span className={`icon-tile font-heading font-bold ${cls}`}>{n}</span>;
}

/** One stop of a running trip: big card while open, a short greyed row once done. */
export default function StopCard({ stop }: { stop: TripStop }) {
  const r = stop.retailer;
  const href = `/delivery/orders/${stop.orderId}`;

  if (stop.state !== "ASSIGNED") {
    const delivered = stop.state === "DELIVERED";
    const row = (
      <>
        <Seq n={stop.seq} tone={delivered ? "done" : "failed"} />
        <div className="flex-1 min-w-0">
          <p className="font-semibold text-sm truncate">{r.outletName}</p>
          <p className="text-xs text-[var(--muted)] truncate">
            {stop.order.orderNumber} · {formatINR(stop.order.total)}
          </p>
          {!delivered && (
            <p className="text-xs font-semibold text-[var(--risk-text)] mt-0.5">Not delivered: {failLabel(stop.failReason)}</p>
          )}
        </div>
        {delivered && (
          <span className="chip chip-mint shrink-0">
            <Icon name="check" className="h-3.5 w-3.5" /> Delivered
          </span>
        )}
      </>
    );
    return delivered ? (
      <Link href={href} className="card p-3 flex items-center gap-3 opacity-75 min-h-[56px]">
        {row}
      </Link>
    ) : (
      <div className="card p-3 flex items-center gap-3 opacity-75 min-h-[56px]">{row}</div>
    );
  }

  const map = shopMapUrl(r);
  return (
    <div className="card p-4 space-y-3">
      <Link href={href} className="flex items-start gap-3">
        <Seq n={stop.seq} tone="open" />
        <div className="flex-1 min-w-0">
          <p className="font-bold break-words">{r.outletName}</p>
          <p className="text-xs text-[var(--muted)] break-words">{r.address}</p>
          <p className="text-xs text-[var(--muted)] mt-0.5">
            {stop.order.orderNumber} · {stop.order.lines} line{stop.order.lines === 1 ? "" : "s"}
          </p>
        </div>
        <div className="text-right shrink-0">
          <p className="font-bold">{formatINR(stop.order.total, { whole: true })}</p>
          {stop.order.walletHold > 0 && <span className="chip chip-mint mt-1">Prepaid</span>}
        </div>
      </Link>

      {stop.codeNeeded && (
        <p className="chip chip-kesar">
          <Icon name="qr" className="h-3.5 w-3.5" /> Code needed
        </p>
      )}
      <PrefNote pref={r.deliveryPref} note={r.deliveryNote} />
      {stop.order.notes && <p className="text-xs text-[var(--ink-2)]">Order note: {stop.order.notes}</p>}

      <div className="grid grid-cols-2 gap-2">
        {r.phone ? (
          <a href={`tel:${r.phone}`} className="btn btn-outline">
            <Icon name="phone" className="h-4 w-4" /> Call
          </a>
        ) : (
          <span className="btn btn-outline opacity-50" aria-disabled="true">
            No phone
          </span>
        )}
        {map ? (
          <a href={map} target="_blank" rel="noopener noreferrer" className="btn btn-outline">
            <Icon name="map" className="h-4 w-4" /> Directions
          </a>
        ) : (
          <span className="btn btn-outline opacity-50" aria-disabled="true">
            No address
          </span>
        )}
      </div>
      <Link href={href} className="btn btn-kesar w-full !min-h-[56px]">
        Deliver <Icon name="arrow" className="h-4 w-4" />
      </Link>
    </div>
  );
}

/** Short row for a trip that hasn't left yet. */
export function PlannedStopRow({ stop }: { stop: TripStop }) {
  return (
    <li className="py-2.5 flex items-start gap-3">
      <span className="h-7 w-7 shrink-0 rounded-lg grid place-items-center bg-black/[0.06] text-xs font-bold">{stop.seq}</span>
      <div className="flex-1 min-w-0">
        <p className="text-sm font-semibold break-words">{stop.retailer.outletName}</p>
        <p className="text-xs text-[var(--muted)] truncate">
          {stop.retailer.area} · {stop.order.orderNumber}
        </p>
      </div>
      <span className="text-sm font-semibold shrink-0">{formatINR(stop.order.total, { whole: true })}</span>
    </li>
  );
}
