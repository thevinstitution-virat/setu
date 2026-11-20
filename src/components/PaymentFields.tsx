"use client";

import { useEffect, useState } from "react";
import { toPaise } from "@/lib/money";
import { compressImage, uploadFile } from "@/lib/upload-client";

/**
 * Shared payment-entry fields (cash / UPI / cheque / bank) for the office,
 * delivery and sales screens. Controlled: the page owns the value and turns
 * it into an API body with toCollectBody() when it submits.
 */

export type CollectMethod = "CASH" | "UPI" | "CHEQUE" | "BANK";

export type PaymentValue = {
  method: CollectMethod | null;
  /** Rupees as typed, e.g. "1250.50". */
  amount: string;
  reference: string;
  chequeNumber: string;
  bank: string;
  /** YYYY-MM-DD */
  chequeDate: string;
  proof: File | null;
};

export function emptyPayment(amountPaise?: number, method: CollectMethod | null = "CASH"): PaymentValue {
  return {
    method,
    amount: amountPaise ? (amountPaise / 100).toFixed(2).replace(/\.00$/, "") : "",
    reference: "",
    chequeNumber: "",
    bank: "",
    chequeDate: new Date(Date.now() + 5.5 * 3_600_000).toISOString().slice(0, 10),
    proof: null,
  };
}

const LABEL: Record<CollectMethod, string> = { CASH: "Cash", UPI: "UPI", CHEQUE: "Cheque", BANK: "Bank" };

/** Client-side check before submit; the server checks again. Returns an error or null. */
export function paymentError(v: PaymentValue): string | null {
  if (!v.method) return null;
  let p: number;
  try {
    p = toPaise(v.amount);
  } catch {
    return "Enter the amount";
  }
  if (p <= 0) return "Enter the amount";
  if (v.method === "UPI" && !/^[A-Za-z0-9]{6,30}$/.test(v.reference.trim())) return "Enter the UPI reference (UTR) number";
  if (v.method === "CHEQUE") {
    if (!/^\d{6}$/.test(v.chequeNumber.trim())) return "Cheque number must be 6 digits";
    if (v.bank.trim().length < 2) return "Enter the bank name";
    if (!v.chequeDate) return "Enter the cheque date";
  }
  return null;
}

/** Uploads the proof photo (if any) and returns the `collect` body for the API, or null for "no payment". */
export async function toCollectBody(v: PaymentValue) {
  if (!v.method) return null;
  const proofKey = v.proof ? await uploadFile(await compressImage(v.proof), "payment-proof") : null;
  return {
    method: v.method,
    amount: toPaise(v.amount),
    reference: v.reference.trim() || undefined,
    proofKey,
    cheque: v.method === "CHEQUE" ? { number: v.chequeNumber.trim(), bank: v.bank.trim(), date: v.chequeDate } : undefined,
  };
}

export default function PaymentFields({
  value,
  onChangeAction: onChange,
  methods = ["CASH", "UPI", "CHEQUE"],
  allowNone,
  noneLabel = "Not paid now",
  hint,
  field,
}: {
  value: PaymentValue;
  onChangeAction: (v: PaymentValue) => void;
  methods?: CollectMethod[];
  /** Show a "not paid now" choice (e.g. delivery on credit). */
  allowNone?: boolean;
  noneLabel?: string;
  hint?: React.ReactNode;
  /** Field staff screen: say when UPI / bank waits for the office to check it (Settings → Money). */
  field?: boolean;
}) {
  const set = (patch: Partial<PaymentValue>) => onChange({ ...value, ...patch });
  const digital = value.method === "UPI" || value.method === "BANK";
  const [officeChecks, setOfficeChecks] = useState<boolean | null>(null);
  useEffect(() => {
    if (!field || !digital || officeChecks !== null) return;
    fetch("/api/payments/field-check")
      .then((r) => (r.ok ? r.json() : null))
      .then((j: { check?: boolean } | null) => setOfficeChecks(!!j?.check))
      .catch(() => setOfficeChecks(false));
  }, [field, digital, officeChecks]);
  const choices: (CollectMethod | null)[] = allowNone ? [...methods, null] : methods;

  return (
    <div className="space-y-3">
      <div className="flex gap-2 flex-wrap" role="radiogroup" aria-label="Payment method">
        {choices.map((m) => (
          <button
            key={m ?? "none"}
            type="button"
            role="radio"
            aria-checked={value.method === m}
            onClick={() => set({ method: m })}
            className={`flex-1 min-w-[72px] rounded-xl py-2 text-sm font-semibold ${
              value.method === m ? "bg-gradient-to-br from-mor to-[#0c3634] text-white" : "bg-black/5 text-foreground/70"
            }`}
          >
            {m ? LABEL[m] : noneLabel}
          </button>
        ))}
      </div>

      {value.method && (
        <>
          <label className="block">
            <span className="text-xs font-semibold text-[var(--ink-2)]">Amount (₹)</span>
            <input
              className="input mt-1"
              inputMode="decimal"
              value={value.amount}
              onChange={(e) => set({ amount: e.target.value.replace(/[^\d.]/g, "") })}
              placeholder="0"
            />
          </label>

          {(value.method === "UPI" || value.method === "BANK") && (
            <label className="block">
              <span className="text-xs font-semibold text-[var(--ink-2)]">
                {value.method === "UPI" ? "UPI reference (UTR, 12 digits)" : "Bank reference (optional)"}
              </span>
              <input
                className="input mt-1"
                value={value.reference}
                onChange={(e) => set({ reference: e.target.value.replace(/\s/g, "") })}
                placeholder={value.method === "UPI" ? "e.g. 431234567890" : ""}
              />
            </label>
          )}

          {value.method === "CHEQUE" && (
            <div className="grid grid-cols-2 gap-2">
              <label className="block">
                <span className="text-xs font-semibold text-[var(--ink-2)]">Cheque no.</span>
                <input
                  className="input mt-1"
                  inputMode="numeric"
                  maxLength={6}
                  value={value.chequeNumber}
                  onChange={(e) => set({ chequeNumber: e.target.value.replace(/\D/g, "") })}
                />
              </label>
              <label className="block">
                <span className="text-xs font-semibold text-[var(--ink-2)]">Cheque date</span>
                <input className="input mt-1" type="date" value={value.chequeDate} onChange={(e) => set({ chequeDate: e.target.value })} />
              </label>
              <label className="block col-span-2">
                <span className="text-xs font-semibold text-[var(--ink-2)]">Bank</span>
                <input className="input mt-1" value={value.bank} onChange={(e) => set({ bank: e.target.value })} placeholder="e.g. SBI" />
              </label>
            </div>
          )}

          {value.method !== "CASH" && (
            <label className="block">
              <span className="text-xs font-semibold text-[var(--ink-2)]">
                Photo of {value.method === "CHEQUE" ? "the cheque" : "the payment screen"} (optional)
              </span>
              <input
                type="file"
                accept="image/*"
                capture="environment"
                className="block text-sm mt-1"
                onChange={(e) => set({ proof: e.target.files?.[0] ?? null })}
              />
            </label>
          )}
        </>
      )}
      {field && digital && officeChecks && (
        <p className="text-sm text-[var(--ink-2)]">
          The office checks this {value.method === "UPI" ? "UPI" : "bank"} payment in the bank before it counts on the khata. Until then it shows as waiting.
        </p>
      )}
      {hint}
    </div>
  );
}
