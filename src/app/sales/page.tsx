"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { getLocation } from "@/lib/geo";

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

  return (
    <div className="space-y-6">
      <h1 className="text-xl font-semibold">Today</h1>

      <div className="card p-4 flex items-center justify-between">
        <div>
          <p className="text-sm text-foreground/50">Attendance</p>
          {attendance?.checkInAt ? (
            <p className="font-medium text-sm">
              In at {new Date(attendance.checkInAt).toLocaleTimeString()}
              {attendance.checkOutAt &&
                ` · Out at ${new Date(attendance.checkOutAt).toLocaleTimeString()}`}
            </p>
          ) : (
            <p className="font-medium text-sm text-foreground/40">Not checked in</p>
          )}
        </div>
        {!attendance?.checkInAt ? (
          <button
            onClick={checkIn}
            disabled={loading}
            className="rounded-xl bg-brand text-white font-medium px-4 py-2 text-sm"
          >
            Check in
          </button>
        ) : !attendance.checkOutAt ? (
          <button
            onClick={checkOut}
            disabled={loading}
            className="rounded-xl bg-black/5 font-medium px-4 py-2 text-sm"
          >
            Check out
          </button>
        ) : (
          <span className="text-xs text-emerald-700 font-medium">Day complete</span>
        )}
      </div>

      <Link href="/sales/beat" className="card p-4 flex items-center justify-between">
        <div>
          <p className="text-sm text-foreground/50">Today&apos;s beat</p>
          <p className="font-medium">
            {visitedToday} / {retailers.length} retailers visited
          </p>
        </div>
        <span className="text-brand-dark text-sm font-medium">Open →</span>
      </Link>
    </div>
  );
}
