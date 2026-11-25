import { formatINR } from "@/lib/money";

/** Client-safe formatting for the books pages. */

/** Balance with its side: ₹1,200.00 Dr / ₹300.00 Cr. */
export const drcr = (p: number) => (p === 0 ? formatINR(0) : `${formatINR(Math.abs(p))} ${p > 0 ? "Dr" : "Cr"}`);
export const amt = (p: number) => (p ? formatINR(p) : "");
export const showDay = (d: string) => d.split("-").reverse().join("/");
