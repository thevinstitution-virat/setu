"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { errText, Field, send } from "@/components/admin/AdminKit";

/** Cancel a voucher entered by mistake: its entry is reversed. */
export default function CancelVoucher({ id, number }: { id: string; number: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function go() {
    setErr(null);
    setBusy(true);
    try {
      await send(`/api/admin/books/vouchers/${id}`, "POST", { action: "cancel", reason });
      setOpen(false);
      router.refresh();
    } catch (e) {
      setErr(errText(e));
    } finally {
      setBusy(false);
    }
  }

  if (!open)
    return (
      <button type="button" className="btn btn-quiet btn-xs" onClick={() => setOpen(true)}>
        Cancel voucher
      </button>
    );
  return (
    <div className="rounded-xl bg-ink/5 p-3 space-y-3 max-w-lg">
      <p className="text-sm text-[var(--ink-2)]">Cancelling {number} reverses its entry. Enter it again if the amount or head was wrong.</p>
      <Field label="Why">
        <input className="input" value={reason} maxLength={200} onChange={(e) => setReason(e.target.value)} placeholder="e.g. Entered twice" />
      </Field>
      {err && <p className="text-sm text-[#a8281e]">{err}</p>}
      <div className="flex gap-2">
        <button type="button" className="btn btn-danger btn-sm" disabled={busy || reason.trim().length < 3} onClick={go}>
          {busy ? "Cancelling…" : "Cancel voucher"}
        </button>
        <button type="button" className="btn btn-quiet btn-sm" disabled={busy} onClick={() => setOpen(false)}>
          Keep it
        </button>
      </div>
    </div>
  );
}
