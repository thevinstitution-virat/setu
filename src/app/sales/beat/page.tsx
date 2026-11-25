"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import Icon from "@/components/Icon";
import { ErrorBox, errText, useFetch } from "@/components/admin/AdminKit";
import { addDay, istDay } from "@/lib/field-math";
import { shopMapUrl } from "@/app/delivery/maps";
import { NoOrderSheet, endVisit, reasonLabel, startVisit } from "@/components/field/VisitKit";
import { VISIT_REASON, type VisitReason } from "@/lib/automation-math";
import { FIELD_EVENT, clock, dayText, rupees, telHref, type DayRoute, type RouteShop, type Visit, type VisitsToday } from "@/components/field/kit";

type FieldShop = { id: string; outletName: string; pinCode: string; area: string; phone: string | null; mine: boolean };
type Busy = { id: string; text?: string } | null;

/**
 * The day's beat in visiting order. Today: check in at a shop, then take an
 * order or say why not (which checks out). Other days show the plan only.
 */
export default function BeatPage() {
  const today = istDay();
  const [date, setDate] = useState(today);
  const route = useFetch<DayRoute>(`/api/field/route?date=${date}`);
  const visits = useFetch<VisitsToday>("/api/visits");
  const [busy, setBusy] = useState<Busy>(null);
  const [rowErr, setRowErr] = useState<{ id: string; text: string } | null>(null);
  const [noOrder, setNoOrder] = useState<{ visitId: string; shopName: string } | null>(null);
  const reloadRoute = route.reload;
  const reloadVisits = visits.reload;

  useEffect(() => {
    const again = () => {
      reloadRoute();
      reloadVisits();
    };
    window.addEventListener(FIELD_EVENT, again);
    return () => window.removeEventListener(FIELD_EVENT, again);
  }, [reloadRoute, reloadVisits]);

  const isToday = date === today;
  const r = route.data && route.data.date === date ? route.data : null;
  const open = visits.data?.open ?? null;

  async function checkIn(retailerId: string) {
    setBusy({ id: retailerId });
    setRowErr(null);
    try {
      await startVisit(retailerId);
    } catch (e) {
      setRowErr({ id: retailerId, text: errText(e) });
    } finally {
      setBusy(null);
    }
  }

  async function checkOut(v: { id: string; retailerId: string }) {
    setBusy({ id: v.retailerId });
    setRowErr(null);
    try {
      await endVisit(v.id);
    } catch (e) {
      setRowErr({ id: v.retailerId, text: errText(e) });
    } finally {
      setBusy(null);
    }
  }

  const nextId = isToday && r ? (r.route.find((x) => !x.visit)?.retailer.id ?? null) : null;
  const shown = new Set<string>([...(r?.route ?? []).map((s) => s.visit?.id), ...(r?.extra ?? []).map((s) => s.visit?.id), ...(r?.offRoute ?? []).map((v) => v.id)].filter(Boolean) as string[]);
  const actions = {
    isToday,
    open,
    busy,
    rowErr,
    onCheckIn: checkIn,
    onCheckOut: checkOut,
    onNoOrder: (visitId: string, shopName: string) => setNoOrder({ visitId, shopName }),
  };

  return (
    <div className="space-y-5">
      <div>
        <p className="page-kick">Sales beat</p>
        <h1 className="page-title">{isToday ? "Today's beat" : date > today ? "Planned beat" : "Past beat"}</h1>
      </div>

      <div className="card p-2 flex items-center gap-2">
        <button type="button" className="btn btn-quiet btn-sm !px-3 min-h-[44px]" onClick={() => setDate((d) => addDay(d, -1))} aria-label="Day before">
          <Icon name="chevronLeft" className="h-4 w-4" />
        </button>
        <div className="flex-1 text-center min-w-0">
          <p className="font-bold text-sm">{dayText(date, true)}</p>
          <p className="text-xs text-[var(--muted)]">
            {isToday ? "Today" : date === addDay(today, 1) ? "Tomorrow" : date === addDay(today, -1) ? "Yesterday" : ""}
          </p>
        </div>
        <button type="button" className="btn btn-quiet btn-sm !px-3 min-h-[44px]" onClick={() => setDate((d) => addDay(d, 1))} aria-label="Next day">
          <Icon name="chevronRight" className="h-4 w-4" />
        </button>
      </div>
      <div className="flex gap-2">
        {!isToday && (
          <button type="button" className="btn btn-quiet btn-sm min-h-[40px]" onClick={() => setDate(today)}>
            Back to today
          </button>
        )}
        {date !== addDay(today, 1) && (
          <button type="button" className="btn btn-quiet btn-sm min-h-[40px]" onClick={() => setDate(addDay(today, 1))}>
            See tomorrow
          </button>
        )}
      </div>

      {/* A visit still open that isn't on this list (yesterday's, or a shop not shown here). */}
      {isToday && open && r && !shown.has(open.id) && (
        <div className="card p-4 space-y-3 border-2 !border-[var(--accent)]">
          <div>
            <p className="text-xs font-bold uppercase tracking-[0.1em] text-[var(--accent-text)]">Still checked in</p>
            <p className="font-bold text-sm">{open.retailer.outletName}</p>
            <p className="text-xs text-[var(--muted)]">Since {clock(open.checkInAt)}{istDay(new Date(open.checkInAt)) !== today ? ` on ${dayText(istDay(new Date(open.checkInAt)))}` : ""}</p>
          </div>
          <OpenVisitActions visit={open} {...actions} />
        </div>
      )}

      {route.error && !r ? (
        <ErrorBox message={route.error} onRetry={route.reload} />
      ) : !r ? (
        <p className="text-sm text-[var(--muted)]">Loading the beat…</p>
      ) : (
        <>
          <div className="panel-dark p-5 space-y-3" data-ground="dark">
            <div>
              <p className="text-[11px] font-extrabold uppercase tracking-[0.08em] text-genda">
                {r.source === "plan" ? "Planned for this day" : r.source === "weekday" ? "Your usual beat for this day" : "Beat"}
              </p>
              <p className="font-heading font-bold text-[22px] leading-tight mt-1">{r.planned > 0 ? `${r.covered} of ${r.planned} shops visited` : (r.beat?.name ?? "No beat")}</p>
              {r.planned > 0 && <p className="text-sm text-white/75 mt-0.5">{r.beat?.name ?? "No beat"}</p>}
              {r.plan?.note && <p className="text-sm text-white/80 mt-1">{r.plan.note}</p>}
            </div>
            {r.planned > 0 && (
              <>
                <div className="h-2 rounded-full bg-white/20 overflow-hidden" role="progressbar" aria-valuemin={0} aria-valuemax={r.planned} aria-valuenow={r.covered} aria-label="Shops visited">
                  <div className="h-full rounded-full bg-genda transition-[width] duration-500" style={{ width: `${Math.round((r.covered / r.planned) * 100)}%` }} />
                </div>
                <div className="grid grid-cols-3 gap-2">
                  <MiniStat label="Ordered" value={String(r.ordered)} />
                  <MiniStat label="Order value" value={rupees(r.route.reduce((a, x) => a + (x.visit?.order?.totalAmount ?? 0), 0))} />
                  <MiniStat label="Left" value={String(Math.max(0, r.planned - r.covered))} />
                </div>
              </>
            )}
          </div>

          {r.route.length === 0 ? (
            <div className="card p-6 text-center text-sm text-[var(--ink-2)]">
              {r.plan && !r.beat ? "No shops planned for this day." : "No beat is planned for this day. Ask your supervisor."}
            </div>
          ) : (
            <ol className="space-y-3">
              {r.route.map((s) => (
                <RouteRow key={s.retailer.id} shop={s} next={s.retailer.id === nextId} {...actions} />
              ))}
            </ol>
          )}

          {(r.extra?.length ?? 0) > 0 && (
            <section className="space-y-2">
              <div className="flex items-baseline justify-between gap-3">
                <h2 className="font-bold text-base">Also visit today</h2>
                <span className="text-xs text-[var(--muted)]">
                  {r.extraCovered ?? 0} of {r.extra!.length} visited
                </span>
              </div>
              <p className="text-xs text-[var(--muted)]">Added by the office: shops that need you today.</p>
              <ol className="space-y-3">
                {r.extra!.map((s, i) => (
                  <RouteRow key={s.retailer.id} shop={{ ...s, seq: r.route.length + i }} {...actions} />
                ))}
              </ol>
            </section>
          )}

          {r.offRoute.length > 0 && (
            <section className="space-y-2">
              <h2 className="font-bold text-base">Other shops visited</h2>
              <ul className="space-y-2">
                {r.offRoute.map((v) => (
                  <li key={v.id} className="card p-4 space-y-2">
                    <div className="flex items-start justify-between gap-3">
                      <Link href={`/sales/retailers/${v.retailerId}`} className="min-w-0">
                        <p className="font-bold text-sm truncate">{v.retailer.outletName}</p>
                        <p className="text-xs text-[var(--muted)]">
                          In {clock(v.checkInAt)}
                          {v.checkOutAt && ` · Out ${clock(v.checkOutAt)}`}
                          {v.offBeat && " · Not your shop"}
                        </p>
                      </Link>
                      <VisitChip visit={v} />
                    </div>
                    {isToday && !v.checkOutAt && open?.id === v.id && <OpenVisitActions visit={v} {...actions} />}
                    {rowErr?.id === v.retailerId && <p className="text-sm text-[var(--risk-text)]">{rowErr.text}</p>}
                  </li>
                ))}
              </ul>
            </section>
          )}

          {isToday && <OtherShop open={open} busy={busy} rowErr={rowErr} onCheckIn={checkIn} />}
        </>
      )}

      {noOrder && (
        <NoOrderSheet
          visitId={noOrder.visitId}
          shopName={noOrder.shopName}
          onClose={() => setNoOrder(null)}
          onDone={() => setNoOrder(null)}
        />
      )}
    </div>
  );
}

