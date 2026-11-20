"use client";

import { useEffect } from "react";
import { FIELD_EVENT } from "./kit";

/**
 * Records the phone's position while the person is on duty, and only when
 * the business turned tracking on (rules.trackLocation). Never off duty.
 *
 * Positions are queued in memory and in localStorage (so a reload or a dead
 * network does not lose them) and sent in batches to POST /api/field/pings.
 * A 409 means tracking is off or the person is off duty: stop and drop the
 * queue. Duty is re-checked every few minutes, when the tab comes back to
 * the front and when another card says something changed (FIELD_EVENT).
 *
 * NOTE: a web page can only do this while it is open and in the front.
 * Browsers pause timers and location in background tabs and when the screen
 * is off, so all-day background tracking needs the Android wrapper app
 * (which sends its own pings with source "android").
 */

type Ping = { at: string; lat: number; lng: number; accuracy: number | null; battery: number | null };
type Status = { userId: string | null; onDuty: boolean; track: boolean; minutes: number };

const STORE = "setu.field.pings";
const RECHECK_MS = 3 * 60_000;
const BATCH = 100;
const MAX_QUEUE = 500;

type BatteryLike = { level: number };
type NavigatorWithBattery = Navigator & { getBattery?: () => Promise<BatteryLike> };

function readStore(): { userId: string | null; pings: Ping[] } {
  try {
    const raw = window.localStorage.getItem(STORE);
    if (!raw) return { userId: null, pings: [] };
    const v = JSON.parse(raw) as { userId?: string; pings?: Ping[] };
    return { userId: v.userId ?? null, pings: Array.isArray(v.pings) ? v.pings : [] };
  } catch {
    return { userId: null, pings: [] };
  }
}

function writeStore(userId: string | null, pings: Ping[]) {
  try {
    if (!pings.length) window.localStorage.removeItem(STORE);
    else window.localStorage.setItem(STORE, JSON.stringify({ userId, pings }));
  } catch {
    // Storage full or blocked: the in-memory queue still works.
  }
}

async function battery(): Promise<number | null> {
  try {
    const nav = navigator as NavigatorWithBattery;
    if (!nav.getBattery) return null;
    const b = await nav.getBattery();
    return Math.round(b.level * 100);
  } catch {
    return null;
  }
}

function position(): Promise<GeolocationPosition | null> {
  return new Promise((resolve) => {
    if (!("geolocation" in navigator)) return resolve(null);
    navigator.geolocation.getCurrentPosition(resolve, () => resolve(null), {
      enableHighAccuracy: true,
      timeout: 20_000,
      maximumAge: 60_000,
    });
  });
}

export default function DutyTracker() {
  useEffect(() => {
    let alive = true;
    let status: Status = { userId: null, onDuty: false, track: false, minutes: 5 };
    let queue: Ping[] = [];
    let pingTimer: ReturnType<typeof setInterval> | null = null;
    let sending = false;

    const stored = readStore();
    queue = stored.pings;
    let queueUser = stored.userId;

    const tracking = () => status.onDuty && status.track;

    function stopPings() {
      if (pingTimer) clearInterval(pingTimer);
      pingTimer = null;
    }

    function dropQueue() {
      queue = [];
      writeStore(status.userId, queue);
    }

    async function flush() {
      if (sending || !queue.length || !alive) return;
      if (typeof navigator !== "undefined" && navigator.onLine === false) return;
      sending = true;
      try {
        while (queue.length && alive) {
          const batch = queue.slice(0, BATCH);
          let res: Response;
          try {
            res = await fetch("/api/field/pings", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ source: "app", pings: batch }),
            });
          } catch {
            return; // offline: keep the queue, try again on the next tick or "online"
          }
          if (res.status === 409) {
            // Tracking off or off duty: the server keeps nothing more from us.
            status = { ...status, onDuty: false };
            stopPings();
            dropQueue();
            return;
          }
          if (!res.ok && res.status !== 400) return; // server trouble: retry later
          // Saved (or rejected as bad data): either way don't send them again.
          queue = queue.slice(batch.length);
          writeStore(status.userId, queue);
        }
      } finally {
        sending = false;
      }
    }

    async function takePing() {
      if (!alive || !tracking()) return;
      const pos = await position();
      if (!pos || !alive || !tracking()) return;
      queue.push({
        at: new Date(pos.timestamp || Date.now()).toISOString(),
        lat: pos.coords.latitude,
        lng: pos.coords.longitude,
        accuracy: Number.isFinite(pos.coords.accuracy) ? Math.round(pos.coords.accuracy) : null,
        battery: await battery(),
      });
      if (queue.length > MAX_QUEUE) queue = queue.slice(-MAX_QUEUE);
      writeStore(status.userId, queue);
      await flush();
    }

    function startPings() {
      stopPings();
      void takePing();
      pingTimer = setInterval(() => void takePing(), Math.max(1, status.minutes) * 60_000);
    }

    async function check() {
      try {
        const res = await fetch("/api/field/attendance?lite=1", { cache: "no-store" });
        if (!res.ok) return;
        const d = (await res.json()) as {
          userId?: string;
          today: { userId: string } | null;
          onDuty: boolean;
          rules: { trackLocation: boolean; pingMinutes: number };
        };
        if (!alive) return;
        const was = status;
        status = {
          userId: d.userId ?? d.today?.userId ?? was.userId,
          onDuty: !!d.onDuty,
          track: !!d.rules?.trackLocation,
          minutes: d.rules?.pingMinutes || 5,
        };
        // Positions left from another person on this phone are not ours to send.
        if (queueUser && status.userId && queueUser !== status.userId) {
          queue = [];
          writeStore(status.userId, queue);
        }
        queueUser = status.userId;
        if (!tracking()) {
          stopPings();
          if (!status.track) dropQueue();
          return;
        }
        if (!pingTimer || was.minutes !== status.minutes || !(was.onDuty && was.track)) startPings();
        void flush();
      } catch {
        // offline: the next check will try again
      }
    }

    void check();
    const recheck = setInterval(() => void check(), RECHECK_MS);
    const onVisible = () => {
      if (document.visibilityState === "visible") void check();
    };
    const onOnline = () => void flush();
    const onChange = () => void check();
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("online", onOnline);
    window.addEventListener(FIELD_EVENT, onChange);

    return () => {
      alive = false;
      stopPings();
      clearInterval(recheck);
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("online", onOnline);
      window.removeEventListener(FIELD_EVENT, onChange);
    };
  }, []);

  return null;
}
