"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { getLocation } from "@/lib/geo";

type Retailer = {
  id: string;
  outletName: string;
  shopNumber: string;
  area: { name: string };
  visits: { id: string; checkInAt: string; checkOutAt: string | null }[];
};

export default function BeatPage() {
  const [retailers, setRetailers] = useState<Retailer[]>([]);
  const [busyId, setBusyId] = useState<string | null>(null);

  async function load() {
    const d = await fetch("/api/sales/beat").then((r) => r.json());
    setRetailers(d.retailers ?? []);
  }

  useEffect(() => {
    load();
  }, []);

  async function checkIn(retailerId: string) {
    setBusyId(retailerId);
    const loc = await getLocation();
    await fetch("/api/visits", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ retailerId, ...loc }),
    });
    await load();
    setBusyId(null);
  }

  return (
    <div className="space-y-4">
      <h1 className="text-xl font-semibold">Today&apos;s beat</h1>
      <div className="space-y-3">
        {retailers.map((r) => {
          const visit = r.visits[0];
          return (
            <div key={r.id} className="card p-4 flex items-center justify-between gap-3">
              <Link href={`/sales/retailers/${r.id}`} className="min-w-0">
                <p className="font-medium text-sm truncate">{r.outletName}</p>
                <p className="text-xs text-foreground/50">
                  Shop {r.shopNumber} · {r.area.name}
                </p>
                {visit && (
                  <p className="text-xs text-brand-dark mt-1">
                    Visited {new Date(visit.checkInAt).toLocaleTimeString()}
                    {visit.checkOutAt ? " · Checked out" : ""}
                  </p>
                )}
              </Link>
              {!visit ? (
                <button
                  onClick={() => checkIn(r.id)}
                  disabled={busyId === r.id}
                  className="shrink-0 rounded-xl bg-brand text-white text-sm font-medium px-3 py-2"
                >
                  Check in
                </button>
              ) : (
                <Link
                  href={`/sales/retailers/${r.id}`}
                  className="shrink-0 rounded-xl bg-black/5 text-sm font-medium px-3 py-2"
                >
                  Open
                </Link>
              )}
            </div>
          );
        })}
        {retailers.length === 0 && (
          <p className="text-sm text-foreground/50">No retailers assigned to you yet.</p>
        )}
      </div>
    </div>
  );
}
