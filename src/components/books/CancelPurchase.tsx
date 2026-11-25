"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { errText, Field, send, Sheet } from "@/components/admin/AdminKit";

/** Cancel a purchase bill or note entered by mistake (its entry is reversed). */
export default function CancelPurchase({ id, label }: { id: string; label: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function cancel() {
    setBusy(true);
    setErr(null);
    try {
      await send(`/api/admin/books/purchases/${id}`, "POST", { action: "cancel", reason });
      setOpen(false);
      router.refresh();
    } catch (e) {
      setErr(errText(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <button type="button" className="btn btn-quiet btn-xs text-[var(--risk-text)]" onClick={() => { setErr(null); setOpen(true); }}>
        Cancel this {label}
      </button>
      {open && (
        <Sheet
          title={`Cancel this ${label}`}
          onClose={() => setOpen(false)}
          footer={
            <div className="flex items-center justify-end gap-2">
              <button type="button" className="btn btn-quiet btn-sm" onClick={() => setOpen(false)}>
                Keep it
              </button>
              <button type="button" className="btn btn-sm bg-[var(--risk-text)] text-white" disabled={busy || reason.trim().length < 3} onClick={cancel}>
                {busy ? "Cancelling…" : "Cancel it"}
              </button>
            </div>
          }
        >
          <div className="space-y-3">
            <p className="text-sm text-[var(--ink-2)]">Its entry is reversed and the supplier&apos;s account put back. The document stays in the register, marked cancelled.</p>
            <Field label="Why">
              <input className="input" value={reason} maxLength={200} onChange={(e) => setReason(e.target.value)} autoFocus />
            </Field>
            {err && <p className="text-sm text-[var(--risk-text)]">{err}</p>}
          </div>
        </Sheet>
      )}
    </>
  );
}
