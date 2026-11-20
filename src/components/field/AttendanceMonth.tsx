"use client";

import { useEffect, useState } from "react";
import Icon from "@/components/Icon";
import { ErrorBox, Thumb, fileUrl, useFetch } from "@/components/admin/AdminKit";
import { addDay, daysBetween, istDay, istMonth, weekday } from "@/lib/field-math";
import { LEAVE_TYPES } from "@/lib/field-settings";
import {
  FIELD_EVENT,
  addMonth,
  clock,
  dayText,
  distanceText,
  hoursText,
  monthText,
  type Attendance,
  type AttendanceData,
  type LeaveRequest,
} from "./kit";

type Mark = "present" | "late" | "leave" | "leave-pending" | "absent" | null;

const DOT: Record<Exclude<Mark, null>, string> = {
  present: "bg-[var(--mint)]",
  late: "bg-[var(--kesar)]",
  leave: "bg-[var(--genda)]",
  "leave-pending": "border-2 border-[var(--genda)]",
  absent: "bg-[#a8281e]",
};

const LEGEND: [Exclude<Mark, null>, string][] = [
  ["present", "Present"],
  ["late", "Late"],
  ["leave", "Leave"],
  ["leave-pending", "Leave asked"],
  ["absent", "Absent"],
];

const lastDay = (month: string) => addDay(`${addMonth(month, 1)}-01`, -1);

/**
 * One person's month: a Mon–Sun calendar with a dot per day (present, late,
 * leave, absent), the tapped day's punches and the month totals. Sundays and
 * days still to come are never marked absent. Supervisors pass userId.
 */
export default function AttendanceMonth({ userId }: { userId?: string }) {
  const thisMonth = istMonth();
  const [month, setMonth] = useState(thisMonth);

  return (
    <div className="card p-4 space-y-4">
      <div className="flex items-center justify-between gap-2">
        <button
          type="button"
          className="btn btn-quiet btn-sm !px-3 min-h-[44px]"
          onClick={() => setMonth((m) => addMonth(m, -1))}
          aria-label="Previous month"
        >
          <Icon name="chevronLeft" className="h-4 w-4" />
        </button>
        <p className="font-heading font-bold text-base text-center">{monthText(month)}</p>
        <button
          type="button"
          className="btn btn-quiet btn-sm !px-3 min-h-[44px]"
          onClick={() => setMonth((m) => addMonth(m, 1))}
          disabled={month >= thisMonth}
          aria-label="Next month"
        >
          <Icon name="chevronRight" className="h-4 w-4" />
        </button>
      </div>
      <MonthBody key={`${month}-${userId ?? ""}`} month={month} userId={userId} />
    </div>
  );
}

