/** Client-safe labels for payments to suppliers (the server code is supplier-payments.ts). */

export type PayMethod = "BANK" | "CASH" | "CHEQUE";
export type ChequeStatus = "ISSUED" | "CLEARED" | "BOUNCED" | "CANCELLED";

export const PAY_METHOD_LABEL: Record<PayMethod, string> = {
  BANK: "Bank transfer",
  CASH: "Cash",
  CHEQUE: "Our cheque",
};
export const CHEQUE_STATUS_LABEL: Record<ChequeStatus, string> = {
  ISSUED: "Not yet cleared",
  CLEARED: "Cleared",
  BOUNCED: "Bounced",
  CANCELLED: "Cancelled",
};

/** TDS sections a trading business usually deducts under (typed freely too). */
export const TDS_SECTIONS = [
  { code: "194C", label: "194C · contractors, transport" },
  { code: "194J", label: "194J · professional / technical fees" },
  { code: "194H", label: "194H · commission, brokerage" },
  { code: "194I", label: "194I · rent" },
  { code: "194Q", label: "194Q · purchase of goods" },
];
