/**
 * Every message the app sends, with its built-in wording in English and
 * Hindi. A business can replace the wording per event and language
 * (MessageTemplate); {placeholders} are filled from the event. Client-safe.
 *
 * Retailer messages may go out on push, WhatsApp and SMS (per business
 * settings and the person's own choices); staff messages are in-app and push
 * only (no SMS cost). Every message also lands in the in-app bell.
 */

export type Lang = "en" | "hi";
export type EventDef = {
  label: string;
  audience: "retailer" | "staff";
  /** Channels on by default (when the business has the channel on). */
  channels: ("push" | "whatsapp" | "sms")[];
  /** Topic the person can mute; transactional messages have none. */
  topic?: "reminders" | "promo";
  vars: readonly string[];
  en: { title: string; body: string };
  hi: { title: string; body: string };
};

export const EVENTS = {
  "order.placed": {
    label: "Order placed",
    audience: "retailer",
    channels: ["push", "whatsapp"],
    vars: ["outlet", "order", "amount", "date"],
    en: { title: "Order {order} placed", body: "Thank you, {outlet}. Order {order} for {amount} is placed. Delivery on {date}." },
    hi: { title: "ऑर्डर {order} मिल गया", body: "धन्यवाद, {outlet}। {amount} का ऑर्डर {order} मिल गया है। डिलीवरी {date} को होगी।" },
  },
  "order.dispatched": {
    label: "Out for delivery",
    audience: "retailer",
    channels: ["push", "whatsapp"],
    vars: ["order", "driver", "driverPhone", "slot"],
    en: { title: "Order {order} is on the way", body: "Order {order} is out for delivery ({slot}). Driver: {driver}, {driverPhone}." },
    hi: { title: "ऑर्डर {order} रास्ते में है", body: "ऑर्डर {order} डिलीवरी के लिए निकल गया है ({slot})। ड्राइवर: {driver}, {driverPhone}।" },
  },
  "order.delivered": {
    label: "Delivered",
    audience: "retailer",
    channels: ["push"],
    vars: ["order", "amount"],
    en: { title: "Order {order} delivered", body: "Order {order} ({amount}) is delivered. Tap to rate the delivery." },
    hi: { title: "ऑर्डर {order} पहुँच गया", body: "ऑर्डर {order} ({amount}) डिलीवर हो गया। डिलीवरी को रेटिंग देने के लिए टैप करें।" },
  },
  "order.not_delivered": {
    label: "Could not deliver",
    audience: "retailer",
    channels: ["push", "whatsapp"],
    vars: ["order", "reason"],
    en: { title: "Order {order} not delivered", body: "We could not deliver order {order}: {reason}. We will bring it again." },
    hi: { title: "ऑर्डर {order} डिलीवर नहीं हुआ", body: "ऑर्डर {order} डिलीवर नहीं हो सका: {reason}। हम इसे दोबारा लाएँगे।" },
  },
  "order.cancelled": {
    label: "Order cancelled",
    audience: "retailer",
    channels: ["push", "whatsapp"],
    vars: ["order", "reason"],
    en: { title: "Order {order} cancelled", body: "Order {order} is cancelled. {reason}" },
    hi: { title: "ऑर्डर {order} रद्द", body: "ऑर्डर {order} रद्द कर दिया गया है। {reason}" },
  },
  "invoice.issued": {
    label: "Invoice",
    audience: "retailer",
    channels: ["whatsapp"],
    vars: ["invoice", "amount", "link"],
    en: { title: "Invoice {invoice}", body: "Your invoice {invoice} for {amount}: {link}" },
    hi: { title: "बिल {invoice}", body: "आपका बिल {invoice}, {amount}: {link}" },
  },
  "payment.received": {
    label: "Payment received",
    audience: "retailer",
    channels: ["push", "whatsapp"],
    vars: ["amount", "method", "receipt", "balance"],
    en: { title: "Payment of {amount} received", body: "We received {amount} by {method} (receipt {receipt}). Balance due now: {balance}." },
    hi: { title: "{amount} का भुगतान मिला", body: "हमें {method} से {amount} मिले (रसीद {receipt})। अब बाकी: {balance}।" },
  },
  "dues.reminder": {
    label: "Payment reminder",
    audience: "retailer",
    channels: ["push", "whatsapp"],
    topic: "reminders",
    vars: ["outlet", "amount", "days", "link"],
    en: { title: "Payment due: {amount}", body: "{outlet}, {amount} is overdue by {days} days. Please pay: {link}" },
    hi: { title: "भुगतान बाकी: {amount}", body: "{outlet}, {amount} का भुगतान {days} दिन से बाकी है। कृपया भुगतान करें: {link}" },
  },
  statement: {
    label: "Statement",
    audience: "retailer",
    channels: ["whatsapp"],
    vars: ["outlet", "balance", "overdue", "link"],
    en: { title: "Your statement", body: "{outlet}, your balance is {balance} ({overdue} overdue). See your khata: {link}" },
    hi: { title: "आपका खाता", body: "{outlet}, आपका बकाया {balance} है ({overdue} समय से ऊपर)। खाता देखें: {link}" },
  },
  "ticket.update": {
    label: "Complaint update",
    audience: "retailer",
    channels: ["push", "whatsapp"],
    vars: ["ticket", "status", "note"],
    en: { title: "Complaint {ticket}: {status}", body: "Your complaint {ticket} is {status}. {note}" },
    hi: { title: "शिकायत {ticket}: {status}", body: "आपकी शिकायत {ticket}: {status}। {note}" },
  },
  "referral.reward": {
    label: "Referral reward",
    audience: "retailer",
    channels: ["push", "whatsapp"],
    vars: ["amount", "shop"],
    en: { title: "{amount} added to your wallet", body: "Thank you! {shop} joined with your code, so {amount} is added to your wallet." },
    hi: { title: "{amount} आपके वॉलेट में", body: "धन्यवाद! {shop} आपके कोड से जुड़े, इसलिए {amount} आपके वॉलेट में जोड़े गए।" },
  },
  announcement: {
    label: "Announcement",
    audience: "retailer",
    channels: ["push"],
    topic: "promo",
    vars: ["title", "body"],
    en: { title: "{title}", body: "{body}" },
    hi: { title: "{title}", body: "{body}" },
  },
  // ───────── staff (in-app and push) ─────────
  "staff.order": {
    label: "New order (office)",
    audience: "staff",
    channels: ["push"],
    vars: ["order", "outlet", "amount"],
    en: { title: "New order {order}", body: "{outlet} ordered {amount}." },
    hi: { title: "नया ऑर्डर {order}", body: "{outlet} ने {amount} का ऑर्डर दिया।" },
  },
  "staff.ticket": {
    label: "New complaint (office)",
    audience: "staff",
    channels: ["push"],
    vars: ["ticket", "outlet", "category"],
    en: { title: "Complaint {ticket}", body: "{outlet}: {category}." },
    hi: { title: "शिकायत {ticket}", body: "{outlet}: {category}।" },
  },
  "staff.ticket_reply": {
    label: "Complaint reply (office)",
    audience: "staff",
    channels: ["push"],
    vars: ["ticket", "outlet"],
    en: { title: "Reply on {ticket}", body: "{outlet} answered on complaint {ticket}." },
    hi: { title: "{ticket} पर जवाब", body: "{outlet} ने शिकायत {ticket} पर जवाब दिया।" },
  },
  "staff.ticket_sla": {
    label: "Complaint overdue (office)",
    audience: "staff",
    channels: ["push"],
    vars: ["ticket", "outlet"],
    en: { title: "Complaint {ticket} is overdue", body: "{outlet}'s complaint {ticket} is past its time to resolve." },
    hi: { title: "शिकायत {ticket} में देरी", body: "{outlet} की शिकायत {ticket} तय समय में हल नहीं हुई।" },
  },
  "staff.feedback_low": {
    label: "Low delivery rating (office)",
    audience: "staff",
    channels: ["push"],
    vars: ["outlet", "rating", "order", "driver"],
    en: { title: "{outlet} rated {rating}/5", body: "Delivery of {order} by {driver} was rated {rating}/5." },
    hi: { title: "{outlet} ने {rating}/5 दिया", body: "{driver} द्वारा {order} की डिलीवरी को {rating}/5 मिला।" },
  },
  "staff.lead": {
    label: "New shop to approve (office)",
    audience: "staff",
    channels: ["push"],
    vars: ["outlet", "by"],
    en: { title: "New shop to approve", body: "{by} added {outlet}." },
    hi: { title: "नई दुकान की मंज़ूरी", body: "{by} ने {outlet} जोड़ी।" },
  },
  "staff.leave": {
    label: "Leave request (supervisor)",
    audience: "staff",
    channels: ["push"],
    vars: ["name", "days", "from"],
    en: { title: "Leave request from {name}", body: "{name} asked for {days} from {from}." },
    hi: { title: "{name} की छुट्टी की अर्ज़ी", body: "{name} ने {from} से {days} की छुट्टी माँगी।" },
  },
  "staff.announcement": {
    label: "Announcement (staff)",
    audience: "staff",
    channels: ["push"],
    vars: ["title", "body"],
    en: { title: "{title}", body: "{body}" },
    hi: { title: "{title}", body: "{body}" },
  },
  "staff.billing": {
    label: "Plan and billing (owner)",
    audience: "staff",
    channels: ["push"],
    vars: ["title", "body"],
    en: { title: "{title}", body: "{body}" },
    hi: { title: "{title}", body: "{body}" },
  },
} as const satisfies Record<string, EventDef>;