type Actions = {
  isToday: boolean;
  open: Visit | null;
  busy: Busy;
  rowErr: { id: string; text: string } | null;
  onCheckIn: (retailerId: string) => void;
  onCheckOut: (v: { id: string; retailerId: string }) => void;
  onNoOrder: (visitId: string, shopName: string) => void;
};

function VisitChip({ visit }: { visit: Visit | null }) {
  if (!visit) return null;
  if (!visit.checkOutAt) return <span className="st st-out text-[11px] px-2 py-0.5 rounded-full shrink-0">In shop</span>;
  if (visit.outcome === "ORDER" || visit.orderId)
    return <span className="st st-delivered text-[11px] px-2 py-0.5 rounded-full shrink-0">Ordered</span>;
  return <span className="st st-cancelled text-[11px] px-2 py-0.5 rounded-full shrink-0">No order</span>;
}

/** Take order / No order (or Check out when the order is already placed) for the open visit. */
function OpenVisitActions({ visit, busy, onCheckOut, onNoOrder }: { visit: Visit } & Actions) {
  const working = busy?.id === visit.retailerId;
  return (
    <div className="flex gap-2">
      <Link href={`/sales/retailers/${visit.retailerId}?order=1`} className="btn btn-kesar flex-[2] min-h-[44px]">
        {visit.orderId ? "Another order" : "Take order"}
      </Link>
      {visit.orderId ? (
        <button type="button" className="btn btn-quiet flex-1 min-h-[44px]" disabled={working} onClick={() => onCheckOut(visit)}>
          {working ? "Saving…" : "Check out"}
        </button>
      ) : (
        <button type="button" className="btn btn-quiet flex-1 min-h-[44px]" onClick={() => onNoOrder(visit.id, visit.retailer.outletName)}>
          No order
        </button>
      )}
    </div>
  );
}

