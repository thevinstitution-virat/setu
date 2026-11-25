"use client";

import { use, useMemo, useState } from "react";
import Link from "next/link";
import Icon from "@/components/Icon";
import { ErrorBox, Thumb, useFetch } from "@/components/admin/AdminKit";
import { istDay } from "@/lib/field-math";
import TeamMap, { type MapPoint } from "@/components/team/TeamMap";
import AnnouncementCards from "@/components/engage/AnnouncementCards";
import {
  Bar,
  DayPicker,
  Empty,
  ExceptionChips,
  Loading,
  Tile,
  YMD,
  hoursText,
  kmText,
  roleText,
  rupees,
  setQuery,
  timeText,
  type TeamToday,
  type TodayMember,
} from "@/components/team/kit";

type Filter = "all" | "present" | "leave" | "out" | "exceptions";

const ON_DUTY = "#3cc9a0";
const DONE = "#8a9a97";
const FLAGGED = "#db5c17";

const present = (m: TodayMember) => !!m.attendance?.checkInAt;
const notIn = (m: TodayMember) => !m.attendance?.checkInAt && !m.onLeave;

export default function TeamTodayPage({ searchParams }: { searchParams: Promise<{ date?: string | string[] }> }) {
  const { date: initial } = use(searchParams);
  const [today] = useState(() => istDay());
  const [date, setDate] = useState(typeof initial === "string" && YMD.test(initial) ? initial : today);
  const [filter, setFilter] = useState<Filter>("all");
  const { data, error, reload } = useFetch<TeamToday>(`/api/team/today?date=${date}`);
  const day = data && data.date === date ? data : null;

  function goTo(d: string) {
    setDate(d);
    setQuery(`/team?date=${d}`);
  }

  const members = useMemo(() => day?.members ?? [], [day]);
  const counts = {
    present: members.filter(present).length,
    leave: members.filter((m) => m.onLeave).length,
    out: members.filter(notIn).length,
    exceptions: members.filter((m) => m.exceptions.length > 0).length,
  };
  const shown = members.filter((m) =>
    filter === "present" ? present(m) : filter === "leave" ? m.onLeave : filter === "out" ? notIn(m) : filter === "exceptions" ? m.exceptions.length > 0 : true
  );

  const points: MapPoint[] = useMemo(
    () =>
      members
        .filter((m) => m.lastPosition)
        .map((m) => ({
          id: m.userId,
          lat: m.lastPosition!.lat,
          lng: m.lastPosition!.lng,
          label: m.name,
          sub: `Last seen ${timeText(m.lastPosition!.at)}${m.lastPosition!.accuracy != null ? ` · within ${m.lastPosition!.accuracy} m` : ""}`,
          color: m.exceptions.length ? FLAGGED : m.attendance?.checkOutAt ? DONE : ON_DUTY,
        })),
    [members]
  );

  const pick = (f: Filter) => setFilter((cur) => (cur === f ? "all" : f));

  return (
    <div className="space-y-5">
      <div className="page-head">
        <div className="min-w-0">
          <p className="page-kick">Field team</p>
          <h1 className="page-title">Team today</h1>
          <p className="page-sub">Who is in, where they are, and how the beat is going.</p>
        </div>
        <button type="button" className="btn btn-quiet btn-sm !min-h-[44px]" onClick={reload}>
          Refresh
        </button>
      </div>

      <AnnouncementCards />

      <DayPicker date={date} today={today} onChange={goTo} noFuture />

      {error && <ErrorBox message={error} onRetry={reload} />}
      {!day && !error && <Loading />}

      {day && (
        <>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
            <Tile label="Present" value={counts.present} tone="text-[var(--success-text)]" active={filter === "present"} onClick={() => pick("present")} />
            <Tile label="On leave" value={counts.leave} active={filter === "leave"} onClick={() => pick("leave")} />
            <Tile label="Not in" value={counts.out} tone={counts.out ? "text-[var(--scheme-text)]" : ""} active={filter === "out"} onClick={() => pick("out")} />
            <Tile
              label="With a problem"
              value={counts.exceptions}
              tone={counts.exceptions ? "text-[var(--risk-text)]" : ""}
              active={filter === "exceptions"}
              onClick={() => pick("exceptions")}
            />
          </div>

          {members.length === 0 ? (
            <Empty title="No one in your team yet" sub="Ask the office to put field staff under you." />
          ) : (
            <>
              <section className="space-y-2">
                <h2 className="font-heading font-bold text-xl">Where they are</h2>
                {!day.settings.trackLocation && (
                  <p className="text-xs text-[var(--muted)]">Location tracking is off. Dots show where people checked in.</p>
                )}
                <TeamMap
                  points={points}
                  emptyText="No positions yet for this day."
                  legend={[
                    { color: ON_DUTY, label: "On duty" },
                    { color: DONE, label: "Checked out" },
                    { color: FLAGGED, label: "Has a problem" },
                  ]}
                />
              </section>

              <section className="space-y-3">
                <div className="flex flex-wrap items-end justify-between gap-2">
                  <h2 className="font-heading font-bold text-xl">People</h2>
                  {filter !== "all" && (
                    <button type="button" className="btn btn-quiet btn-xs !min-h-[44px]" onClick={() => setFilter("all")}>
                      Show everyone
                    </button>
                  )}
                </div>
                {shown.length === 0 ? (
                  <Empty title="No one here" />
                ) : (
                  <div className="grid gap-3 md:grid-cols-2">
                    {shown.map((m) => (
                      <MemberCard key={m.userId} m={m} date={day.date} />
                    ))}
                  </div>
                )}
              </section>
            </>
          )}
        </>
      )}
    </div>
  );
}

