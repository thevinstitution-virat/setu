"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import Icon from "@/components/Icon";
import { ErrorBox, errText, send, useFetch } from "@/components/admin/AdminKit";
import { getLocation } from "@/lib/geo";
import { istMonth } from "@/lib/field-math";
import SelfieCapture from "./SelfieCapture";
import { FIELD_EVENT, clock, distanceText, fieldChanged, hoursText, type AttendanceData } from "./kit";

/**
 * Today's check in / check out. Asks for a selfie and the phone's location
 * when the business rules say so. Drivers are checked in when they go on
 * duty; they check out here after going off duty.
 */
export default function PunchCard() {
  const { data, error, reload } = useFetch<AttendanceData>(`/api/field/attendance?month=${istMonth()}`);
  const [now, setNow] = useState(() => Date.now());
  const [step, setStep] = useState<"in" | "out" | null>(null);
  const [selfie, setSelfie] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 60_000);
    window.addEventListener(FIELD_EVENT, reload);
    return () => {
      clearInterval(t);
      window.removeEventListener(FIELD_EVENT, reload);
    };
  }, [reload]);

  if (error && !data) return <ErrorBox message={error} onRetry={reload} />;
  if (!data) {
    return (
      <div className="card p-4 flex items-center gap-3 min-h-[72px]">
        <span className="icon-tile bg-black/[0.06] text-[var(--muted)]">
          <Icon name="clock" />
        </span>
        <p className="text-sm text-[var(--muted)]">Loading attendance…</p>
      </div>
    );
  }

  const { today, rules } = data;
  const driver = data.user.role === "DELIVERY_AGENT";
  const checkedIn = !!today?.checkInAt;
  const checkedOut = !!today?.checkOutAt;
  const worked = today?.checkInAt
    ? checkedOut
      ? today.minutes ?? Math.round((new Date(today.checkOutAt!).getTime() - new Date(today.checkInAt).getTime()) / 60_000)
      : Math.round((now - new Date(today.checkInAt).getTime()) / 60_000)
    : 0;

  function open(kind: "in" | "out") {
    setErr(null);
    setSelfie(null);
    setStep(kind);
  }

  async function punch(kind: "in" | "out") {
    setErr(null);
    if (rules.selfie && !selfie) return setErr(`Take a selfie to check ${kind}`);
    setBusy(true);
    try {
      const loc = await getLocation();
      if (rules.geo && (loc.lat === undefined || loc.lng === undefined)) {
        throw new Error(`We could not get your location. Turn on location for this app, then check ${kind} again.`);
      }
      await send("/api/field/attendance", "POST", { action: kind, selfie: selfie ?? undefined, ...loc });
      setStep(null);
      setSelfie(null);
      fieldChanged();
    } catch (e) {
      setErr(errText(e));
    } finally {
      setBusy(false);
    }
  }

  const tone = checkedOut
    ? "bg-[var(--success-tint)] text-[var(--success-text)]"
    : checkedIn
      ? "bg-[var(--success-tint)] text-[var(--success-text)]"
      : "bg-[var(--scheme-tint)] text-[var(--scheme-text)]";

  return (
    <div className="card p-4 space-y-3">
      <div className="flex items-start gap-3">
        <span className={`icon-tile ${tone}`}>
          <Icon name={checkedOut ? "check" : "clock"} />
        </span>
        <div className="flex-1 min-w-0">
          <p className="text-xs font-bold uppercase tracking-[0.1em] text-[var(--muted)]">Attendance today</p>
          {checkedIn ? (
            <p className="font-bold text-sm mt-0.5">
              In at {clock(today!.checkInAt!)}
              {checkedOut && ` · Out at ${clock(today!.checkOutAt!)}`}
            </p>
          ) : (
            <p className="font-bold text-sm mt-0.5 text-[var(--muted)]">Not checked in yet</p>
          )}
          <p className="text-xs text-[var(--muted)] mt-0.5">Work starts at {rules.workStart}</p>
        </div>
        {today?.late && <span className="st st-out text-xs px-2.5 py-1 rounded-full shrink-0">Late</span>}
        {checkedOut && !today?.late && (
          <span className="st st-delivered text-xs px-2.5 py-1 rounded-full shrink-0">Day done</span>
        )}
      </div>

      {checkedIn && (
        <div className="grid grid-cols-2 gap-2">
          <div className="rounded-xl bg-black/[0.03] px-3 py-2">
            <p className="stat-lbl">{checkedOut ? "Hours worked" : "Hours so far"}</p>
            <p className="font-bold text-sm mt-0.5">{hoursText(worked)}</p>
          </div>
          <div className="rounded-xl bg-black/[0.03] px-3 py-2">
            <p className="stat-lbl">Distance</p>
            <p className="font-bold text-sm mt-0.5">
              {today?.distanceM != null
                ? distanceText(today.distanceM)
                : rules.trackLocation
                  ? "At check out"
                  : "Not tracked"}
            </p>
          </div>
        </div>
      )}

      {checkedIn && today?.checkInAccuracy != null && (
        <p className="text-xs text-[var(--muted)] flex items-center gap-1">
          <Icon name="pin" className="h-3.5 w-3.5" /> Check-in location saved (±{Math.round(today.checkInAccuracy)} m)
        </p>
      )}

      {/* Actions */}
      {!checkedIn && driver && (
        <div className="rounded-xl bg-[var(--scheme-tint)] text-[var(--scheme-text)] px-3 py-2.5 text-sm space-y-2">
          <p>Going on duty checks you in. Starting a trip does it too.</p>
          <Link href="/delivery" className="btn btn-kesar btn-sm min-h-[44px]">
            Go on duty <Icon name="arrow" className="h-4 w-4" />
          </Link>
        </div>
      )}

      {!checkedIn && !driver && step !== "in" && (
        <button type="button" className="btn btn-kesar w-full min-h-[48px]" onClick={() => (rules.selfie ? open("in") : punch("in"))} disabled={busy}>
          {busy ? "Checking in…" : "Check in"}
        </button>
      )}

      {checkedIn && !checkedOut && step !== "out" && (
        <div className="space-y-2">
          {driver && (
            <p className="text-xs text-[var(--muted)]">Go off duty first, then check out at the end of your day.</p>
          )}
          <button type="button" className="btn btn-quiet w-full min-h-[48px]" onClick={() => (rules.selfie ? open("out") : punch("out"))} disabled={busy}>
            {busy ? "Checking out…" : "Check out"}
          </button>
        </div>
      )}

      {step && (
        <div className="border-t border-[var(--line)] pt-3 space-y-3">
          <p className="text-sm font-semibold">{step === "in" ? "Check in" : "Check out"}</p>
          {rules.selfie && <SelfieCapture value={selfie} onChange={setSelfie} onBusy={setUploading} />}
          {rules.geo && (
            <p className="text-xs text-[var(--muted)] flex items-center gap-1">
              <Icon name="pin" className="h-3.5 w-3.5 shrink-0" /> Your location is saved with this {step === "in" ? "check in" : "check out"}.
            </p>
          )}
          <div className="flex gap-2">
            <button type="button" className="btn btn-quiet flex-1 min-h-[44px]" onClick={() => setStep(null)} disabled={busy}>
              Cancel
            </button>
            <button
              type="button"
              className="btn btn-kesar flex-[2] min-h-[44px]"
              onClick={() => punch(step)}
              disabled={busy || uploading || (rules.selfie && !selfie)}
            >
              {busy ? "Saving…" : step === "in" ? "Confirm check in" : "Confirm check out"}
            </button>
          </div>
        </div>
      )}

      {err && <p className="text-sm text-[var(--risk-text)]">{err}</p>}
    </div>
  );
}
