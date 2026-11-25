"use client";

import { use, useMemo, useState } from "react";
import Link from "next/link";
import Icon from "@/components/Icon";
import { ErrorBox, Thumb, fileUrl, useFetch } from "@/components/admin/AdminKit";
import { istDay } from "@/lib/field-math";
import { NO_ORDER_REASONS } from "@/lib/field-settings";
import TeamMap, { type MapPoint } from "@/components/team/TeamMap";
import {
  DayPicker,
  Empty,
  Loading,
  YMD,
  hoursText,
  kmText,
  plural,
  roleText,
  rupees,
  setQuery,
  timeText,
  type Track,
} from "@/components/team/kit";

const GAP_MIN = 30;
const ORDER = "#3cc9a0";
const NO_ORDER = "#f2b33d";
const OPEN = "#db5c17";
const IN = "#155651";
const OUT = "#5b6f6c";

type Visit = Track["visits"][number];
type Event =
  | { kind: "in"; at: string }
  | { kind: "out"; at: string }
  | { kind: "visit"; at: string; n: number; v: Visit }
  | { kind: "gap"; at: string; to: string; minutes: number };

const reasonText = (r: string | null) => (r ? ((NO_ORDER_REASONS as Record<string, string>)[r] ?? r) : null);

export default function PersonDayPage({
  params,
  searchParams,
}: {
  params: Promise<{ userId: string }>;
  searchParams: Promise<{ date?: string | string[] }>;
}) {
  const { userId } = use(params);
  const { date: initial } = use(searchParams);
  const [today] = useState(() => istDay());
  const [date, setDate] = useState(typeof initial === "string" && YMD.test(initial) ? initial : today);
  const { data, error, reload } = useFetch<Track>(`/api/team/track?userId=${encodeURIComponent(userId)}&date=${date}`);
  const track = data && data.date === date ? data : null;

  function goTo(d: string) {
    setDate(d);
    setQuery(`/team/${encodeURIComponent(userId)}?date=${d}`);
  }

  const view = useMemo(() => (track ? build(track) : null), [track]);

  return (
    <div className="space-y-5">
      <div className="page-head">
        <div className="min-w-0">
          <Link href={`/team?date=${date}`} className="text-sm font-bold text-[var(--accent-text)] inline-flex items-center gap-1 min-h-[44px]">
            <Icon name="chevronLeft" className="h-4 w-4" /> Team today
          </Link>
          <p className="page-kick">{track ? roleText(track.user.role) : "Field team"}</p>
          <h1 className="page-title break-words">{track?.user.name ?? (data?.user.name || "One person's day")}</h1>
        </div>
      </div>

      <DayPicker date={date} today={today} onChange={goTo} noFuture />

      {error && <ErrorBox message={error} onRetry={reload} />}
      {!track && !error && <Loading />}

      {track && view && (
        <>
          <Totals track={track} view={view} />

          <section className="space-y-2">
            <h2 className="font-heading font-bold text-xl">Route</h2>
            <TeamMap
              points={view.points}
              path={track.pings.length > 1 ? { points: track.pings, color: IN } : null}
              emptyText="No positions recorded this day."
              showLabels={view.points.length <= 8}
              legend={[
                { color: IN, label: "Check in / path" },
                { color: OUT, label: "Check out" },
                { color: ORDER, label: "Order" },
                { color: NO_ORDER, label: "No order" },
                { color: OPEN, label: "Visit still open" },
              ]}
            />
            {track.pings.length > 0 && (
              <p className="text-xs text-[var(--muted)]">
                {plural(track.pings.length, "position")} from {timeText(track.pings[0].at)} to {timeText(track.pings.at(-1)!.at)}
                {track.pings.at(-1)!.battery != null ? ` · battery ${track.pings.at(-1)!.battery}% at the last one` : ""}
              </p>
            )}
          </section>

          {(track.attendance?.checkInSelfie || track.attendance?.checkOutSelfie) && (
            <section className="space-y-2">
              <h2 className="font-heading font-bold text-xl">Selfies</h2>
              <div className="flex flex-wrap gap-3">
                {track.attendance?.checkInSelfie && <Selfie imageKey={track.attendance.checkInSelfie} label={`Check in ${timeText(track.attendance.checkInAt)}`} />}
                {track.attendance?.checkOutSelfie && <Selfie imageKey={track.attendance.checkOutSelfie} label={`Check out ${timeText(track.attendance.checkOutAt)}`} />}
              </div>
            </section>
          )}

          <section className="space-y-2">
            <h2 className="font-heading font-bold text-xl">Timeline</h2>
            {view.events.length === 0 ? (
              <Empty title="Nothing recorded this day" sub="No check-in, visits or positions." />
            ) : (
              <ol className="card p-4 space-y-0">
                {view.events.map((e, i) => (
                  <TimelineRow key={i} e={e} last={i === view.events.length - 1} />
                ))}
              </ol>
            )}
          </section>
        </>
      )}
    </div>
  );
}

