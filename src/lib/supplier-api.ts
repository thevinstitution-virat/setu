import { normaliseGstin, validGstin } from "@/lib/gst";

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
  if ("active" in b) d.active = b.active === true;
  return d;
}
