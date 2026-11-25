"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { errText, send } from "@/components/admin/AdminKit";

const todayIst = () => new Date(Date.now() + 5.5 * 3_600_000).toISOString().slice(0, 10);

/** Undo a payment to a supplier: entered by mistake, or our cheque bounced / was stopped. The bills it paid open again. */
export function CancelPayment({ id, cheque }: { id: string; cheque: boolean }) {
  const router = useRouter();
  const [mode, setMode] = useState<"cancel" | "bounce" | null>(null);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function go() {
    setErr(null);
    setBusy(true);
    try {
      await send(`/api/admin/books/payments/${id}`, "POST", {
        action: mode,
        reason,
      });
      setMode(null);
      router.refresh();
    } catch (e) {
      setErr(errText(e));
    } finally {
      setBusy(false);
    }
  }

  if (!mode) {
    return (
      <div className="flex flex-wrap gap-2">
        {cheque && (
          <button type="button" className="btn btn-outline btn-xs" onClick={() => setMode("bounce")}>
            Cheque bounced or stopped
          </button>
        )}
        <button type="button" className="btn btn-quiet btn-xs text-[#a8281e]" onClick={() => setMode("cancel")}>
          Cancel payment
        </button>
      </div>
    );
  }
  return (
    <div className="rounded-xl border border-[var(--line)] p-3 space-y-2">
      <p className="text-sm font-semibold">{mode === "bounce" ? "Our cheque bounced or was stopped" : "Cancel this payment"}</p>
      <p className="text-xs text-[var(--muted)]">The entry is reversed and the bills it paid are open again.</p>
      <input className="input" placeholder="Why?" value={reason} maxLength={200} onChange={(e) => setReason(e.target.value)} />
      {err && <p className="text-sm text-[#a8281e]">{err}</p>}
      <div className="flex justify-end gap-2">
        <button type="button" className="btn btn-quiet btn-xs" onClick={() => setMode(null)}>
          Back
        </button>
        <button type="button" className="btn btn-mor btn-xs" disabled={busy || reason.trim().length < 3} onClick={go}>
          {busy ? "Saving…" : mode === "bounce" ? "Mark bounced" : "Cancel payment"}
        </button>
      </div>
    </div>
  );
}

/** Our bank paid this cheque (when it is not matched from a bank statement). */
export function ClearCheque({ id }: { id: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [date, setDate] = useState(todayIst());
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function go() {
    setErr(null);
    setBusy(true);
    try {
      await send(`/api/admin/books/cheques/${id}`, "POST", {
        action: "clear",
        date,
      });
      setOpen(false);
      router.refresh();
    } catch (e) {
      setErr(errText(e));
    } finally {
      setBusy(false);
    }
  }

  if (!open) {
    return (
      <button type="button" className="btn btn-outline btn-xs" onClick={() => setOpen(true)}>
        Cleared
      </button>
    );
  }
  return (
    <div className="flex flex-wrap items-center gap-2">
      <input type="date" className="input !py-1 !text-sm w-auto" aria-label="Day the bank paid it" value={date} max={todayIst()} onChange={(e) => setDate(e.target.value)} />
      <button type="button" className="btn btn-mor btn-xs" disabled={busy} onClick={go}>
        {busy ? "…" : "Save"}
      </button>
      <button type="button" className="btn btn-quiet btn-xs" onClick={() => setOpen(false)}>
        Back
      </button>
      {err && <p className="w-full text-xs text-[#a8281e]">{err}</p>}
    </div>
  );
}