function build(t: Track) {
  const a = t.attendance;
  const points: MapPoint[] = [];
  if (a?.checkInLat != null && a.checkInLng != null)
    points.push({ id: "in", lat: a.checkInLat, lng: a.checkInLng, label: "Checked in", sub: timeText(a.checkInAt), color: IN, tag: "In" });
  t.visits.forEach((v, i) => {
    const lat = v.checkInLat ?? v.retailer.lat;
    const lng = v.checkInLng ?? v.retailer.lng;
    if (lat == null || lng == null) return;
    const what = v.outcome === "ORDER" ? `Order${v.order ? ` ${rupees(v.order.totalAmount)}` : ""}` : v.outcome === "NO_ORDER" ? "No order" : "Visit open";
    points.push({
      id: v.id,
      lat,
      lng,
      label: `${i + 1}. ${v.retailer.outletName}`,
      sub: `${timeText(v.checkInAt)} · ${what}`,
      color: v.outcome === "ORDER" ? ORDER : v.outcome === "NO_ORDER" ? NO_ORDER : OPEN,
      tag: String(i + 1),
    });
  });
  if (a?.checkOutLat != null && a.checkOutLng != null)
    points.push({ id: "out", lat: a.checkOutLat, lng: a.checkOutLng, label: "Checked out", sub: timeText(a.checkOutAt), color: OUT, tag: "Out" });

  const events: Event[] = [];
  if (a?.checkInAt) events.push({ kind: "in", at: a.checkInAt });
  t.visits.forEach((v, i) => events.push({ kind: "visit", at: v.checkInAt, n: i + 1, v }));
  if (a?.checkOutAt) events.push({ kind: "out", at: a.checkOutAt });

  // Gaps: no position for more than 30 minutes while checked in.
  if (t.pings.length) {
    const times = t.pings.map((p) => p.at);
    if (a?.checkInAt) times.push(a.checkInAt);
    if (a?.checkOutAt) times.push(a.checkOutAt);
    const from = a?.checkInAt ? Date.parse(a.checkInAt) : -Infinity;
    const to = a?.checkOutAt ? Date.parse(a.checkOutAt) : Infinity;
    const sorted = [...new Set(times)].filter((x) => Date.parse(x) >= from && Date.parse(x) <= to).sort((x, y) => Date.parse(x) - Date.parse(y));
    for (let i = 1; i < sorted.length; i++) {
      const minutes = Math.round((Date.parse(sorted[i]) - Date.parse(sorted[i - 1])) / 60_000);
      if (minutes > GAP_MIN) events.push({ kind: "gap", at: sorted[i - 1], to: sorted[i], minutes });
    }
  }
  const order = { in: 0, gap: 1, visit: 2, out: 3 } as const;
  events.sort((x, y) => Date.parse(x.at) - Date.parse(y.at) || order[x.kind] - order[y.kind]);

  return {
    points,
    events,
    noOrder: t.visits.filter((v) => v.outcome === "NO_ORDER").length,
    offBeat: t.visits.filter((v) => v.offBeat).length,
  };
}

function Totals({ track, view }: { track: Track; view: ReturnType<typeof build> }) {
  const a = track.attendance;
  return (
    <div className="card p-4 space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        {a?.checkInAt ? (
          <p className="text-sm font-semibold">
            In {timeText(a.checkInAt)}
            {a.checkOutAt ? ` · Out ${timeText(a.checkOutAt)}` : " · still on duty or did not check out"}
          </p>
        ) : (
          <p className="text-sm text-[var(--muted)]">Did not check in</p>
        )}
        {a?.late && <span className="chip chip-kesar !py-0.5 !px-2 !text-[11.5px]">Late</span>}
      </div>
      <div className="grid grid-cols-3 sm:grid-cols-6 gap-2 text-center">
        <Num value={hoursText(a?.minutes)} label="Worked" />
        <Num value={kmText(track.distanceM)} label="Travelled" />
        <Num value={String(track.visits.length)} label={view.noOrder ? `Visits · ${view.noOrder} no order` : "Visits"} />
        <Num value={String(track.orders)} label="Orders" />
        <Num value={rupees(track.orderValue)} label="Order value" />
        <Num value={rupees(track.collected)} label="Collected" />
      </div>
      {view.offBeat > 0 && <p className="text-xs text-[var(--muted)]">{plural(view.offBeat, "visit")} off the beat.</p>}
    </div>
  );
}

