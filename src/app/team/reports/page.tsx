"use client";

import { useState } from "react";
import Icon, { type IconName } from "@/components/Icon";
import { Field } from "@/components/admin/AdminKit";
import { daysInclusive, istDay } from "@/lib/field-math";
import { YMD, errorText, shortDay } from "@/components/team/kit";

const MAX_DAYS = 92;

const REPORTS: { kind: string; title: string; sub: string; icon: IconName }[] = [
  { kind: "attendance", title: "Attendance", sub: "Check in and out, hours, late, distance", icon: "clock" },
  { kind: "visits", title: "Shop visits", sub: "Every visit, outcome, no-order reason, order", icon: "pin" },
  { kind: "stores", title: "New shops", sub: "Shops proposed from the field and what was decided", icon: "plus" },
  { kind: "orders", title: "Orders", sub: "Orders placed by the field team", icon: "box" },
];

export default function TeamReportsPage() {
  const [today] = useState(() => istDay());
  const [from, setFrom] = useState(() => `${today.slice(0, 7)}-01`);
  const [to, setTo] = useState(today);

  const valid = YMD.test(from) && YMD.test(to);
  const problem = !valid
    ? "Pick both dates"
    : to < from
      ? "The end date is before the start date"
      : daysInclusive(from, to) > MAX_DAYS
        ? `Reports cover at most ${MAX_DAYS} days`
        : null;

  return (
    <div className="space-y-5">
      <div className="page-head">
        <div className="min-w-0">
          <p className="page-kick">Field team</p>
          <h1 className="page-title">Reports</h1>
          <p className="page-sub">Download your team&apos;s records as spreadsheets (CSV, opens in Excel).</p>
        </div>
      </div>

      <div className="card p-4 space-y-3 sm:max-w-md">
        <div className="grid grid-cols-2 gap-3">
          <Field label="From">
            <input className="input" type="date" value={from} max={today} onChange={(e) => setFrom(e.target.value)} />
          </Field>
          <Field label="To">
            <input className="input" type="date" value={to} max={today} onChange={(e) => setTo(e.target.value)} />
          </Field>
        </div>
        {problem ? (
          <p className={errorText}>{problem}</p>
        ) : (
          <p className="text-xs text-[var(--muted)]">
            {shortDay(from)} to {shortDay(to)} · {daysInclusive(from, to)} days (at most {MAX_DAYS})
          </p>
        )}
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        {REPORTS.map((r) => {
          const inner = (
            <>
              <span className="icon-tile bg-[var(--success-tint)] text-[var(--success-text)] shrink-0">
                <Icon name={r.icon} />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block font-heading font-bold">{r.title}</span>
                <span className="block text-xs text-[var(--muted)]">{r.sub}</span>
              </span>
              <Icon name="download" className="h-5 w-5 shrink-0 text-[var(--accent-text)]" />
            </>
          );
          return problem ? (
            <div key={r.kind} className="card p-4 flex items-center gap-3 opacity-50" aria-disabled="true">
              {inner}
            </div>
          ) : (
            <a
              key={r.kind}
              href={`/api/team/reports?kind=${r.kind}&from=${from}&to=${to}`}
              download={`${r.kind}-${from}-to-${to}.csv`}
              className="card p-4 flex items-center gap-3 min-h-[44px] hover:shadow-lg transition"
            >
              {inner}
            </a>
          );
        })}
      </div>
    </div>
  );
}
