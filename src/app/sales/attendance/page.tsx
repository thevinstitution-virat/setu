"use client";

import { useEffect, useState } from "react";

type Attendance = { id: string; date: string; checkInAt: string | null; checkOutAt: string | null };

export default function AttendanceHistory() {
  const [history, setHistory] = useState<Attendance[]>([]);

  useEffect(() => {
    fetch("/api/attendance/today")
      .then((r) => r.json())
      .then((d) => setHistory(d.history ?? []));
  }, []);

  return (
    <div className="space-y-4">
      <h1 className="page-title">Attendance</h1>
      <div className="card divide-y divide-black/5">
        {history.map((a) => (
          <div key={a.id} className="flex items-center justify-between px-4 py-3 text-sm">
            <span className="font-medium">{a.date}</span>
            <span className="text-foreground/50">
              {a.checkInAt ? new Date(a.checkInAt).toLocaleTimeString() : "—"} →{" "}
              {a.checkOutAt ? new Date(a.checkOutAt).toLocaleTimeString() : "—"}
            </span>
          </div>
        ))}
        {history.length === 0 && (
          <p className="text-sm text-foreground/50 px-4 py-3">No attendance recorded yet.</p>
        )}
      </div>
    </div>
  );
}