function Num({ value, label }: { value: string; label: string }) {
  return (
    <div className="rounded-xl bg-ink/5 py-2 px-1 min-w-0">
      <p className="font-heading font-bold leading-none truncate">{value}</p>
      <p className="text-[10.5px] text-[var(--muted)] mt-1 leading-tight">{label}</p>
    </div>
  );
}

function Selfie({ imageKey, label }: { imageKey: string; label: string }) {
  return (
    <a href={fileUrl(imageKey)} target="_blank" rel="noopener noreferrer" className="block space-y-1">
      <Thumb imageKey={imageKey} className="h-28 w-28" alt={label} />
      <span className="block text-xs text-[var(--muted)]">{label}</span>
    </a>
  );
}

function TimelineRow({ e, last }: { e: Event; last: boolean }) {
  const dot =
    e.kind === "gap"
      ? "bg-ink/20"
      : e.kind === "in"
        ? "bg-mor"
        : e.kind === "out"
          ? "bg-[#5b6f6c]"
          : e.v.outcome === "ORDER"
            ? "bg-mint"
            : e.v.outcome === "NO_ORDER"
              ? "bg-genda"
              : "bg-kesar";
  return (
    <li className="relative flex gap-3 pb-4 last:pb-0">
      {!last && <span className="absolute left-[7px] top-5 bottom-0 w-0.5 bg-ink/10" aria-hidden="true" />}
      <span className={`relative mt-1 h-4 w-4 rounded-full shrink-0 border-2 border-white shadow ${dot}`} aria-hidden="true" />
      <div className="min-w-0 flex-1">
        <p className="text-xs font-bold text-[var(--muted)]">
          {timeText(e.at)}
          {e.kind === "visit" && e.v.checkOutAt ? ` – ${timeText(e.v.checkOutAt)}` : ""}
          {e.kind === "gap" ? ` – ${timeText(e.to)}` : ""}
        </p>
        {e.kind === "in" && <p className="text-sm font-semibold">Checked in</p>}
        {e.kind === "out" && <p className="text-sm font-semibold">Checked out</p>}
        {e.kind === "gap" && (
          <p className="text-sm text-[var(--scheme-text)] flex items-center gap-1.5">
            <Icon name="alert" className="h-4 w-4 shrink-0" /> No position for {hoursText(e.minutes)}
          </p>
        )}
        {e.kind === "visit" && <VisitLine n={e.n} v={e.v} />}
      </div>
    </li>
  );
}

function VisitLine({ n, v }: { n: number; v: Visit }) {
  return (
    <div className="space-y-1">
      <p className="text-sm font-semibold break-words">
        {n}. {v.retailer.outletName}
      </p>
      <div className="flex flex-wrap items-center gap-1.5 text-xs">
        {v.outcome === "ORDER" ? (
          <span className="chip chip-mint !py-0.5 !px-2 !text-[11.5px]">
            Order{v.order ? ` ${v.order.orderNumber} · ${rupees(v.order.totalAmount)}` : ""}
          </span>
        ) : v.outcome === "NO_ORDER" ? (
          <span className="chip chip-genda !py-0.5 !px-2 !text-[11.5px]">No order{v.noOrderReason ? `: ${reasonText(v.noOrderReason)}` : ""}</span>
        ) : (
          <span className="chip chip-kesar !py-0.5 !px-2 !text-[11.5px]">{v.checkOutAt ? "No outcome" : "Still in the shop"}</span>
        )}
        {v.offBeat && <span className="chip !py-0.5 !px-2 !text-[11.5px]">Off beat</span>}
        {v.distanceM != null && <span className="text-[var(--muted)]">{v.distanceM >= 1000 ? kmText(v.distanceM) : `${v.distanceM} m`} from the shop</span>}
      </div>
    </div>
  );
}
