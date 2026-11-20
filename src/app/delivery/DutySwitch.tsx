"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { getLocation } from "@/lib/geo";
import Icon from "@/components/Icon";
import { fieldChanged } from "@/components/field/kit";
import { istTime } from "./maps";

/**
 * On / off duty, one big tap target. The phone asks for location only here
 * (start and end of duty; DutyTracker in the layout records positions while
 * on duty when the business turned tracking on); the server refuses "off"
 * while a trip is running. Going on duty also checks the driver in.
 */
export default function DutySwitch({ onDuty: on0, since: since0 }: { onDuty: boolean; since: string | null }) {
  const router = useRouter();
  const [duty, setDuty] = useState({ onDuty: on0, since: since0 });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function toggle() {
    setBusy(true);
    setError(null);
    try {
      const loc = await getLocation();
      const res = await fetch("/api/delivery/duty", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ on: !duty.onDuty, lat: loc.lat, lng: loc.lng }),
      });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(d.error ?? "Could not change duty. Try again.");
      setDuty({ onDuty: !!d.onDuty, since: d.since ?? null });
      fieldChanged();
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-2">
      <button
        type="button"
        role="switch"
        aria-checked={duty.onDuty}
        aria-label={duty.onDuty ? "On duty. Tap to go off duty" : "Off duty. Tap to go on duty"}
        disabled={busy}
        onClick={toggle}
        className="card w-full p-4 flex items-center gap-3 text-left min-h-[72px] disabled:opacity-70"
      >
        <span
          className={`icon-tile ${duty.onDuty ? "bg-[var(--mint-tint)] text-[var(--mint-text)]" : "bg-black/[0.06] text-[var(--muted)]"}`}
        >
          <Icon name={duty.onDuty ? "truck" : "clock"} />
        </span>
        <span className="flex-1 min-w-0">
          <span className="block font-bold">{busy ? "Saving…" : duty.onDuty ? "On duty" : "Off duty"}</span>
          <span className="block text-xs text-[var(--muted)]">
            {duty.onDuty && duty.since ? `Since ${istTime(duty.since)}` : "Tap to start your day"}
          </span>
        </span>
        <span
          aria-hidden="true"
          className={`relative h-8 w-14 shrink-0 rounded-full transition ${duty.onDuty ? "bg-[var(--mint)]" : "bg-black/15"}`}
        >
          <span
            className={`absolute top-1 h-6 w-6 rounded-full bg-white shadow transition-all ${duty.onDuty ? "left-7" : "left-1"}`}
          />
        </span>
      </button>
      {error && <p className="text-sm text-[#a8281e]">{error}</p>}
      <p className="text-xs text-[var(--muted)] px-1">
        Your location is saved when you go on or off duty. While you are on duty it is also saved every few minutes, but
        only if your business has turned location tracking on. Never off duty. Check out on Attendance to end your day.
      </p>
    </div>
  );
}
