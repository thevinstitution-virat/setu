/**
 * Terms of service and privacy notice (roadmap §8: DPDP Act consent at sign-up,
 * purpose notes for location and selfies). The pages are /legal/terms and
 * /legal/privacy on every address.
 *
 * LEGAL_DRAFT stays true until the owner's lawyer-checked text replaces the
 * draft wording in src/app/legal/*: the pages then carry a "draft" banner and
 * the go-live check warns. The facts listed (what the app keeps and why) come
 * from the data model; keep them true when features change.
 */
export const LEGAL_DRAFT = true;
export const LEGAL_UPDATED = "20 November 2026";

/** Who runs the platform, from the environment (the same names as on our invoices). */
export function operator(env: Record<string, string | undefined> = process.env) {
  return {
    name: env.PLATFORM_LEGAL_NAME || "VBiz Pro",
    address: env.PLATFORM_ADDRESS || "",
    /** Grievance officer (DPDP Act §8(10)); an email or phone shown on the privacy page. */
    grievance: env.GRIEVANCE_CONTACT || "",
  };
}

/** What the app keeps about people, and why: the privacy notice's table. */
export const DATA_WE_KEEP: { what: string; who: string; why: string }[] = [
  { what: "Name, mobile number, login id, email (if given)", who: "Staff, shop owners", why: "Signing in, sending sign-in codes, order and payment messages" },
  { what: "Shop name, address, GSTIN, map pin, shop front photo", who: "Shops", why: "Deliveries, routes, GST invoices, finding the shop" },
  { what: "Orders, invoices, payments, cheques, the ledger (khata)", who: "Shops", why: "Running the account between the business and the shop, and GST invoices" },
  { what: "Photos of payment slips, delivered goods, crates and shelves", who: "Staff, shops", why: "Proof of payment and delivery, and checking them" },
  { what: "Check-in and check-out selfie and position", who: "Field staff", why: "Attendance, only when the person starts and ends the day" },
  { what: "Position while on duty, only if the business turns it on", who: "Field staff", why: "Routes and visits; never off duty" },
  { what: "Messages sent (WhatsApp, SMS, notifications) and their status", who: "Staff, shops", why: "Knowing what was sent, retrying failures" },
  { what: "Sign-in tries with the network address, kept one day", who: "Everyone who signs in", why: "Stopping password guessing" },
];

/** Services that handle data for us, when the business or the platform turns them on. */
export const PROCESSORS = [
  "Hosting and database (our servers in India)",
  "File storage for photos and invoices",
  "WhatsApp and SMS providers, to send messages",
  "Razorpay, for online payments",
  "Google Maps, for addresses and distances",
  "Anthropic (Claude), only for the AI features the business turns on; shop names and figures are sent, not phone numbers where it can be avoided",
];