/** One month's grid, the tapped day and totals. Remounted per month, so an old month never shows. */
function MonthBody({ month, userId }: { month: string; userId?: string }) {
  const today = istDay();
  const [picked, setPicked] = useState<string | null>(null);
  const qs = new URLSearchParams({ month, ...(userId ? { userId } : {}) }).toString();
  const { data: shown, error, reload } = useFetch<AttendanceData>(`/api/field/attendance?${qs}`);

  useEffect(() => {
    window.addEventListener(FIELD_EVENT, reload);
    return () => window.removeEventListener(FIELD_EVENT, reload);
  }, [reload]);

  const days = daysBetween(`${month}-01`, lastDay(month));
  const lead = (weekday(days[0]) + 6) % 7; // Monday first
  const byDay = new Map<string, Attendance>((shown?.month.days ?? []).map((d) => [d.date, d]));
  const leaveOn = (day: string): LeaveRequest | undefined =>
    (shown?.month.leave ?? []).find((l) => l.fromDate <= day && l.toDate >= day);

  function mark(day: string): Mark {
    const a = byDay.get(day);
    if (a?.checkInAt) return a.late ? "late" : "present";
    const l = leaveOn(day);
    if (l) return l.status === "APPROVED" ? "leave" : "leave-pending";
    if (day < today && weekday(day) !== 0 && (!shown?.user.joined || day >= shown.user.joined)) return "absent";
    return null;
  }

  const pickedRow = picked ? byDay.get(picked) : undefined;
  const pickedLeave = picked ? leaveOn(picked) : undefined;
  const totals = shown?.month.totals;

  return (
    <>
      {error && !shown ? (
        <ErrorBox message={error} onRetry={reload} />
      ) : (
        <>
          <div className="grid grid-cols-7 gap-1 text-center" role="grid" aria-label={`Attendance for ${monthText(month)}`}>
            {["M", "T", "W", "T", "F", "S", "S"].map((d, i) => (
              <span key={i} className="text-[11px] font-bold text-[var(--muted)] py-1">
                {d}
              </span>
            ))}
            {Array.from({ length: lead }, (_, i) => (
              <span key={`b${i}`} />
            ))}
            {days.map((day) => {
              const m = shown ? mark(day) : null;
              const isToday = day === today;
              const active = day === picked;
              return (
                <button
                  key={day}
                  type="button"
                  onClick={() => setPicked(active ? null : day)}
                  className={`flex flex-col items-center justify-center gap-1 rounded-xl min-h-[44px] text-sm transition ${
                    active ? "bg-ink text-white" : isToday ? "bg-[var(--mint-tint)] font-bold" : "hover:bg-black/[0.04]"
                  } ${day > today ? "opacity-50" : ""}`}
                  aria-label={`${dayText(day, true)}${m ? `: ${LEGEND.find((x) => x[0] === m)?.[1]}` : ""}`}
                  aria-pressed={active}
                >
                  <span>{Number(day.slice(8))}</span>
                  <span className={`h-1.5 w-1.5 rounded-full ${m ? DOT[m] : "bg-transparent"}`} />
                </button>
              );
            })}
          </div>

          {!shown && <p className="text-sm text-[var(--muted)]">Loading…</p>}

          <div className="flex flex-wrap gap-x-3 gap-y-1">
            {LEGEND.map(([k, label]) => (
              <span key={k} className="inline-flex items-center gap-1.5 text-xs text-[var(--muted)]">
                <span className={`h-2 w-2 rounded-full ${DOT[k]}`} /> {label}
              </span>
            ))}
          </div>

          {picked && shown && (
            <div className="rounded-xl border border-[var(--line)] p-3 space-y-2">
              <p className="font-bold text-sm">{dayText(picked, true)}</p>
              {pickedRow?.checkInAt ? (
                <>
                  <p className="text-sm">
                    In {clock(pickedRow.checkInAt)}
                    {pickedRow.checkOutAt ? ` · Out ${clock(pickedRow.checkOutAt)}` : " · Not checked out"}
                    {pickedRow.late && <span className="st st-out text-[11px] px-2 py-0.5 rounded-full ml-2">Late</span>}
                  </p>
                  <p className="text-xs text-[var(--muted)]">
                    {pickedRow.minutes != null ? `${hoursText(pickedRow.minutes)} worked` : "Hours counted at check out"}
                    {pickedRow.distanceM != null && ` · ${distanceText(pickedRow.distanceM)} travelled`}
                  </p>
                  {(pickedRow.checkInSelfie || pickedRow.checkOutSelfie) && (
                    <div className="flex gap-3">
                      {pickedRow.checkInSelfie && (
                        <a href={fileUrl(pickedRow.checkInSelfie)} target="_blank" rel="noreferrer" className="text-center">
                          <Thumb imageKey={pickedRow.checkInSelfie} className="h-16 w-16" alt="Check-in selfie" />
                          <span className="block text-[11px] text-[var(--muted)] mt-1">In</span>
                        </a>
                      )}
                      {pickedRow.checkOutSelfie && (
                        <a href={fileUrl(pickedRow.checkOutSelfie)} target="_blank" rel="noreferrer" className="text-center">
                          <Thumb imageKey={pickedRow.checkOutSelfie} className="h-16 w-16" alt="Check-out selfie" />
                          <span className="block text-[11px] text-[var(--muted)] mt-1">Out</span>
                        </a>
                      )}
                    </div>
                  )}
                </>
              ) : pickedLeave ? (
                <p className="text-sm">
                  {LEAVE_TYPES[pickedLeave.type as keyof typeof LEAVE_TYPES] ?? "Leave"}
                  {pickedLeave.status === "PENDING" ? " (waiting for approval)" : ""}
                </p>
              ) : (
                <p className="text-sm text-[var(--muted)]">
                  {picked > today ? "This day is still to come." : weekday(picked) === 0 ? "Sunday. No check in." : "No check in on this day."}
                </p>
              )}
            </div>
          )}

          {totals && (
            <div className="grid grid-cols-3 gap-2">
              <Stat label="Present" value={`${totals.present} day${totals.present === 1 ? "" : "s"}`} />
              <Stat label="Late" value={String(totals.late)} />
              <Stat label="Leave" value={`${totals.leaveDays} day${totals.leaveDays === 1 ? "" : "s"}`} />
              <Stat label="Hours" value={hoursText(totals.minutes)} wide />
              <Stat label="Distance" value={distanceText(totals.distanceM)} />
            </div>
          )}
        </>
      )}
    </>
  );
}

function Stat({ label, value, wide }: { label: string; value: string; wide?: boolean }) {
  return (
    <div className={`rounded-xl bg-black/[0.03] px-3 py-2 min-w-0 ${wide ? "col-span-2" : ""}`}>
      <p className="stat-lbl">{label}</p>
      <p className="font-bold text-sm mt-0.5 truncate">{value}</p>
    </div>
  );
}
