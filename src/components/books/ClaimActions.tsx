"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { errText, Field, readRupees, send } from "@/components/admin/AdminKit";
import { formatINR } from "@/lib/money";

const todayIst = () => new Date(Date.now() + 5.5 * 3_600_000).toISOString().slice(0, 10);
type Bank = { id: string; name: string; isDefault: boolean };

function useAct(id: string) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  async function act(body: Record<string, unknown>, done: () => void) {
    setErr(null);
    setBusy(true);
    try {
      await send(`/api/admin/books/claims/${id}`, "POST", body);
      done();
      router.refresh();
    } catch (e) {
      setErr(errText(e));
    } finally {
      setBusy(false);
    }
  }
  return { busy, err, setErr, act };
}

/** Money in against the claim, the rest written off, or the claim cancelled. */
export function ClaimActions({ id, open, raisedOn, banks, canCancel }: { id: string; open: number; raisedOn: string; banks: Bank[]; canCancel: boolean }) {
  const [mode, setMode] = useState<"receive" | "writeoff" | "cancel" | null>(null);
  const [date, setDate] = useState(todayIst());
  const [amount, setAmount] = useState("");
  const [bankId, setBankId] = useState(banks[0]?.id ?? "");
  const [cash, setCash] = useState(false);
  const [reference, setReference] = useState("");
  const [reason, setReason] = useState("");
  const { busy, err, setErr, act } = useAct(id);
  const close = () => {
    setMode(null);
    setAmount("");
    setReason("");
    setReference("");
  };

  if (!mode) {
    return (
      <div className="flex flex-wrap gap-2">
        {open > 0 && (
          <>
            <button type="button" className="btn btn-mor btn-xs" onClick={() => setMode("receive")}>
              Money received
            </button>
            <button type="button" className="btn btn-outline btn-xs" onClick={() => setMode("writeoff")}>
              Rejected / write off
            </button>
          </>
        )}
        {canCancel && (
          <button type="button" className="btn btn-quiet btn-xs text-[#a8281e]" onClick={() => setMode("cancel")}>
            Cancel claim
          </button>
        )}
      </div>
    );
  }

  const amt = readRupees(amount);
  return (
    <div className="rounded-xl border border-[var(--line)] p-3 space-y-3">
      <p className="text-sm font-semibold">{mode === "receive" ? "Money from the company" : mode === "writeoff" ? "Write off what is still open" : "Cancel this claim"}</p>
      <p className="text-xs text-[var(--muted)]">
        {mode === "receive"
          ? "For a credit note from them, enter the note in Purchases instead and pick this claim on its line."
          : mode === "writeoff"
            ? `Leave the amount blank to write off all ${formatINR(open)} still open. It comes off claims income.`
            : "The claim's entry is reversed. Only while nothing has come in against it."}
      </p>
      {mode !== "cancel" && (
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label={mode === "receive" ? "Day it came" : "Day"}>
            <input type="date" className="input" value={date} min={raisedOn} max={todayIst()} onChange={(e) => setDate(e.target.value)} />
          </Field>
          <Field label="Amount (₹)" hint={`${formatINR(open)} open`}>
            <input className="input" inputMode="decimal" value={amount} placeholder={mode === "writeoff" ? "All that is open" : ""} onChange={(e) => setAmount(e.target.value)} />
          </Field>
          {mode === "receive" && (
            <>
              <Field label="Into">
                <select
                  className="input"
                  value={cash ? "cash" : bankId}
                  onChange={(e) => {
                    setCash(e.target.value === "cash");
                    if (e.target.value !== "cash") setBankId(e.target.value);
                  }}
                >
                  {banks.map((b) => (
                    <option key={b.id} value={b.id}>
                      {b.name}
                      {b.isDefault ? " (default)" : ""}
                    </option>
                  ))}
                  <option value="cash">Office cash</option>
                </select>
              </Field>
              <Field label="UTR / reference" hint="Optional.">
                <input className="input" value={reference} maxLength={60} onChange={(e) => setReference(e.target.value)} />
              </Field>
            </>
          )}
        </div>
      )}
      {mode !== "receive" && <input className="input" placeholder="Why?" aria-label="Why" value={reason} maxLength={200} onChange={(e) => setReason(e.target.value)} />}
      {err && <p className="text-sm text-[#a8281e]">{err}</p>}
      <div className="flex justify-end gap-2">
        <button type="button" className="btn btn-quiet btn-xs" onClick={close}>
          Back
        </button>
        <button
          type="button"
          className="btn btn-mor btn-xs"
          disabled={busy || (mode !== "receive" && reason.trim().length < 3) || (mode === "receive" && !amt)}
          onClick={() => {
            if (amt === "bad") return setErr("Write the amount in rupees");
            if (mode === "receive") act({ action: "receive", date, amount: amt, bankAccountId: cash ? null : bankId, cash, reference }, close);
            else if (mode === "writeoff") act({ action: "writeoff", date, amount: amt, reason }, close);
            else act({ action: "cancel", reason }, close);
          }}
        >
          {busy ? "Saving…" : mode === "receive" ? "Save" : mode === "writeoff" ? "Write off" : "Cancel claim"}
        </button>
      </div>
    </div>
  );
}

/** Undo money received or a write-off entered by mistake. */
export function UndoSettlement({ claimId, settlementId }: { claimId: string; settlementId: string }) {
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  const { busy, err, act } = useAct(claimId);
  if (!open)
    return (
      <button type="button" className="btn btn-quiet btn-xs" onClick={() => setOpen(true)}>
        Undo
      </button>
    );
  return (
    <div className="flex flex-wrap items-center gap-2 w-full">
      <input className="input !py-1 !text-sm flex-1 min-w-40" placeholder="Why?" aria-label="Why undo" value={reason} maxLength={200} onChange={(e) => setReason(e.target.value)} />
      <button type="button" className="btn btn-mor btn-xs" disabled={busy || reason.trim().length < 3} onClick={() => act({ action: "undo", settlementId, reason }, () => setOpen(false))}>
        {busy ? "…" : "Undo"}
      </button>
      <button type="button" className="btn btn-quiet btn-xs" onClick={() => setOpen(false)}>
        Back
      </button>
      {err && <p className="w-full text-xs text-[#a8281e]">{err}</p>}
    </div>
  );
}
