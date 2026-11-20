/**
 * Photo checks (roadmap §7 A3, A8, A10), plain rules only. Client-safe.
 *
 * What the AI read from a photo is compared here with what a person entered.
 * The AI never verifies or posts anything: a result is a note on the payment,
 * delivery or pickup, and the worst ones become "check" Suggestions.
 *
 * Works without AI: the same photo used twice (SHA-256) and the same UTR on
 * two payments are caught by the server with no model at all.
 */
import { formatINR } from "@/lib/money";

export type PhotoVerdict = "ok" | "warn" | "bad";

export type PhotoFlag =
  | "reused"
  | "reference_reused"
  | "unclear"
  | "not_payment"
  | "wrong_kind"
  | "failed"
  | "pending"
  | "amount_differs"
  | "reference_differs"
  | "cheque_differs"
  | "date_differs"
  | "unsigned"
  | "blank"
  | "no_shop_or_goods"
  | "crates_differ";

export const FLAG_LABEL: Record<PhotoFlag, string> = {
  reused: "Same photo used before",
  reference_reused: "UTR already on another payment",
  unclear: "Photo can't be read",
  not_payment: "Doesn't look like a payment proof",
  wrong_kind: "Proof doesn't match the method",
  failed: "Shows a failed payment",
  pending: "Shows a pending payment",
  amount_differs: "Amount differs",
  reference_differs: "UTR differs",
  cheque_differs: "Cheque number differs",
  date_differs: "Date differs",
  unsigned: "Cheque not signed",
  blank: "Blank or dark photo",
  no_shop_or_goods: "No shop or goods in the photo",
  crates_differ: "Crate count differs",
};

const SEVERITY: Record<PhotoFlag, PhotoVerdict> = {
  reused: "bad",
  reference_reused: "bad",
  unclear: "warn",
  not_payment: "warn",
  wrong_kind: "warn",
  failed: "bad",
  pending: "warn",
  amount_differs: "bad",
  reference_differs: "warn",
  cheque_differs: "warn",
  date_differs: "warn",
  unsigned: "warn",
  blank: "warn",
  no_shop_or_goods: "warn",
  crates_differ: "bad",
};

export const isPhotoFlag = (v: unknown): v is PhotoFlag => typeof v === "string" && v in FLAG_LABEL;

/** The worst verdict among the flags (ok when none). */
export function verdictOf(flags: PhotoFlag[]): PhotoVerdict {
  if (flags.some((f) => SEVERITY[f] === "bad")) return "bad";
  return flags.length ? "warn" : "ok";
}

export type PhotoResult = { verdict: PhotoVerdict; flags: PhotoFlag[]; notes: string[]; summary: string };

const result = (flags: PhotoFlag[], notes: string[], summary: string): PhotoResult => {
  const uniq = [...new Set(flags)];
  return { verdict: verdictOf(uniq), flags: uniq, notes, summary };
};

// ---------- A3: payment proofs ----------

/** What the AI read from a UPI screenshot, bank confirmation or cheque photo. amount in rupees. */
export type PaymentRead = {
  readable: boolean;
  kind: "upi" | "bank" | "cheque" | "other";
  amount: number | null;
  reference: string | null;
  date: string | null;
  status: "success" | "pending" | "failed" | "unknown";
  chequeNumber: string | null;
  signed: boolean | null;
};

export type PaymentEntered = {
  method: string;
  /** Paise. */
  amount: number;
  reference: string | null;
  chequeNumber: string | null;
  /** YYYY-MM-DD (IST) the payment was entered as collected. */
  collectedDay: string;
  /** YYYY-MM-DD on the cheque, as entered. */
  chequeDate: string | null;
};

/** Letters and digits only, upper case (screenshots split UTRs with spaces). */
export const normRef = (s: string | null | undefined) => (s ?? "").replace(/[^a-z0-9]/gi, "").toUpperCase();

