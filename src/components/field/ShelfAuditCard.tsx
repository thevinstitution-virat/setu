"use client";

import { useCallback, useEffect, useState } from "react";
import Icon from "@/components/Icon";
import { compressImage, uploadFile } from "@/lib/upload-client";
import { shelfShare } from "@/lib/photo-rules";

type Audit = { id: string; ours: number; others: number; empty: number; share: number | null; source: string; createdAt: string; by: string };
type Read = { ours: number; others: number; empty: number; seen: { id: string; name: string }[]; note: string };
type Counts = { ours: string; others: string; empty: string };

const day = (s: string) => new Date(s).toLocaleDateString("en-IN", { day: "numeric", month: "short", timeZone: "Asia/Kolkata" });
const blank: Counts = { ours: "", others: "", empty: "" };

async function json<T>(res: Response): Promise<T> {
  const d = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(d.error ?? "Something went wrong");
  return d as T;
}

/**
 * A10 shelf audit at a shop: a photo of the shelf, then our facings, other
 * brands' and empty slots. With AI the counts are filled from the photo
 * first; the agent checks and corrects them before saving.
 */
export default function ShelfAuditCard({ retailerId, visitId }: { retailerId: string; visitId?: string | null }) {
  const [state, setState] = useState<{ on: boolean; audits: Audit[] } | null>(null);
  const [open, setOpen] = useState(false);
  const [photo, setPhoto] = useState<{ key: string; url: string } | null>(null);
  const [reading, setReading] = useState(false);
  const [read, setRead] = useState<Read | null>(null);
  const [readNote, setReadNote] = useState<string | null>(null);
  const [counts, setCounts] = useState<Counts>(blank);
  const [seen, setSeen] = useState<Set<string>>(new Set());
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);

  const load = useCallback(async () => {
    const r = await fetch(`/api/field/shelf-audits?retailerId=${encodeURIComponent(retailerId)}`);
    setState(r.ok ? await r.json() : null);
  }, [retailerId]);

  useEffect(() => {
    let live = true;
    fetch(`/api/field/shelf-audits?retailerId=${encodeURIComponent(retailerId)}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => live && setState(d))
      .catch(() => live && setState(null));
    return () => {
      live = false;
    };
  }, [retailerId]);

  function reset() {
    if (photo) URL.revokeObjectURL(photo.url);
    setPhoto(null);
    setRead(null);
    setReadNote(null);
    setCounts(blank);
    setSeen(new Set());
    setErr(null);
  }

  async function takePhoto(file: File | null) {
    if (!file) return;
    reset();
    setReading(true);
    try {
      const blob = await compressImage(file);
      const key = await uploadFile(blob, "shelf-photo");
      setPhoto({ key, url: URL.createObjectURL(blob) });
      const r = await json<{ read: Read | null; message?: string }>(
        await fetch("/api/field/shelf-audits/read", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ retailerId, photoKey: key }) })
      );
      if (r.read) {
        setRead(r.read);
        setCounts({ ours: String(r.read.ours), others: String(r.read.others), empty: String(r.read.empty) });
        setSeen(new Set(r.read.seen.map((p) => p.id)));
      } else setReadNote(r.message ?? "Type the counts in");
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Couldn't upload the photo");
    } finally {
      setReading(false);
    }
  }

  async function save() {
    if (!photo) return setErr("Take a photo of the shelf first");
    const n = { ours: Number(counts.ours), others: Number(counts.others), empty: Number(counts.empty) };
    if (Object.values(counts).some((v) => v.trim() === "") || Object.values(n).some((v) => !Number.isInteger(v) || v < 0 || v > 1000)) return setErr("Enter each count as a whole number from 0 to 1000");
    setSaving(true);
    setErr(null);
    try {
      await json(
        await fetch("/api/field/shelf-audits", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ retailerId, visitId: visitId ?? null, photoKey: photo.key, ...n, seen: [...seen], read: read ? { ours: read.ours, others: read.others, empty: read.empty } : null }),
        })
      );
      const share = shelfShare(n.ours, n.others);
      setDone(`Shelf audit saved${share !== null ? `: our share ${share}%` : ""}${n.empty ? `, ${n.empty} empty slots` : ""}.`);
      reset();
      setOpen(false);
      await load();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Couldn't save");
    } finally {
      setSaving(false);
    }
  }

  if (!state?.on) return null;
  const last = state.audits[0];
  const field = (k: keyof Counts, label: string) => (
    <label className="block text-xs font-semibold text-[var(--ink-2)]">
      {label}
      <input className="input mt-1 tabular-nums" inputMode="numeric" pattern="[0-9]*" maxLength={4} value={counts[k]} onChange={(e) => setCounts({ ...counts, [k]: e.target.value.replace(/\D/g, "") })} />
    </label>
  );

  return (
    <div className="card p-4 space-y-3" aria-label="Shelf audit">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-sm font-semibold">Shelf audit</p>
          <p className="text-xs text-[var(--muted)]">
            {last
              ? `Last on ${day(last.createdAt)} by ${last.by}: ${last.share !== null ? `our share ${last.share}%` : "no facings counted"}${last.empty ? ` · ${last.empty} empty slots` : ""}`
              : "No audit here yet. Photograph the shelf and count our facings."}
          </p>
        </div>
        {!open && (
          <button type="button" className="btn btn-quiet btn-sm shrink-0" onClick={() => (setOpen(true), setDone(null))}>
            <Icon name="camera" className="h-4 w-4" /> Audit shelf
          </button>
        )}
      </div>
      {done && <p className="text-sm font-semibold text-[var(--success-text)]">{done}</p>}

      {open && (
        <div className="border-t border-black/5 pt-3 space-y-3">
          <label className="block text-xs font-semibold text-[var(--ink-2)]">
            Photo of the shelf
            <input type="file" accept="image/*" capture="environment" className="block text-sm mt-1" onChange={(e) => takePhoto(e.target.files?.[0] ?? null)} disabled={reading || saving} />
          </label>
          {reading && <p className="text-sm text-[var(--muted)]">Reading the photo…</p>}
          {photo && (
            <div className="flex gap-3">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={photo.url} alt="Shelf photo" className="h-24 w-24 shrink-0 rounded-xl object-cover border border-[var(--line)]" />
              <div className="min-w-0 text-xs text-[var(--muted)] space-y-1">
                {read ? (
                  <>
                    <p className="flex items-center gap-1 font-semibold text-[var(--ink-2)]">
                      <Icon name="sparkle" className="h-3.5 w-3.5" /> Counted from the photo. Check and correct.
                    </p>
                    {read.note && <p>{read.note}</p>}
                  </>
                ) : (
                  readNote && <p>{readNote}</p>
                )}
              </div>
            </div>
          )}
          {photo && (
            <>
              <div className="grid grid-cols-3 gap-2">
                {field("ours", "Our facings")}
                {field("others", "Other brands")}
                {field("empty", "Empty slots")}
              </div>
              {read && read.seen.length > 0 && (
                <div className="space-y-1">
                  <p className="text-xs font-semibold text-[var(--ink-2)]">Our products on the shelf</p>
                  <div className="flex flex-wrap gap-1.5">
                    {read.seen.map((p) => {
                      const on = seen.has(p.id);
                      return (
                        <button
                          key={p.id}
                          type="button"
                          aria-pressed={on}
                          className={`chip text-xs ${on ? "chip-mint" : "opacity-60 line-through"}`}
                          onClick={() => {
                            const next = new Set(seen);
                            if (on) next.delete(p.id);
                            else next.add(p.id);
                            setSeen(next);
                          }}
                        >
                          {p.name}
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}
            </>
          )}
          {err && <p className="text-sm text-[var(--risk-text)]">{err}</p>}
          <div className="flex gap-2">
            <button type="button" className="btn btn-quiet flex-1" onClick={() => (reset(), setOpen(false))} disabled={saving}>
              Cancel
            </button>
            <button type="button" className="btn btn-mor flex-[2]" onClick={save} disabled={!photo || reading || saving}>
              {saving ? "Saving…" : "Save audit"}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