function MiniStat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-[12px] bg-white text-[var(--ink)] px-3 py-2">
      <p className="text-[10.5px] font-semibold text-[var(--muted)]">{label}</p>
      <p className="font-heading font-bold text-[15px] num truncate">{value}</p>
    </div>
  );
}

function RouteRow({ shop, next = false, ...a }: { shop: RouteShop; next?: boolean } & Actions) {
  const { retailer: s, visit } = shop;
  const map = shopMapUrl({ lat: s.lat, lng: s.lng, address: [s.shopNumber, s.complexName, s.area?.name, s.pinCode].filter(Boolean).join(", ") });
  const isOpen = !!visit && !visit.checkOutAt;
  const elsewhere = a.open && a.open.retailerId !== s.id ? a.open : null;
  const working = a.busy?.id === s.id;

  return (
    <li className={`card p-4 space-y-3 ${isOpen || next ? "border-2 !border-[var(--accent)]" : ""} ${visit?.checkOutAt ? "opacity-70" : ""}`}>
      <div className="flex items-start gap-3">
        <span
          className={`icon-tile font-heading font-bold ${
            visit ? (visit.checkOutAt ? "bg-[var(--success-tint)] text-[var(--success-text)]" : "bg-[var(--accent-tint)] text-[var(--accent-text)]") : "bg-black/[0.06] text-[var(--ink-2)]"
          }`}
        >
          {visit?.checkOutAt ? <Icon name="check" /> : shop.seq + 1}
        </span>
        <Link href={`/sales/retailers/${s.id}`} className="flex-1 min-w-0">
          <p className="font-bold text-sm truncate">{s.outletName}</p>
          <p className="text-xs text-[var(--muted)] truncate">
            {s.shopNumber}, {s.complexName} · {s.area?.name}
          </p>
          {!!shop.reasons?.length && (
            <p className="text-xs font-semibold text-[var(--accent-text)] mt-0.5">{shop.reasons.map((x) => VISIT_REASON[x as VisitReason] ?? x).join(" · ")}</p>
          )}
          {visit && (
            <p className="text-xs text-[var(--ink-2)] mt-0.5">
              In {clock(visit.checkInAt)}
              {visit.checkOutAt && ` · Out ${clock(visit.checkOutAt)}`}
              {visit.order && ` · ${visit.order.orderNumber} ${rupees(visit.order.totalAmount)}`}
              {visit.outcome === "NO_ORDER" && visit.noOrderReason && ` · ${reasonLabel(visit.noOrderReason)}`}
            </p>
          )}
        </Link>
        <VisitChip visit={visit} />
      </div>

      <div className="flex flex-wrap gap-2">
        {s.user?.phone && (
          <a href={telHref(s.user.phone)} className="btn btn-quiet btn-sm min-h-[44px]">
            <Icon name="phone" className="h-4 w-4" /> Call
          </a>
        )}
        {map && (
          <a href={map} target="_blank" rel="noreferrer" className="btn btn-quiet btn-sm min-h-[44px]">
            <Icon name="map" className="h-4 w-4" /> Directions
          </a>
        )}
        {a.isToday && !visit && (
          <button
            type="button"
            className="btn btn-kesar min-h-[48px] ml-auto px-6"
            disabled={working || !!elsewhere}
            onClick={() => a.onCheckIn(s.id)}
          >
            {working ? "Checking in…" : "Check in"}
          </button>
        )}
      </div>

      {a.isToday && !visit && elsewhere && (
        <p className="text-xs text-[var(--muted)]">Check out of {elsewhere.retailer.outletName} first.</p>
      )}
      {a.isToday && isOpen && visit && <OpenVisitActions visit={{ ...visit, retailerId: s.id }} {...a} />}
      {a.rowErr?.id === s.id && <p className="text-sm text-[var(--risk-text)]">{a.rowErr.text}</p>}
    </li>
  );
}

