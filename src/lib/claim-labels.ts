import type { ClaimSettlementKind, ClaimStatus, ClaimType } from "@/generated/prisma/client";

/** Claim words shared by pages and the server (no server imports here). */

export const CLAIM_TYPE_LABEL: Record<ClaimType, string> = {
  SCHEME: "Scheme",
  DAMAGE: "Damage / expiry",
  RATE_DIFF: "Rate difference",
  OTHER: "Other",
};

export const CLAIM_TYPE_HINT: Record<ClaimType, string> = {
  SCHEME: "Free goods and scheme discounts we gave shops on their products",
  DAMAGE: "Goods that came back damaged or expired, or went bad in our stock",
  RATE_DIFF: "They cut a rate: our stock on that day × the difference",
  OTHER: "Display money, promotions, anything else they owe us",
};

export const CLAIM_STATUS_LABEL: Record<ClaimStatus, string> = {
  RAISED: "Raised",
  PART_SETTLED: "Part settled",
  SETTLED: "Settled",
  REJECTED: "Rejected",
  WRITTEN_OFF: "Written off",
};

export const SETTLE_KIND_LABEL: Record<ClaimSettlementKind, string> = {
  CREDIT_NOTE: "Their credit note",
  RECEIPT: "Money received",
  WRITE_OFF: "Written off",
};

export const CLAIM_TYPES = Object.keys(CLAIM_TYPE_LABEL) as ClaimType[];
export const CLAIM_STATUSES = Object.keys(CLAIM_STATUS_LABEL) as ClaimStatus[];
export const isClaimType = (v: unknown): v is ClaimType => typeof v === "string" && v in CLAIM_TYPE_LABEL;

/** Ages of open claims, counted from the day they were raised. */
export type ClaimAge = "d30" | "d60" | "d90" | "older";
export const CLAIM_AGE_LABEL: Record<ClaimAge, string> = { d30: "Up to 30 days", d60: "31–60 days", d90: "61–90 days", older: "Over 90 days" };
export const claimAge = (days: number): ClaimAge => (days <= 30 ? "d30" : days <= 60 ? "d60" : days <= 90 ? "d90" : "older");

/** open > 0: raised / part settled. Nothing open: settled, rejected (nothing came) or written off (part came). */
export function claimStatus(amount: number, settled: number, writtenOff: number): ClaimStatus {
  if (amount - settled - writtenOff > 0) return settled > 0 ? "PART_SETTLED" : "RAISED";
  if (!writtenOff) return "SETTLED";
  return settled ? "WRITTEN_OFF" : "REJECTED";
}
