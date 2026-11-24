"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { errText, send } from "@/components/admin/AdminKit";
import { showDay } from "@/components/books/fmt";

/** Close the books up to a day; only the owner can open closed days again. */
export default function LockCard({ lockedUntil, today, canLock, isOwner }: { lockedUntil: string | null; today: string; canLock: boolean; isOwner: boolean }) {
  const router = useRouter();
  const [until, setUntil] = useState(lockedUntil ?? "");
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);

  async function save(value: string | null) {
    setBusy(true);
    setNote(null);
    try {
      await send("/api/admin/books/lock", "POST", { until: value });
      setNote(value ? `Closed up to ${showDay(value)}` : "All days are open");
      router.refresh();
    } catch (e) {
      setNote(errText(e));
    } finally {
      setBusy(false);
    }
  }

  const moving = until && until !== lockedUntil;
  const opening = !!lockedUntil && (!until || until < lockedUntil);

  return (
    <section className="card p-4 space-y-3">
      <div>
        <h2 className="font-heading font-bold text-[var(--ink)]">Close the books</h2>
        <p className="text-xs text-[var(--muted)] mt-0.5">
          {lockedUntil ? `Closed up to ${showDay(lockedUntil)}: nothing dated on or before it can be entered or reversed.` : "All days are open. Close a month once it is checked and filed."}
        </p>
      </div>
      {canLock ? (
        <div className="flex flex-wrap items-end gap-2">
          <label className="text-xs text-[var(--muted)]">
            Closed up to
            <input type="date" className="input !py-1.5 mt-1 block" value={until} max={today} min={isOwner ? undefined : lockedUntil ?? undefined} onChange={(e) => setUntil(e.target.value)} disabled={busy} />
          </label>
          <button type="button" className="btn btn-mor btn-sm" disabled={busy || !moving || (opening && !isOwner)} onClick={() => save(until)}>
            Save
          </button>
          {lockedUntil && isOwner && (
            <button type="button" className="btn btn-quiet btn-sm" disabled={busy} onClick={() => save(null)}>
              Open all days
            </button>
          )}
        </div>
      ) : null}
      {canLock && !isOwner && lockedUntil && <p className="text-xs text-[var(--muted)]">You can close more days; only the owner can open closed days again.</p>}
      {note && <p className="text-xs text-[var(--muted)]">{note}</p>}
    </section>
  );
}