/** Search any shop this agent may visit (off the beat) and check in there. */
function OtherShop({
  open,
  busy,
  rowErr,
  onCheckIn,
}: {
  open: Visit | null;
  busy: Busy;
  rowErr: { id: string; text: string } | null;
  onCheckIn: (retailerId: string) => void;
}) {
  const [show, setShow] = useState(false);
  const [q, setQ] = useState("");
  const [query, setQuery] = useState("");

  useEffect(() => {
    const t = setTimeout(() => setQuery(q.trim()), 300);
    return () => clearTimeout(t);
  }, [q]);

  const shops = useFetch<{ shops: FieldShop[] }>(show ? `/api/field/shops?q=${encodeURIComponent(query)}` : null);
  const list = (shops.data?.shops ?? []).slice(0, 30);

  if (!show) {
    return (
      <button type="button" className="btn btn-outline w-full min-h-[48px]" onClick={() => setShow(true)}>
        <Icon name="search" className="h-4 w-4" /> Visit another shop
      </button>
    );
  }

  return (
    <section className="card p-4 space-y-3">
      <div className="flex items-center justify-between gap-2">
        <h2 className="font-bold text-base">Visit another shop</h2>
        <button type="button" className="btn btn-quiet btn-xs !px-2 min-h-[36px]" onClick={() => setShow(false)} aria-label="Close search">
          <Icon name="x" className="h-4 w-4" />
        </button>
      </div>
      <input
        className="input"
        type="search"
        value={q}
        autoFocus
        placeholder="Shop name, PIN, area or phone"
        onChange={(e) => setQ(e.target.value)}
      />
      {open && <p className="text-xs text-[var(--muted)]">Check out of {open.retailer.outletName} first.</p>}
      {shops.error && !shops.data ? (
        <ErrorBox message={shops.error} onRetry={shops.reload} />
      ) : !shops.data ? (
        <p className="text-sm text-[var(--muted)]">Searching…</p>
      ) : list.length === 0 ? (
        <p className="text-sm text-[var(--muted)]">No shop matches.</p>
      ) : (
        <ul className="divide-y divide-[var(--line)]">
          {list.map((s) => (
            <li key={s.id} className="py-2 space-y-1">
              <div className="flex items-center gap-3">
                <div className="flex-1 min-w-0">
                  <p className="font-semibold text-sm truncate">
                    {s.outletName}
                    {!s.mine && <span className="text-xs font-normal text-[var(--muted)]"> · not your shop</span>}
                  </p>
                  <p className="text-xs text-[var(--muted)] truncate">
                    {s.area} · {s.pinCode}
                    {s.phone ? ` · ${s.phone}` : ""}
                  </p>
                </div>
                <button
                  type="button"
                  className="btn btn-kesar btn-sm min-h-[44px] shrink-0"
                  disabled={busy?.id === s.id || (!!open && open.retailerId !== s.id)}
                  onClick={() => onCheckIn(s.id)}
                >
                  {busy?.id === s.id ? "Checking in…" : open?.retailerId === s.id ? "Checked in" : "Check in"}
                </button>
              </div>
              {rowErr?.id === s.id && <p className="text-sm text-[var(--risk-text)]">{rowErr.text}</p>}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
