"use client";

import { useRouter } from "next/navigation";
import { useRef, useState } from "react";
import Icon from "@/components/Icon";
import { errText, send } from "@/components/admin/AdminKit";

/** Cancel a month's GST settlement (its entry is reversed today). */
export function CancelGst({ id, label }: { id: string; label: string }) {
  const router = useRouter();
  const [ask, setAsk] = useState(false);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  async function go() {
    setBusy(true);
    setErr(null);
    try {
      await send("/api/admin/books/gst/cancel", "POST", { id, reason });
      router.refresh();
    } catch (e) {
      setErr(errText(e));
    } finally {
      setBusy(false);
    }
  }
  if (!ask)
    return (
      <button type="button" className="btn btn-quiet btn-sm" onClick={() => setAsk(true)}>
        Cancel this settlement
      </button>
    );
  return (
    <div className="rounded-xl bg-ink/5 p-3 space-y-2 max-w-lg">
      <p className="text-sm text-[var(--ink-2)]">The entry for {label} is reversed today and the month can be settled again. Only the latest settled month can be cancelled.</p>
      <input className="input" placeholder="Why" value={reason} maxLength={200} onChange={(e) => setReason(e.target.value)} />
      {err && <p className="text-sm text-[var(--risk-text)]">{err}</p>}
      <div className="flex gap-2">
        <button type="button" className="btn btn-mor btn-sm" disabled={busy || !reason.trim()} onClick={go}>
          {busy ? "Cancelling…" : "Yes, cancel it"}
        </button>
        <button type="button" className="btn btn-quiet btn-sm" disabled={busy} onClick={() => setAsk(false)}>
          Back
        </button>
      </div>
    </div>
  );
}

/** Upload (or replace, or remove) a month's GSTR-2B file. */
export function Upload2b({ period, label, has }: { period: string; label: string; has: boolean }) {
  const router = useRouter();
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);

  async function upload(file: File) {
    setBusy(true);
    setErr(null);
    setDone(null);
    try {
      const fd = new FormData();
      fd.set("period", period);
      fd.set("file", file);
      const res = await fetch("/api/admin/books/gst/2b", { method: "POST", body: fd });
      const j = (await res.json().catch(() => ({}))) as { error?: string; rows?: number; skipped?: number };
      if (!res.ok) throw new Error(j.error ?? "Upload failed");
      setDone(`Read ${j.rows} documents${j.skipped ? ` (${j.skipped} rows skipped: no GSTIN or number)` : ""}.`);
      router.refresh();
    } catch (e) {
      setErr(errText(e));
    } finally {
      setBusy(false);
      if (input.current) input.current.value = "";
    }
  }
  async function remove() {
    setBusy(true);
    setErr(null);
    try {
      await send(`/api/admin/books/gst/2b?period=${period}`, "DELETE");
      router.refresh();
    } catch (e) {
      setErr(errText(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="space-y-2">
      <input
        ref={input}
        type="file"
        accept=".json,.xlsx,.csv,application/json,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
        className="hidden"
        onChange={(e) => e.target.files?.[0] && upload(e.target.files[0])}
      />
      <div className="flex flex-wrap gap-2">
        <button type="button" className="btn btn-mor btn-sm" disabled={busy} onClick={() => input.current?.click()}>
          <Icon name="file" className="h-4 w-4" /> {busy ? "Reading…" : has ? `Upload ${label}'s 2B again` : `Upload ${label}'s GSTR-2B`}
        </button>
        {has && (
          <button type="button" className="btn btn-quiet btn-sm" disabled={busy} onClick={remove}>
            Remove it
          </button>
        )}
      </div>
      {err && <p className="text-sm text-[var(--risk-text)]">{err}</p>}
      {done && <p className="text-sm text-[#2e7d4f]">{done}</p>}
    </div>
  );
}