/** Same reference: equal, or one is the other's tail with at least 6 characters (apps often shorten them). */
export function sameRef(a: string | null | undefined, b: string | null | undefined) {
  const x = normRef(a);
  const y = normRef(b);
  if (!x || !y) return false;
  if (x === y) return true;
  const [short, long] = x.length <= y.length ? [x, y] : [y, x];
  return short.length >= 6 && long.endsWith(short);
}

const DAY_MS = 86_400_000;
const isDay = (s: string | null): s is string => !!s && /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(`${s}T00:00:00Z`));
const daysBetween = (a: string, b: string) => Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / DAY_MS);
const dayText = (d: string) => new Date(`${d}T00:00:00Z`).toLocaleDateString("en-IN", { day: "numeric", month: "short", timeZone: "UTC" });
const rs = (paise: number) => formatINR(paise, { whole: paise % 100 === 0 });

/** Amounts within ₹1 count as the same. */
const AMOUNT_SLACK = 100;
/** A proof dated more than this many days before (or after) the entry. */
export const DATE_SLACK_DAYS = 3;

/**
 * Compares a payment proof with the payment as entered. `read` is null when
 * no AI looked at the photo: then only reuse is checked.
 */
export function comparePayment(read: PaymentRead | null, e: PaymentEntered, ctx: { reused: boolean; referenceUsedBy: string | null }): PhotoResult {
  const flags: PhotoFlag[] = [];
  const notes: string[] = [];
  if (ctx.reused) {
    flags.push("reused");
    notes.push("This photo was already attached to another entry.");
  }
  if (ctx.referenceUsedBy) {
    flags.push("reference_reused");
    notes.push(`The same UTR is on payment ${ctx.referenceUsedBy}.`);
  }
  if (!read) return result(flags, notes, flags.length ? FLAG_LABEL[flags[0]] : "Checked for reuse only");

  if (!read.readable) {
    flags.push("unclear");
    return result(flags, notes, "Photo can't be read");
  }
  const cheque = e.method === "CHEQUE";
  if (read.kind === "other") {
    flags.push("not_payment");
    notes.push("The photo doesn't look like a payment screenshot or a cheque.");
    return result(flags, notes, FLAG_LABEL.not_payment);
  }
  if (cheque !== (read.kind === "cheque")) {
    flags.push("wrong_kind");
    notes.push(cheque ? "Entered as a cheque, but the photo shows an online payment." : "Entered as an online payment, but the photo shows a cheque.");
  }
  if (!cheque) {
    if (read.status === "failed") {
      flags.push("failed");
      notes.push("The screenshot says the payment failed.");
    } else if (read.status === "pending") {
      flags.push("pending");
      notes.push("The screenshot says the payment is pending.");
    }
  }

  const readPaise = read.amount !== null && Number.isFinite(read.amount) && read.amount >= 0 ? Math.round(read.amount * 100) : null;
  if (readPaise !== null && Math.abs(readPaise - e.amount) >= AMOUNT_SLACK) {
    flags.push("amount_differs");
    notes.push(`The photo shows ${rs(readPaise)}; entered ${rs(e.amount)}.`);
  }

  const refText = cheque ? null : read.reference;
  if (!cheque && e.reference && refText && !sameRef(refText, e.reference)) {
    flags.push("reference_differs");
    notes.push(`The screenshot's UTR is ${normRef(refText)}; entered ${normRef(e.reference)}.`);
  }
  if (cheque) {
    const entered = e.chequeNumber ?? e.reference;
    if (entered && read.chequeNumber && normRef(read.chequeNumber) !== normRef(entered)) {
      flags.push("cheque_differs");
      notes.push(`The cheque shows no. ${normRef(read.chequeNumber)}; entered ${normRef(entered)}.`);
    }
    if (read.signed === false) {
      flags.push("unsigned");
      notes.push("The cheque doesn't look signed.");
    }
  }

  const want = cheque ? e.chequeDate : e.collectedDay;
  if (isDay(read.date) && isDay(want)) {
    const gap = daysBetween(read.date, want);
    if (Math.abs(gap) > (cheque ? 0 : DATE_SLACK_DAYS)) {
      flags.push("date_differs");
      notes.push(cheque ? `The cheque is dated ${dayText(read.date)}; entered ${dayText(want)}.` : `The screenshot is dated ${dayText(read.date)}; the payment was entered on ${dayText(want)}.`);
    }
  }

  const bits = [readPaise !== null ? rs(readPaise) : null, cheque ? (read.chequeNumber ? `cheque ${normRef(read.chequeNumber)}` : null) : refText ? `UTR ${normRef(refText)}` : null, isDay(read.date) ? dayText(read.date) : null].filter(Boolean);
  const out = result(flags, notes, "");
  out.summary =
    out.verdict === "ok"
      ? bits.length
        ? `${cheque ? "Cheque" : "Screenshot"} matches: ${bits.join(" · ")}`
        : `${cheque ? "Cheque" : "Screenshot"} looks fine`
      : `${out.flags.map((f) => FLAG_LABEL[f]).join(" · ")}`;
  return out;
}

