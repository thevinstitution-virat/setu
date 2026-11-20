"use client";

import { useEffect, useState } from "react";
import Icon from "@/components/Icon";

type Estimate = {
  provider: "google" | "none";
  totalKm: number;
  totalMinutes: number;
  fromDepot: boolean;
  stops: { orderId: string; state: string; km: number; minutes: number }[];
  unpinned: number;
};

const kmText = (km: number) => (km < 10 ? km.toFixed(1).replace(/\.0$/, "") : String(Math.round(km)));
const timeText = (min: number) => (min < 60 ? `${min} min` : `${Math.floor(min / 60)} h${min % 60 ? ` ${min % 60} min` : ""}`);

/**
 * "About X km · Y min" for a trip in its current stop order (office trip page
 * and the driver's trip card). `stopsKey` changes when the stop order does,
 * so the figure is read again. Shows nothing until it loads or if it fails.
 */
export default function RouteEstimate({ tripId, stopsKey, className = "" }: { tripId: string; stopsKey: string; className?: string }) {
  const [est, setEst] = useState<{ key: string; data: Estimate } | null>(null);
  const key = `${tripId}|${stopsKey}`;

  useEffect(() => {
    let live = true;
    fetch(`/api/trips/${tripId}/route-estimate`)
      .then(async (r) => {
        if (!r.ok) return;
        const data = (await r.json()) as Estimate;
        if (live) setEst({ key, data });
      })
      .catch(() => {});
    return () => {
      live = false;
    };
  }, [tripId, key]);

  // Keep the last figure on screen while a new one loads.
  if (!est) return null;
  const d = est.data;
  // One pinned stop and no warehouse: nothing to measure yet.
  const routed = d.totalKm > 0 || d.totalMinutes > 0;
  if (!routed && d.unpinned === 0) return null;

  return (
    <div className={`text-sm ${className}`}>
      {routed && (
        <p className="flex flex-wrap items-center gap-x-1.5 font-semibold text-[var(--ink-2)]">
          <Icon name="route" className="h-4 w-4 shrink-0" />
          About {kmText(d.totalKm)} km · {timeText(d.totalMinutes)}
          {d.fromDepot ? <span className="font-normal text-[var(--muted)]">from the warehouse</span> : null}
        </p>
      )}
      {(d.provider === "none" && routed) || d.unpinned > 0 ? (
        <p className="text-xs text-[var(--muted)] mt-0.5">
          {d.provider === "none" && routed ? "Straight-line estimate" : ""}
          {d.provider === "none" && routed && d.unpinned > 0 ? " · " : ""}
          {d.unpinned > 0 ? `${d.unpinned} stop${d.unpinned === 1 ? " has" : "s have"} no map pin` : ""}
        </p>
      ) : null}
    </div>
  );
}
