import { isStateCode, normaliseGstin, validGstin } from "@/lib/gst";

const KINDS = ["GOODS", "SERVICES", "OTHER"];

/** Supplier body → fields, or an error message. partial = only the fields sent. */
export function parseSupplier(b: Record<string, unknown>, partial: boolean): Record<string, unknown> | string {
  const d: Record<string, unknown> = {};
  const t = (v: unknown, max: number) => (typeof v === "string" ? v.trim().slice(0, max) : "");
  if (!partial || "name" in b) {
    const name = t(b.name, 100);
    if (name.length < 2) return "Enter the supplier name";
    d.name = name;
  }
  if ("contactName" in b) d.contactName = t(b.contactName, 80) || null;
  if ("phone" in b) {
    const p = String(b.phone ?? "").replace(/\D/g, "");
    if (p && !/^\d{10,12}$/.test(p)) return "Phone must be 10 to 12 digits";
    d.phone = p || null;
  }
  if ("email" in b) {
    const e = t(b.email, 120);
    if (e && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e)) return "That email doesn't look right";
    d.email = e || null;
  }
  if ("gstin" in b) {
    const g = normaliseGstin(b.gstin);
    if (g && !validGstin(g)) return "That GSTIN is not valid (check the 15 characters)";
    d.gstin = g || null;
  }
  if ("address" in b) d.address = t(b.address, 300) || null;
  if ("leadDays" in b) {
    const n = Number(b.leadDays);
    if (!Number.isInteger(n) || n < 0 || n > 90) return "Delivery time must be 0 to 90 days";
    d.leadDays = n;
  }
  if ("kind" in b) {
    if (!KINDS.includes(String(b.kind))) return "Pick what the supplier sells you";
    d.kind = String(b.kind);
  }
  if ("stateCode" in b) {
    const sc = t(b.stateCode, 2);
    if (sc && !isStateCode(sc)) return "Pick the supplier's state";
    d.stateCode = sc || null;
  }
  // Blank state and PAN are read from the GSTIN.
  if (d.gstin && !d.stateCode) d.stateCode = (d.gstin as string).slice(0, 2);
  if (d.gstin && d.stateCode && (d.gstin as string).slice(0, 2) !== d.stateCode) return "The state doesn't match the GSTIN's first two digits";
  if ("pan" in b) {
    const pan = t(b.pan, 10).toUpperCase();
    if (pan && !/^[A-Z]{5}\d{4}[A-Z]$/.test(pan)) return "That PAN is not valid (10 characters, like ABCDE1234F)";
    d.pan = pan || null;
  }
  if (d.gstin && !d.pan) d.pan = (d.gstin as string).slice(2, 12);
  if ("creditDays" in b) {
    const n = Number(b.creditDays);
    if (!Number.isInteger(n) || n < 0 || n > 365) return "Credit days must be 0 to 365";
    d.creditDays = n;
  }
  if ("bankName" in b) d.bankName = t(b.bankName, 80) || null;
  if ("bankIfsc" in b) {
    const f = t(b.bankIfsc, 11).toUpperCase();
    if (f && !/^[A-Z]{4}0[A-Z0-9]{6}$/.test(f)) return "That IFSC is not valid (11 characters, like SBIN0001234)";
    d.bankIfsc = f || null;
  }
  if ("bankAccountNo" in b) {
    const a = String(b.bankAccountNo ?? "").replace(/\s/g, "");
    if (a && !/^\d{6,18}$/.test(a)) return "Bank account number must be 6 to 18 digits";
    d.bankAccountNo = a || null;
  }
  if ("tdsSection" in b) {
    const x = t(b.tdsSection, 12).toUpperCase().replace(/\s/g, "");
    if (x && !/^19\d[A-Z]{0,2}(\([A-Z]\))?$/.test(x)) return "TDS section looks wrong (like 194C or 194J)";
    d.tdsSection = x || null;
  }
  if ("active" in b) d.active = b.active === true;
  return d;
}
