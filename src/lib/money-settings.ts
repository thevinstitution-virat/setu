import type { PaymentMode } from "@/generated/prisma/client";

/**
 * Per-tenant money rules, stored in Tenant.settings.money. Every field has a
 * safe default so a new tenant works before the owner sets anything
 * (owner decision 8: process rules come later).
 */
export type MoneySettings = {
  defaultPaymentMode: PaymentMode;
  /** Days before an unpaid bill is overdue. */
  defaultCreditDays: number;
  /** Paise; null = no limit. */
  defaultCreditLimit: number | null;
  /** Put new orders on hold when the retailer has overdue bills. */
  holdOnOverdue: boolean;
  /** Extra days after the due date before the overdue hold applies. */
  overdueGraceDays: number;
  /** Paise charged when a cheque bounces; 0 = none. */
  chequeBouncePenalty: number;
  /** UPI ID shown to retailers for "Pay now" (e.g. agency@okaxis). */
  upiVpa: string;
  upiPayeeName: string;
  /** UPI and bank payments taken by field staff wait in "To verify" until the office checks the bank. */
  checkFieldDigital: boolean;
};

export const MONEY_DEFAULTS: MoneySettings = {
  defaultPaymentMode: "POSTPAID",
  defaultCreditDays: 7,
  defaultCreditLimit: null,
  holdOnOverdue: true,
  overdueGraceDays: 0,
  chequeBouncePenalty: 0,
  upiVpa: "",
  upiPayeeName: "",
  checkFieldDigital: true,
};

export function moneySettings(settings: unknown): MoneySettings {
  const m = ((settings ?? {}) as { money?: Partial<MoneySettings> }).money ?? {};
  return { ...MONEY_DEFAULTS, ...m };
}

export type RetailerTerms = { mode: PaymentMode; creditLimit: number | null; creditDays: number };

export function termsFor(
  s: MoneySettings,
  r: { paymentMode: PaymentMode | null; creditLimit: number | null; creditDays: number | null }
): RetailerTerms {
  return {
    mode: r.paymentMode ?? s.defaultPaymentMode,
    creditLimit: r.creditLimit ?? s.defaultCreditLimit,
    creditDays: r.creditDays ?? s.defaultCreditDays,
  };
}

/** Validate a settings patch from the admin screen. Returns an error message or the clean patch. */
export function parseMoneySettings(input: Record<string, unknown>): Partial<MoneySettings> | string {
  const out: Partial<MoneySettings> = {};
  if ("defaultPaymentMode" in input) {
    if (input.defaultPaymentMode !== "PREPAID" && input.defaultPaymentMode !== "POSTPAID") return "Payment mode must be PREPAID or POSTPAID";
    out.defaultPaymentMode = input.defaultPaymentMode;
  }
  const int = (k: keyof MoneySettings, min: number, max: number, nullable = false) => {
    if (!(k in input)) return null;
    const v = input[k];
    if (v === null && nullable) {
      (out as Record<string, unknown>)[k] = null;
      return null;
    }
    const n = Number(v);
    if (!Number.isInteger(n) || n < min || n > max) return `${k} must be a whole number from ${min} to ${max}`;
    (out as Record<string, unknown>)[k] = n;
    return null;
  };
  for (const err of [
    int("defaultCreditDays", 0, 365),
    int("defaultCreditLimit", 0, 1_000_000_000, true),
    int("overdueGraceDays", 0, 90),
    int("chequeBouncePenalty", 0, 10_000_000),
  ])
    if (err) return err;
  if ("holdOnOverdue" in input) out.holdOnOverdue = !!input.holdOnOverdue;
  if ("checkFieldDigital" in input) out.checkFieldDigital = !!input.checkFieldDigital;
  if ("upiVpa" in input) {
    const v = String(input.upiVpa ?? "").trim();
    if (v && !/^[a-zA-Z0-9.\-_]{2,256}@[a-zA-Z]{2,64}$/.test(v)) return "UPI ID looks wrong (example: agency@okaxis)";
    out.upiVpa = v;
  }
  if ("upiPayeeName" in input) out.upiPayeeName = String(input.upiPayeeName ?? "").trim().slice(0, 60);
  return out;
}

/** upi://pay link for a QR code or a tap-to-pay button. */
export function upiLink(vpa: string, payee: string, amountPaise: number, note: string) {
  const p = new URLSearchParams({
    pa: vpa,
    pn: payee || vpa,
    am: (amountPaise / 100).toFixed(2),
    cu: "INR",
    tn: note.slice(0, 50),
  });
  return `upi://pay?${p.toString()}`;
}
