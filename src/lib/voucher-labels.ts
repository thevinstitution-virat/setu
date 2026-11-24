/** Voucher words shared by the server and the browser (no database here). */

export type VoucherType = "PAYMENT" | "RECEIPT" | "CONTRA" | "JOURNAL";
export type VoucherMethod = "CASH" | "BANK" | "CHEQUE" | "STAFF";

export const VOUCHER_TYPES: VoucherType[] = ["PAYMENT", "RECEIPT", "CONTRA", "JOURNAL"];

export const VOUCHER_TYPE_LABEL: Record<VoucherType, string> = {
  PAYMENT: "Payment voucher",
  RECEIPT: "Receipt voucher",
  CONTRA: "Contra",
  JOURNAL: "Journal voucher",
};

/** What each one is for, under its button. */
export const VOUCHER_TYPE_HINT: Record<VoucherType, string> = {
  PAYMENT: "Rent, salaries, fuel, bills: money paid that is not a supplier's bill",
  RECEIPT: "Capital, a loan, interest, scrap sold: money in that is not from a shop",
  CONTRA: "Cash paid into the bank, cash drawn out, bank to bank",
  JOURNAL: "Depreciation, provisions, corrections: any balanced lines",
};

/** Number prefix: PV2627-00001. */
export const VOUCHER_PREFIX: Record<VoucherType, string> = { PAYMENT: "PV", RECEIPT: "RV", CONTRA: "CV", JOURNAL: "JV" };

export const VOUCHER_METHOD_LABEL: Record<VoucherMethod, string> = {
  CASH: "Cash",
  BANK: "Bank",
  CHEQUE: "Our cheque",
  STAFF: "Staff, from collected cash",
};

export const isVoucherType = (v: unknown): v is VoucherType => typeof v === "string" && (VOUCHER_TYPES as string[]).includes(v);
export const isVoucherMethod = (v: unknown): v is VoucherMethod => v === "CASH" || v === "BANK" || v === "CHEQUE" || v === "STAFF";

/**
 * Built-in accounts a journal may post to. The rest (shops, suppliers,
 * claims, sales, purchases, GST output, cheques and money on the way) are
 * kept by their own documents, so a journal line there would put the books
 * out of step with the bills.
 */
export const JOURNAL_BUILT_INS = [
  "OPENING_EQUITY",
  "GST_INPUT",
  "TDS_PAYABLE",
  "TDS_RECEIVABLE",
  "DISCOUNT",
  "CASH_SHORTAGE",
  "PROMOTIONS",
  "GATEWAY_FEES",
  "ROUND_OFF",
  "STOCK_LOSS",
  "PENALTY_INCOME",
  "CLAIM_INCOME",
] as const;
export type JournalBuiltIn = (typeof JOURNAL_BUILT_INS)[number];