// ---------- A8: delivery and pickup photos ----------

export type DeliveryRead = { readable: boolean; blank: boolean; showsShop: boolean; showsGoods: boolean; note: string };

export function deliveryVerdict(read: DeliveryRead | null, ctx: { reused: boolean }): PhotoResult {
  const flags: PhotoFlag[] = [];
  const notes: string[] = [];
  if (ctx.reused) {
    flags.push("reused");
    notes.push("This photo was already attached to another delivery or entry.");
  }
  if (read) {
    if (read.blank) flags.push("blank");
    else if (!read.readable) flags.push("unclear");
    else if (!read.showsShop && !read.showsGoods) flags.push("no_shop_or_goods");
    if (read.note) notes.push(read.note);
  }
  const out = result(flags, notes, "");
  out.summary = out.flags.length ? out.flags.map((f) => FLAG_LABEL[f]).join(" · ") : read ? "Photo shows the drop" : "Checked for reuse only";
  return out;
}

export type PickupRead = { readable: boolean; crates: number | null };

/** Crates counted in the photo differ from those entered: at least 2 and at least 10% apart. */
export function cratesDiffer(counted: number, entered: number) {
  const gap = Math.abs(counted - entered);
  return gap >= Math.max(2, Math.ceil(entered * 0.1));
}

export function pickupVerdict(read: PickupRead | null, entered: number, ctx: { reused: boolean }): PhotoResult {
  const flags: PhotoFlag[] = [];
  const notes: string[] = [];
  if (ctx.reused) {
    flags.push("reused");
    notes.push("This photo was already attached to another entry.");
  }
  if (read) {
    if (!read.readable || read.crates === null) flags.push("unclear");
    else if (cratesDiffer(read.crates, entered)) {
      flags.push("crates_differ");
      notes.push(`About ${read.crates} in the photo; ${entered} entered.`);
    }
  }
  const out = result(flags, notes, "");
  out.summary = out.flags.length ? out.flags.map((f) => FLAG_LABEL[f]).join(" · ") : read?.crates != null ? `About ${read.crates} in the photo` : "Checked for reuse only";
  return out;
}

// ---------- A10: shelf audits ----------

export const MAX_FACINGS = 1000;

/** Our share of the facings on the shelf, in whole per cent (null when nothing was counted). */
export const shelfShare = (ours: number, others: number) => (ours + others > 0 ? Math.round((ours / (ours + others)) * 100) : null);

/** Checks typed shelf counts: whole numbers from 0 to 1000. A string = an error. */
export function parseShelfCounts(v: { ours?: unknown; others?: unknown; empty?: unknown }): { ours: number; others: number; empty: number } | string {
  const out: Record<string, number> = {};
  for (const k of ["ours", "others", "empty"] as const) {
    const n = v[k];
    if (typeof n !== "number" || !Number.isInteger(n) || n < 0 || n > MAX_FACINGS) return `Enter ${k === "ours" ? "our facings" : k === "others" ? "other brands' facings" : "empty slots"} as a whole number from 0 to ${MAX_FACINGS}`;
    out[k] = n;
  }
  return out as { ours: number; others: number; empty: number };
}
