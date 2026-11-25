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
  /** Most unpaid bills a retailer may have before new orders are held; null = no limit by bills. */
  defaultCreditBills: number | null;
  /** Hold orders from a retailer whose cheque bounced in the last `bounceHoldDays` days. */
  holdOnBounce: boolean;
  bounceHoldDays: number;
  /** Count post-dated cheques held from a retailer as money on its way when working out how much credit is in use. */
  pdcReducesExposure: boolean;
  /** Check credit again when the order leaves (it may have been fine when placed); a failed check puts it on hold. */
  checkCreditAtBilling: boolean;
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
  defaultCreditBills: null,
  holdOnBounce: false,
  bounceHoldDays: 30,
  pdcReducesExposure: false,
  checkCreditAtBilling: false,
  chequeBouncePenalty: 0,
  upiVpa: "",
  upiPayeeName: "",
  checkFieldDigital: true,
};

export function moneySettings(settings: unknown): MoneySettings {
  const m = ((settings ?? {}) as { money?: Partial<MoneySettings> }).money ?? {};
  return { ...MONEY_DEFAULTS, ...m };
}

export type RetailerTerms = {
  mode: PaymentMode;
  /** The limit in force now: the temporary one while it runs (when higher), else the usual one. */
  creditLimit: number | null;
  creditDays: number;
  /** Most unpaid bills; null = no limit by bills. */
  creditBills: number | null;
  /** The temporary limit when it is the one in force, with its last day. */
  tempLimit: { amount: number; until: Date } | null;
};

export function termsFor(
  s: MoneySettings,
  r: {
    paymentMode: PaymentMode | null;
    creditLimit: number | null;
    creditDays: number | null;
    creditBills?: number | null;
    tempCreditLimit?: number | null;
    tempCreditUntil?: Date | null;
  },
  now = new Date()
): RetailerTerms {
  const usual = r.creditLimit ?? s.defaultCreditLimit;
  // A temporary limit only ever raises a limit, and only until its last day.
  const temp = r.tempCreditLimit != null && r.tempCreditUntil && r.tempCreditUntil.getTime() >= now.getTime() && usual !== null && r.tempCreditLimit > usual ? { amount: r.tempCreditLimit, until: r.tempCreditUntil } : null;
  return {
    mode: r.paymentMode ?? s.defaultPaymentMode,
    creditLimit: temp ? temp.amount : usual,
    creditDays: r.creditDays ?? s.defaultCreditDays,
    creditBills: r.creditBills ?? s.defaultCreditBills,
    tempLimit: temp,
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
    int("defaultCreditBills", 1, 999, true),
    int("bounceHoldDays", 1, 365),
    int("chequeBouncePenalty", 0, 10_000_000),
  ])
    if (err) return err;
  if ("holdOnOverdue" in input) out.holdOnOverdue = !!input.holdOnOverdue;
  if ("holdOnBounce" in input) out.holdOnBounce = !!input.holdOnBounce;
  if ("pdcReducesExposure" in input) out.pdcReducesExposure = !!input.pdcReducesExposure;
  if ("checkCreditAtBilling" in input) out.checkCreditAtBilling = !!input.checkCreditAtBilling;
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
