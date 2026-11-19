"use client";

import { useEffect } from "react";
import Link from "next/link";
import Icon from "@/components/Icon";
import { ErrorBox, useFetch } from "@/components/admin/AdminKit";
import PunchCard from "@/components/field/PunchCard";
import WorkspaceSwitcher from "@/components/field/WorkspaceSwitcher";
import { FIELD_EVENT, clock, type DayRoute, type VisitsToday } from "@/components/field/kit";

/** Sales agent home: other businesses, today's punch, the beat and the shop I'm in. */
export default function SalesToday() {
  const route = useFetch<DayRoute>("/api/field/route");
  const visits = useFetch<VisitsToday>("/api/visits");
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

  const r = route.data;
  const open = visits.data?.open ?? null;
  const pct = r && r.planned ? Math.round((r.covered / r.planned) * 100) : 0;

  return (
    <div className="space-y-5">
      <div>
        <p className="page-kick">Sales beat</p>
        <h1 className="page-title">Today</h1>
      </div>

      <WorkspaceSwitcher />
      <PunchCard />

      {open && (
        <Link
          href={`/sales/retailers/${open.retailerId}`}
          className="card p-4 flex items-center gap-3 min-h-[64px] border-2 !border-[var(--kesar)] hover:-translate-y-0.5 transition"
        >
          <span className="icon-tile bg-[var(--kesar-tint)] text-[var(--kesar-text)]">
            <Icon name="pin" />
          </span>
          <div className="flex-1 min-w-0">
            <p className="text-xs font-bold uppercase tracking-[0.1em] text-[var(--kesar-text)]">In a shop now</p>
            <p className="font-bold text-sm truncate">{open.retailer.outletName}</p>
            <p className="text-xs text-[var(--muted)]">Since {clock(open.checkInAt)}. Check out before the next shop.</p>
          </div>
          <Icon name="arrow" className="h-4 w-4 shrink-0" />
        </Link>
      )}

      {route.error && !r ? (
        <ErrorBox message={route.error} onRetry={route.reload} />
      ) : !r ? (
        <div className="panel-dark p-5 text-sm text-white/70">Loading today&apos;s beat…</div>
      ) : (
        <Link href="/sales/beat" className="panel-dark p-5 block hover:-translate-y-0.5 transition">
          <div className="flex items-center justify-between gap-3">
            <div className="min-w-0">
              <p className="text-xs font-bold uppercase tracking-[0.12em] text-genda">Today&apos;s beat</p>
              <p className="font-heading font-bold text-xl mt-1 truncate">
                {r.beat ? r.beat.name : r.plan ? "No beat today" : "No beat planned"}
              </p>
              {r.plan?.note && <p className="text-xs text-white/70 mt-0.5">{r.plan.note}</p>}
            </div>
            <span className="btn btn-kesar btn-sm shrink-0">
              Open <Icon name="arrow" className="h-4 w-4" />
            </span>
          </div>
          {r.planned > 0 && (
            <>
              <p className="text-sm mt-3">
                {r.covered} of {r.planned} shops visited · {r.ordered} ordered
              </p>
              <div className="mt-2 h-2 rounded-full bg-white/15 overflow-hidden">
                <div className="h-full rounded-full bg-[var(--genda)] transition-all" style={{ width: `${pct}%` }} />
              </div>
            </>
          )}
          {r.offRoute.length > 0 && (
            <p className="text-xs text-white/70 mt-2">
              {r.offRoute.length} visit{r.offRoute.length === 1 ? "" : "s"} off the beat
            </p>
          )}
        </Link>
      )}

      <div className="grid grid-cols-2 gap-3">
        <Link href="/sales/stores" className="card p-4 flex items-center gap-3 min-h-[64px]">
          <span className="icon-tile bg-[var(--mint-tint)] text-[var(--mint-text)]">
            <Icon name="plus" />
          </span>
          <span className="font-bold text-sm">New shop</span>
        </Link>
        <Link href="/sales/targets" className="card p-4 flex items-center gap-3 min-h-[64px]">
          <span className="icon-tile bg-[var(--genda-tint)] text-[var(--genda-text)]">
            <Icon name="chart" />
          </span>
          <span className="font-bold text-sm">Targets</span>
        </Link>
      </div>
    </div>
  );
}
