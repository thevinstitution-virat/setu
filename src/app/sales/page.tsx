"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { getLocation } from "@/lib/geo";
import Icon from "@/components/Icon";

type Attendance = { checkInAt: string | null; checkOutAt: string | null } | null;
type Retailer = { id: string; visits: { checkOutAt: string | null }[] };

export default function SalesToday() {
  const [attendance, setAttendance] = useState<Attendance>(null);
  const [retailers, setRetailers] = useState<Retailer[]>([]);
  const [loading, setLoading] = useState(false);

  async function load() {
    const [a, b] = await Promise.all([
      fetch("/api/attendance/today").then((r) => r.json()),
      fetch("/api/sales/beat").then((r) => r.json()),
    ]);
    setAttendance(a.attendance);
    setRetailers(b.retailers ?? []);
  }

  useEffect(() => {
    load();
  }, []);

  async function checkIn() {
    setLoading(true);
    const loc = await getLocation();
    await fetch("/api/attendance/today", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "checkin", ...loc }),
    });
    await load();
    setLoading(false);
  }

  async function checkOut() {
    setLoading(true);
    await fetch("/api/attendance/today", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "checkout" }),
    });
    await load();
    setLoading(false);
  }

  const visitedToday = retailers.filter((r) => r.visits.length > 0).length;

  const pct = retailers.length ? Math.round((visitedToday / retailers.length) * 100) : 0;

  return (
    <div className="space-y-6">
      <div>
        <p className="page-kick">Sales beat</p>
        <h1 className="page-title">Today</h1>
      </div>

      <div className="card p-4 flex items-center gap-3">
        <span
          className={`icon-tile ${
            attendance?.checkInAt
              ? "bg-[var(--mint-tint)] text-[var(--mint-text)]"
              : "bg-[var(--genda-tint)] text-[var(--genda-text)]"
          }`}
        >
          <Icon name="clock" />
        </span>
        <div className="flex-1 min-w-0">
          <p className="text-xs font-bold uppercase tracking-[0.1em] text-[var(--muted)]">Attendance</p>
          {attendance?.checkInAt ? (
            <p className="font-bold text-sm mt-0.5">
              In at {new Date(attendance.checkInAt).toLocaleTimeString()}
              {attendance.checkOutAt &&
                ` · Out at ${new Date(attendance.checkOutAt).toLocaleTimeString()}`}
            </p>
          ) : (
            <p className="font-bold text-sm mt-0.5 text-[var(--muted)]">Not checked in</p>
          )}
        </div>
        {!attendance?.checkInAt ? (
          <button
            onClick={checkIn}
            disabled={loading}
            className="btn btn-kesar btn-sm"
          >
            Check in
          </button>
        ) : !attendance.checkOutAt ? (
          <button
            onClick={checkOut}
            disabled={loading}
            className="btn btn-quiet btn-sm"
          >
            Check out
          </button>
        ) : (
          <span className="st st-delivered text-xs px-2.5 py-1 rounded-full">Day complete</span>
        )}
      </div>

      <Link href="/sales/beat" className="panel-dark p-5 block hover:-translate-y-0.5 transition">
        <div className="flex items-center justify-between gap-3">
          <div>
            <p className="text-xs font-bold uppercase tracking-[0.12em] text-genda">Today&apos;s beat</p>
            <p className="font-heading font-bold text-xl mt-1">
              {visitedToday} / {retailers.length} retailers visited
            </p>
          </div>
          <span className="btn btn-kesar btn-sm">
            Open <Icon name="arrow" className="h-4 w-4" />
          </span>
        </div>
        <div className="mt-4 h-2 rounded-full bg-white/15 overflow-hidden">
          <div
            className="h-full rounded-full bg-[var(--genda)] transition-all"
            style={{ width: `${pct}%` }}
          />
        </div>
      </Link>
    </div>
  );
}