function MemberCard({ m, date }: { m: TodayMember; date: string }) {
  const a = m.attendance;
  const status = m.onLeave ? (
    <span className="chip !py-0.5 !px-2 !text-[11.5px]">On leave</span>
  ) : !a?.checkInAt ? (
    <span className="chip chip-genda !py-0.5 !px-2 !text-[11.5px]">Not in</span>
  ) : a.checkOutAt ? (
    <span className="chip !py-0.5 !px-2 !text-[11.5px]">Checked out</span>
  ) : (
    <span className="chip chip-mint !py-0.5 !px-2 !text-[11.5px]">On duty</span>
  );
  const sales = m.role === "SALES_AGENT" || m.visits > 0;
  const beatPct = m.beat && m.beat.planned > 0 ? (m.beat.covered * 100) / m.beat.planned : 0;

  return (
    <Link href={`/team/${m.userId}?date=${date}`} className="card p-4 block hover:shadow-lg transition min-w-0 space-y-3">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="font-heading font-bold truncate">{m.name}</p>
          <p className="text-xs text-[var(--muted)]">{roleText(m.role)}</p>
        </div>
        <div className="flex flex-wrap justify-end gap-1.5 shrink-0">
          {a?.late && <span className="chip chip-kesar !py-0.5 !px-2 !text-[11.5px]">Late</span>}
          {status}
        </div>
      </div>

      <div className="flex items-center gap-3">
        {(a?.checkInSelfie || a?.checkOutSelfie) && (
          <div className="flex gap-1.5 shrink-0">
            {a?.checkInSelfie && <Thumb imageKey={a.checkInSelfie} className="h-11 w-11" alt={`${m.name} check-in selfie`} />}
            {a?.checkOutSelfie && <Thumb imageKey={a.checkOutSelfie} className="h-11 w-11" alt={`${m.name} check-out selfie`} />}
          </div>
        )}
        <div className="min-w-0 text-sm">
          {a?.checkInAt ? (
            <p className="font-semibold">
              In {timeText(a.checkInAt)}
              {a.checkOutAt ? ` · Out ${timeText(a.checkOutAt)}` : ""}
            </p>
          ) : (
            <p className="text-[var(--muted)]">{m.onLeave ? "On approved leave" : "Not checked in"}</p>
          )}
          <p className="text-xs text-[var(--muted)]">
            {hoursText(a?.minutes)} worked · {kmText(m.distanceM)}
          </p>
        </div>
      </div>

      <div className="grid grid-cols-3 gap-2 text-center">
        <Stat value={sales ? `${m.visits}` : "—"} label="Visits" extra={m.noOrder ? `${m.noOrder} no order` : undefined} />
        <Stat value={`${m.orders}`} label="Orders" extra={m.orders ? rupees(m.orderValue) : undefined} />
        <Stat value={rupees(m.collected)} label="Collected" small />
      </div>

      {m.beat && (
        <div className="space-y-1">
          <div className="flex items-center justify-between gap-2 text-xs">
            <span className="font-semibold truncate">
              <Icon name="route" className="h-3.5 w-3.5 inline -mt-0.5 mr-1" />
              {m.beat.name}
            </span>
            <span className="text-[var(--muted)] shrink-0">
              {m.beat.covered} / {m.beat.planned} shops
            </span>
          </div>
          <Bar pct={beatPct} label={`Beat covered ${m.beat.covered} of ${m.beat.planned}`} />
        </div>
      )}

      <ExceptionChips list={m.exceptions} />
    </Link>
  );
}

function Stat({ value, label, extra, small }: { value: string; label: string; extra?: string; small?: boolean }) {
  return (
    <div className="rounded-xl bg-ink/5 py-2 px-1 min-w-0">
      <p className={`font-heading font-bold leading-none truncate ${small ? "text-sm py-0.5" : "text-lg"}`}>{value}</p>
      <p className="text-[10.5px] text-[var(--muted)] mt-1 leading-tight truncate">{label}</p>
      {extra && <p className="text-[10.5px] font-semibold text-[var(--ink-2)] leading-tight truncate">{extra}</p>}
    </div>
  );
}