export type EventKey = keyof typeof EVENTS;
export const isEventKey = (v: unknown): v is EventKey => typeof v === "string" && v in EVENTS;

/** Placeholders in order of first appearance (WhatsApp template parameters follow this order). */
export function placeholders(text: string): string[] {
  const out: string[] = [];
  for (const m of text.matchAll(/\{([a-zA-Z]+)\}/g)) if (!out.includes(m[1])) out.push(m[1]);
  return out;
}

/** Fill {placeholders}; unknown ones become empty. Whitespace is tidied. */
export function render(text: string, vars: Record<string, string | number | null | undefined>): string {
  return text
    .replace(/\{([a-zA-Z]+)\}/g, (_, k: string) => {
      const v = vars[k];
      return v === null || v === undefined ? "" : String(v);
    })
    .replace(/[ \t]+/g, " ")
    .replace(/ ([.,:;!?।])/g, "$1")
    .trim();
}

/** Checks a business's own wording: only the event's placeholders, not empty, not too long. */
export function checkTemplate(event: EventKey, title: string, body: string): string | null {
  if (!title.trim() || !body.trim()) return "Write a title and a message";
  if (title.length > 120) return "Title is too long (120 letters at most)";
  if (body.length > 900) return "Message is too long (900 letters at most)";
  const allowed: readonly string[] = EVENTS[event].vars;
  for (const p of [...placeholders(title), ...placeholders(body)]) if (!allowed.includes(p)) return `{${p}} can't be used here. Use: ${allowed.map((v) => `{${v}}`).join(" ")}`;
  return null;
}
