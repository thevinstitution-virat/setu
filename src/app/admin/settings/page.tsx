"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import Icon from "@/components/Icon";
import { formatINR, toPaise } from "@/lib/money";
import type { CartSettings } from "@/lib/cart-settings";
import type { InvoiceSettings } from "@/lib/invoice-settings";
import { Field, Toggle } from "@/components/admin/AdminKit";
import { STATE_NAMES } from "@/components/invoice/InvoiceView";
import type { DeliverySettings as DeliveryRules } from "@/lib/delivery-settings";
import DeliverySettings from "@/components/admin/DeliverySettings";
import type { InventorySettings } from "@/lib/inventory-settings";
import StockSettings from "@/components/admin/StockSettings";
import type { FieldSettings as FieldRules } from "@/lib/field-settings";
import FieldSettings from "@/components/admin/FieldSettings";
import type { NotifySettings, ReferralSettings as ReferralRules, SupportSettings as SupportRules } from "@/lib/engage-settings";
import MessageSettings, { type ChannelStatus } from "@/components/admin/MessageSettings";
import SupportSettings from "@/components/admin/SupportSettings";
import ReferralSettings from "@/components/admin/ReferralSettings";
import GatewaySettings from "@/components/admin/GatewaySettings";

type Mode = "PREPAID" | "POSTPAID";

type Money = {
  defaultPaymentMode: Mode;
  defaultCreditDays: number;
  defaultCreditLimit: number | null;
  holdOnOverdue: boolean;
  overdueGraceDays: number;
  defaultCreditBills: number | null;
  holdOnBounce: boolean;
  bounceHoldDays: number;
  pdcReducesExposure: boolean;
  checkCreditAtBilling: boolean;
  chequeBouncePenalty: number;
  upiVpa: string;
  upiPayeeName: string;
  checkFieldDigital: boolean;
};

/** Form values as typed (₹ and days as text). */
type Form = {
  defaultPaymentMode: Mode;
  defaultCreditDays: string;
  defaultCreditLimit: string;
  holdOnOverdue: boolean;
  overdueGraceDays: string;
  defaultCreditBills: string;
  holdOnBounce: boolean;
  bounceHoldDays: string;
  pdcReducesExposure: boolean;
  checkCreditAtBilling: boolean;
  chequeBouncePenalty: string;
  upiVpa: string;
  upiPayeeName: string;
  checkFieldDigital: boolean;
};

/** Field names in server messages → words the owner knows. */
const FIELD_LABEL: Record<string, string> = {
  defaultCreditDays: "Credit days",
  defaultCreditLimit: "Credit limit",
  overdueGraceDays: "Grace days",
  defaultCreditBills: "Unpaid bills allowed",
  bounceHoldDays: "Days after a bounced cheque",
  chequeBouncePenalty: "Cheque bounce charge",
};

const rupees = (p: number) => String(p / 100);

function toForm(m: Money): Form {
  return {
    defaultPaymentMode: m.defaultPaymentMode,
    defaultCreditDays: String(m.defaultCreditDays),
    defaultCreditLimit: m.defaultCreditLimit === null ? "" : rupees(m.defaultCreditLimit),
    holdOnOverdue: m.holdOnOverdue,
    overdueGraceDays: String(m.overdueGraceDays),
    defaultCreditBills: m.defaultCreditBills == null ? "" : String(m.defaultCreditBills),
    holdOnBounce: !!m.holdOnBounce,
    bounceHoldDays: String(m.bounceHoldDays ?? 30),
    pdcReducesExposure: !!m.pdcReducesExposure,
    checkCreditAtBilling: !!m.checkCreditAtBilling,
    chequeBouncePenalty: rupees(m.chequeBouncePenalty),
    upiVpa: m.upiVpa,
    upiPayeeName: m.upiPayeeName,
    checkFieldDigital: m.checkFieldDigital ?? true,
  };
}

/** Form → API patch, or an error message. */
function toPatch(f: Form): Money | string {
  const days = (s: string, label: string, max: number) => {
    const n = Number(s);
    if (!s.trim() || !Number.isInteger(n) || n < 0 || n > max) return `${label} must be a whole number from 0 to ${max}`;
    return n;
  };
  const money = (s: string, label: string) => {
    try {
      const p = toPaise(s);
      return p < 0 ? `${label} can't be less than ₹0` : p;
    } catch {
      return `${label} must be an amount in rupees`;
    }
  };
  const creditDays = days(f.defaultCreditDays, "Credit days", 365);
  if (typeof creditDays === "string") return creditDays;
  const grace = days(f.overdueGraceDays, "Grace days", 90);
  if (typeof grace === "string") return grace;
  const limit = f.defaultCreditLimit.trim() ? money(f.defaultCreditLimit, "Credit limit") : null;
  if (typeof limit === "string") return limit;
  const penalty = f.chequeBouncePenalty.trim() ? money(f.chequeBouncePenalty, "Cheque bounce charge") : 0;
  if (typeof penalty === "string") return penalty;
  let bills: number | null = null;
  if (f.defaultCreditBills.trim()) {
    const n = Number(f.defaultCreditBills);
    if (!Number.isInteger(n) || n < 1 || n > 999) return "Unpaid bills allowed must be a whole number from 1 to 999";
    bills = n;
  }
  const bounceDays = days(f.bounceHoldDays, "Days after a bounced cheque", 365);
  if (typeof bounceDays === "string") return bounceDays;
  if (bounceDays < 1) return "Days after a bounced cheque must be at least 1";
  return {
    defaultPaymentMode: f.defaultPaymentMode,
    defaultCreditDays: creditDays,
    defaultCreditLimit: limit,
    holdOnOverdue: f.holdOnOverdue,
    overdueGraceDays: grace,
    defaultCreditBills: bills,
    holdOnBounce: f.holdOnBounce,
    bounceHoldDays: bounceDays,
    pdcReducesExposure: f.pdcReducesExposure,
    checkCreditAtBilling: f.checkCreditAtBilling,
    chequeBouncePenalty: penalty,
    upiVpa: f.upiVpa.trim(),
    upiPayeeName: f.upiPayeeName.trim(),
    checkFieldDigital: f.checkFieldDigital,
  };
}

// ───────────────────────────── cart rules ─────────────────────────────

type CartForm = {
  minOrderValue: string;
  deliveryCharge: string;
  freeDeliveryAbove: string;
  deliveryGstRate: string;
  cutoffTime: string;
  leadDays: string;
  closedWeekdays: number[];
  holidays: string[];
  allowDateChoice: boolean;
  maxDaysAhead: string;
};

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const DELIVERY_GST = [0, 5, 12, 18, 28];

function toCartForm(c: CartSettings): CartForm {
  return {
    minOrderValue: c.minOrderValue ? rupees(c.minOrderValue) : "",
    deliveryCharge: c.deliveryCharge ? rupees(c.deliveryCharge) : "",
    freeDeliveryAbove: c.freeDeliveryAbove === null ? "" : rupees(c.freeDeliveryAbove),
    deliveryGstRate: String(c.deliveryGstRate),
    cutoffTime: c.cutoffTime,
    leadDays: String(c.leadDays),
    closedWeekdays: [...c.closedWeekdays].sort(),
    holidays: [...c.holidays].sort(),
    allowDateChoice: c.allowDateChoice,
    maxDaysAhead: String(c.maxDaysAhead),
  };
}

/** Cart form → only the fields that changed, or an error message. */
function toCartPatch(f: CartForm, saved: CartSettings): Partial<CartSettings> | string {
  const money = (s: string, label: string, blank: number | null) => {
    if (!s.trim()) return blank;
    try {
      const p = toPaise(s);
      return p < 0 ? `${label} can't be less than ₹0` : p;
    } catch {
      return `${label} must be an amount in rupees`;
    }
  };
  const whole = (s: string, label: string, min: number, max: number) => {
    const n = Number(s);
    if (!s.trim() || !Number.isInteger(n) || n < min || n > max) return `${label} must be a whole number from ${min} to ${max}`;
    return n;
  };
  const minOrder = money(f.minOrderValue, "Minimum order", 0);
  if (typeof minOrder === "string") return minOrder;
  const charge = money(f.deliveryCharge, "Delivery charge", 0);
  if (typeof charge === "string") return charge;
  const freeAbove = money(f.freeDeliveryAbove, "Free delivery amount", null);
  if (typeof freeAbove === "string") return freeAbove;
  if (f.cutoffTime && !/^([01]\d|2[0-3]):[0-5]\d$/.test(f.cutoffTime)) return "Cut-off time must be HH:MM";
  const lead = whole(f.leadDays, "Lead days", 0, 14);
  if (typeof lead === "string") return lead;
  const ahead = whole(f.maxDaysAhead, "Days ahead", 1, 30);
  if (typeof ahead === "string") return ahead;
  if (f.closedWeekdays.length >= 7) return "Keep at least one delivery day open";

  const next: CartSettings = {
    minOrderValue: minOrder ?? 0,
    deliveryCharge: charge ?? 0,
    freeDeliveryAbove: freeAbove,
    deliveryGstRate: Number(f.deliveryGstRate),
    cutoffTime: f.cutoffTime,
    leadDays: lead,
    closedWeekdays: [...f.closedWeekdays].sort(),
    holidays: [...f.holidays].sort(),
    allowDateChoice: f.allowDateChoice,
    maxDaysAhead: ahead,
  };
  const out: Record<string, unknown> = {};
  for (const k of Object.keys(next) as (keyof CartSettings)[]) {
    const was = saved[k];
    const a = JSON.stringify(next[k]);
    const b = JSON.stringify(Array.isArray(was) ? [...(was as (string | number)[])].sort() : was);
    if (a !== b) out[k] = next[k];
  }
  return out as Partial<CartSettings>;
}

/** The delivery charge rule in plain words. */
function CartSummary({ cart }: { cart: CartForm }) {
  const p = (v: string) => {
    if (!v.trim()) return null;
    try {
      const n = toPaise(v);
      return n >= 0 ? n : null;
    } catch {
      return null;
    }
  };
  const inr = (n: number) => formatINR(n, { whole: n % 100 === 0 });
  const min = p(cart.minOrderValue) ?? 0;
  const charge = p(cart.deliveryCharge) ?? 0;
  const free = p(cart.freeDeliveryAbove);
  const parts = [min > 0 ? `Orders need at least ${inr(min)} of goods.` : "Any order size is fine."];
  if (charge <= 0) parts.push("Delivery is free.");
  else parts.push(`Delivery costs ${inr(charge)} + ${cart.deliveryGstRate}% GST${free !== null ? `, free from ${inr(free)} of goods` : " on every order"}.`);
  return <p className="rounded-xl bg-ink/5 px-3 py-2 text-sm text-[var(--ink-2)]">{parts.join(" ")}</p>;
}

function friendly(msg: string) {
  return msg.replace(/^(\w+) must/, (all, key: string) => (FIELD_LABEL[key] ? `${FIELD_LABEL[key]} must` : all));
}

export default function SettingsPage() {
  const [saved, setSaved] = useState<Form | null>(null);
  const [form, setForm] = useState<Form | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [savedAt, setSavedAt] = useState<Date | null>(null);
  const [cartRaw, setCartRaw] = useState<CartSettings | null>(null);
  const [cartSaved, setCartSaved] = useState<CartForm | null>(null);
  const [cart, setCart] = useState<CartForm | null>(null);
  const [holiday, setHoliday] = useState("");
  const [gst, setGst] = useState<{ invoice: InvoiceSettings; business: Business } | null>(null);
  const [delivery, setDelivery] = useState<DeliveryRules | null>(null);
  const [inventory, setInventory] = useState<InventorySettings | null>(null);
  const [field, setField] = useState<FieldRules | null>(null);
  const [engage, setEngage] = useState<{ notify: NotifySettings; channels: ChannelStatus; support: SupportRules; referral: ReferralRules } | null>(null);

  useEffect(() => {
    fetch("/api/admin/settings")
      .then(async (res) => {
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data.error ?? "Could not load settings");
        const f = toForm(data.money);
        setSaved(f);
        setForm(f);
        const c = toCartForm(data.cart);
        setCartRaw(data.cart);
        setCartSaved(c);
        setCart(c);
        setGst({ invoice: data.invoice, business: data.business });
        setDelivery(data.delivery);
        setInventory(data.inventory);
        setField(data.field);
        setEngage({ notify: data.notify, channels: data.channels, support: data.support, referral: data.referral });
      })
      .catch((e) => setLoadError(e instanceof Error ? e.message : "Could not load settings"));
  }, []);

  if (loadError) return <p className="text-sm text-[#a8281e]">{loadError}</p>;
  if (!form || !saved || !cart || !cartSaved || !cartRaw || !gst || !delivery || !inventory || !field || !engage) return <p className="text-sm text-[var(--muted)]">Loading…</p>;

  const moneyDirty = JSON.stringify(form) !== JSON.stringify(saved);
  const cartDirty = JSON.stringify(cart) !== JSON.stringify(cartSaved);
  const dirty = moneyDirty || cartDirty;
  const set = <K extends keyof Form>(k: K, v: Form[K]) => {
    setForm({ ...form, [k]: v });
    setError(null);
  };
  const setC = <K extends keyof CartForm>(k: K, v: CartForm[K]) => {
    setCart({ ...cart, [k]: v });
    setError(null);
  };
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata" }).format(new Date());

  async function save(e: React.FormEvent) {
    e.preventDefault();
    if (!form || !cart || !cartRaw) return;
    const body: Record<string, object> = {};
    if (moneyDirty) {
      const patch = toPatch(form);
      if (typeof patch === "string") {
        setError(patch);
        return;
      }
      body.money = patch;
    }
    if (cartDirty) {
      const patch = toCartPatch(cart, cartRaw);
      if (typeof patch === "string") {
        setError(patch);
        return;
      }
      if (Object.keys(patch).length) body.cart = patch;
      else setCart(cartSaved);
    }
    if (!Object.keys(body).length) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/admin/settings", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(friendly(data.error ?? "Could not save"));
      if (data.money) {
        const f = toForm(data.money);
        setSaved(f);
        setForm(f);
      }
      if (data.cart) {
        const c = toCartForm(data.cart);
        setCartRaw(data.cart);
        setCartSaved(c);
        setCart(c);
      }
      setSavedAt(new Date());
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-5 max-w-2xl pb-24">
      <form onSubmit={save} className="space-y-5">
        <div>
          <p className="page-kick">Settings</p>
          <h1 className="page-title">Business settings</h1>
          <p className="page-sub">
            Defaults for new retailers, how payments work, what an order needs, how invoices are made, and which messages go out. You can change
            terms for one retailer from their khata.
          </p>
          <div className="flex flex-wrap gap-2 mt-3">
            <a href="#money" className="chip">
              Money
            </a>
            <a href="#cart" className="chip">
              Cart rules
            </a>
            <a href="#online" className="chip">
              Online payments
            </a>
            <a href="#gst" className="chip">
              GST &amp; invoices
            </a>
            <a href="#delivery" className="chip">
              Delivery
            </a>
            <a href="#stock" className="chip">
              Stock
            </a>
            <a href="#field" className="chip">
              Field team
            </a>
            <a href="#messages" className="chip">
              Messages
            </a>
            <a href="#complaints" className="chip">
              Complaints
            </a>
            <a href="#referral" className="chip">
              Refer &amp; earn
            </a>
          </div>
          <div className="flex flex-wrap gap-2 mt-2">
            <Link href="/admin/settings/brand" className="chip chip-kesar">
              Brand <Icon name="arrow" className="h-3.5 w-3.5" />
            </Link>
            <Link href="/admin/settings/domains" className="chip chip-kesar">
              Web address <Icon name="arrow" className="h-3.5 w-3.5" />
            </Link>
            <Link href="/admin/account" className="chip chip-kesar">
              Your data <Icon name="arrow" className="h-3.5 w-3.5" />
            </Link>
            <Link href="/admin/settings/automation" className="chip chip-kesar">
              Automation <Icon name="arrow" className="h-3.5 w-3.5" />
            </Link>
          </div>
        </div>

        <section id="money" className="card p-5 space-y-4 scroll-mt-20">
          <p className="font-heading font-bold">New retailers</p>
          <div>
            <span className="block text-sm font-medium text-[var(--ink-2)] mb-1.5">Default payment mode</span>
            <div className="flex rounded-2xl p-1 bg-ink/5 max-w-md" role="radiogroup">
              {(
                [
                  ["POSTPAID", "Postpaid", "Pays after delivery"],
                  ["PREPAID", "Prepaid", "Pays first, from wallet"],
                ] as const
              ).map(([v, label, hint]) => (
                <button
                  key={v}
                  type="button"
                  role="radio"
                  aria-checked={form.defaultPaymentMode === v}
                  onClick={() => set("defaultPaymentMode", v)}
                  className={`flex-1 rounded-xl py-2 px-2 text-sm font-bold transition ${
                    form.defaultPaymentMode === v ? "bg-gradient-to-br from-mor to-[#0c3634] text-white" : "text-[var(--ink-2)]"
                  }`}
                >
                  {label}
                  <span className={`block text-[11px] font-normal ${form.defaultPaymentMode === v ? "text-white/75" : "text-[var(--muted)]"}`}>
                    {hint}
                  </span>
                </button>
              ))}
            </div>
          </div>
          <div className="grid sm:grid-cols-2 gap-4">
            <label className="block">
              <span className="block text-sm font-medium text-[var(--ink-2)] mb-1">Credit days</span>
              <input
                className="input"
                inputMode="numeric"
                value={form.defaultCreditDays}
                onChange={(e) => set("defaultCreditDays", e.target.value)}
              />
              <span className="block text-xs text-[var(--muted)] mt-1">Days after delivery before a bill is overdue.</span>
            </label>
            <label className="block">
              <span className="block text-sm font-medium text-[var(--ink-2)] mb-1">Credit limit (₹)</span>
              <input
                className="input"
                inputMode="decimal"
                placeholder="No limit"
                value={form.defaultCreditLimit}
                onChange={(e) => set("defaultCreditLimit", e.target.value)}
              />
              <span className="block text-xs text-[var(--muted)] mt-1">Leave blank for no limit. Orders above it wait for your approval.</span>
            </label>
          </div>
        </section>

        <section className="card p-5 space-y-4">
          <p className="font-heading font-bold">Overdue bills</p>
          <label className="flex items-start gap-3 cursor-pointer">
            <input
              type="checkbox"
              className="sr-only peer"
              checked={form.holdOnOverdue}
              onChange={(e) => set("holdOnOverdue", e.target.checked)}
            />
            <span
              aria-hidden="true"
              className={`mt-0.5 shrink-0 h-6 w-11 rounded-full p-0.5 transition peer-focus-visible:ring-2 peer-focus-visible:ring-mor ${
                form.holdOnOverdue ? "bg-mor" : "bg-ink/15"
              }`}
            >
              <span className={`block h-5 w-5 rounded-full bg-white shadow transition ${form.holdOnOverdue ? "translate-x-5" : ""}`} />
            </span>
            <span>
              <span className="block text-sm font-medium">Hold orders when bills are overdue</span>
              <span className="block text-xs text-[var(--muted)]">
                A new order from a retailer with an overdue bill waits until you approve it on the Orders screen.
              </span>
            </span>
          </label>
          <label className={`block max-w-xs ${form.holdOnOverdue ? "" : "opacity-50"}`}>
            <span className="block text-sm font-medium text-[var(--ink-2)] mb-1">Grace days</span>
            <input
              className="input"
              inputMode="numeric"
              disabled={!form.holdOnOverdue}
              value={form.overdueGraceDays}
              onChange={(e) => set("overdueGraceDays", e.target.value)}
            />
            <span className="block text-xs text-[var(--muted)] mt-1">Extra days after the due date before the hold starts.</span>
          </label>
        </section>

        <section className="card p-5 space-y-4">
          <p className="font-heading font-bold">More credit checks</p>
          <label className="block max-w-xs">
            <span className="block text-sm font-medium text-[var(--ink-2)] mb-1">Unpaid bills allowed</span>
            <input
              className="input"
              inputMode="numeric"
              placeholder="No limit"
              value={form.defaultCreditBills}
              onChange={(e) => set("defaultCreditBills", e.target.value.replace(/\D/g, ""))}
            />
            <span className="block text-xs text-[var(--muted)] mt-1">A retailer with this many unpaid bills has new orders held. Leave blank for no limit by bills. Can be set per retailer on their khata.</span>
          </label>
          <Toggle
            checked={form.holdOnBounce}
            onChange={(v) => set("holdOnBounce", v)}
            label="Hold orders after a bounced cheque"
            hint="A retailer whose cheque bounced has new orders held until you approve them."
          />
          <label className={`block max-w-xs ${form.holdOnBounce ? "" : "opacity-50"}`}>
            <span className="block text-sm font-medium text-[var(--ink-2)] mb-1">For how many days</span>
            <input
              className="input"
              inputMode="numeric"
              disabled={!form.holdOnBounce}
              value={form.bounceHoldDays}
              onChange={(e) => set("bounceHoldDays", e.target.value.replace(/\D/g, ""))}
            />
          </label>
          <Toggle
            checked={form.pdcReducesExposure}
            onChange={(v) => set("pdcReducesExposure", v)}
            label="Count post-dated cheques as money on its way"
            hint="Post-dated cheques you are holding from a retailer are taken off what they owe when checking the credit limit. The bills still stay unpaid until the cheque is banked."
          />
          <Toggle
            checked={form.checkCreditAtBilling}
            onChange={(v) => set("checkCreditAtBilling", v)}
            label="Check credit again when the order leaves"
            hint="An order that was fine when placed is checked once more before it goes out. If the retailer has since crossed a limit, it is put on credit hold for approval on the Orders screen. Prepaid retailers and orders already approved are not checked."
          />
        </section>

        <section className="card p-5 space-y-4">
          <p className="font-heading font-bold">UPI and bank taken in the field</p>
          <label className="flex items-start gap-3 cursor-pointer">
            <input
              type="checkbox"
              className="sr-only peer"
              checked={form.checkFieldDigital}
              onChange={(e) => set("checkFieldDigital", e.target.checked)}
            />
            <span
              aria-hidden="true"
              className={`mt-0.5 shrink-0 h-6 w-11 rounded-full p-0.5 transition peer-focus-visible:ring-2 peer-focus-visible:ring-mor ${
                form.checkFieldDigital ? "bg-mor" : "bg-ink/15"
              }`}
            >
              <span className={`block h-5 w-5 rounded-full bg-white shadow transition ${form.checkFieldDigital ? "translate-x-5" : ""}`} />
            </span>
            <span>
              <span className="block text-sm font-medium">Check them before they count</span>
              <span className="block text-xs text-[var(--muted)]">
                A UPI or bank payment entered by a salesperson or driver waits in Payments → To verify until someone in the office sees it in the bank.
                Turned off, it counts at once. Cash and cheques are checked at handover and deposit either way.
              </span>
            </span>
          </label>
        </section>

        <section className="card p-5 space-y-4">
          <p className="font-heading font-bold">Cheques</p>
          <label className="block max-w-xs">
            <span className="block text-sm font-medium text-[var(--ink-2)] mb-1">Cheque bounce charge (₹)</span>
            <input
              className="input"
              inputMode="decimal"
              placeholder="0"
              value={form.chequeBouncePenalty}
              onChange={(e) => set("chequeBouncePenalty", e.target.value)}
            />
            <span className="block text-xs text-[var(--muted)] mt-1">Added to the retailer&apos;s bill when a cheque bounces. 0 means no charge.</span>
          </label>
        </section>

        <section className="card p-5 space-y-4">
          <div>
            <p className="font-heading font-bold flex items-center gap-2">
              <Icon name="qr" className="h-5 w-5" /> UPI for &ldquo;Pay now&rdquo;
            </p>
            <p className="text-sm text-[var(--muted)] mt-1">
              Retailers see a &ldquo;Pay now&rdquo; QR code for this UPI ID with the amount filled in. After paying they send the UTR,
              and it shows under Payments &rarr; To verify. Leave blank to hide &ldquo;Pay now&rdquo;.
            </p>
          </div>
          <div className="grid sm:grid-cols-2 gap-4">
            <label className="block">
              <span className="block text-sm font-medium text-[var(--ink-2)] mb-1">UPI ID</span>
              <input
                className="input"
                autoCapitalize="none"
                autoCorrect="off"
                spellCheck={false}
                placeholder="agency@okaxis"
                value={form.upiVpa}
                onChange={(e) => set("upiVpa", e.target.value)}
              />
            </label>
            <label className="block">
              <span className="block text-sm font-medium text-[var(--ink-2)] mb-1">Payee name</span>
              <input
                className="input"
                maxLength={60}
                placeholder="Name on the bank account"
                value={form.upiPayeeName}
                onChange={(e) => set("upiPayeeName", e.target.value)}
              />
            </label>
          </div>
        </section>

        <div id="cart" className="pt-4 scroll-mt-20">
          <p className="page-kick">Cart rules</p>
          <h2 className="font-heading font-bold text-xl text-[var(--ink)] mt-1">What an order needs</h2>
          <p className="text-sm text-[var(--muted)] mt-1">Checked in the retailer&apos;s cart and again when the order is placed.</p>
        </div>

        <section className="card p-5 space-y-4">
          <p className="font-heading font-bold">Order value and delivery charge</p>
          <div className="grid sm:grid-cols-2 gap-4">
            <label className="block">
              <span className="block text-sm font-medium text-[var(--ink-2)] mb-1">Minimum order (₹)</span>
              <input className="input" inputMode="decimal" placeholder="No minimum" value={cart.minOrderValue} onChange={(e) => setC("minOrderValue", e.target.value)} />
              <span className="block text-xs text-[var(--muted)] mt-1">Goods value after discounts, before GST. Blank or 0 = no minimum.</span>
            </label>
            <label className="block">
              <span className="block text-sm font-medium text-[var(--ink-2)] mb-1">Delivery charge (₹)</span>
              <input className="input" inputMode="decimal" placeholder="Free delivery" value={cart.deliveryCharge} onChange={(e) => setC("deliveryCharge", e.target.value)} />
              <span className="block text-xs text-[var(--muted)] mt-1">Added before GST. Blank or 0 = delivery is always free.</span>
            </label>
            <label className={`block ${cart.deliveryCharge.trim() && Number(cart.deliveryCharge) !== 0 ? "" : "opacity-50"}`}>
              <span className="block text-sm font-medium text-[var(--ink-2)] mb-1">Free delivery above (₹)</span>
              <input
                className="input"
                inputMode="decimal"
                placeholder="Always charge"
                value={cart.freeDeliveryAbove}
                onChange={(e) => setC("freeDeliveryAbove", e.target.value)}
              />
              <span className="block text-xs text-[var(--muted)] mt-1">Goods worth this much or more get free delivery. Blank = always charge.</span>
            </label>
            <label className="block">
              <span className="block text-sm font-medium text-[var(--ink-2)] mb-1">GST on delivery charge</span>
              <select className="input" value={cart.deliveryGstRate} onChange={(e) => setC("deliveryGstRate", e.target.value)}>
                {DELIVERY_GST.map((g) => (
                  <option key={g} value={String(g)}>
                    {g}%
                  </option>
                ))}
              </select>
            </label>
          </div>
          <CartSummary cart={cart} />
        </section>

        <section className="card p-5 space-y-4">
          <p className="font-heading font-bold">Delivery days</p>
          <div className="grid grid-cols-2 gap-4">
            <label className="block">
              <span className="block text-sm font-medium text-[var(--ink-2)] mb-1">Order cut-off time</span>
              <input className="input" type="time" value={cart.cutoffTime} onChange={(e) => setC("cutoffTime", e.target.value)} />
              <span className="block text-xs text-[var(--muted)] mt-1">Orders after this go a day later. Blank = none.</span>
            </label>
            <label className="block">
              <span className="block text-sm font-medium text-[var(--ink-2)] mb-1">Lead days</span>
              <input className="input" inputMode="numeric" value={cart.leadDays} onChange={(e) => setC("leadDays", e.target.value)} />
              <span className="block text-xs text-[var(--muted)] mt-1">Days from order to delivery. 0 = same day, 1 = next day.</span>
            </label>
          </div>
          {cart.cutoffTime && (
            <button type="button" className="btn btn-quiet btn-xs -mt-2" onClick={() => setC("cutoffTime", "")}>
              Remove cut-off time
            </button>
          )}
          <div>
            <span className="block text-sm font-medium text-[var(--ink-2)] mb-1.5">Closed on</span>
            <div className="grid grid-cols-7 gap-1.5 max-w-md">
              {WEEKDAYS.map((d, i) => {
                const closed = cart.closedWeekdays.includes(i);
                return (
                  <button
                    key={d}
                    type="button"
                    aria-pressed={closed}
                    onClick={() => setC("closedWeekdays", closed ? cart.closedWeekdays.filter((x) => x !== i) : [...cart.closedWeekdays, i].sort())}
                    className={`rounded-xl py-2 text-xs font-bold transition ${closed ? "bg-[#fde4e1] text-[#a8281e]" : "bg-ink/5 text-[var(--ink-2)]"}`}
                  >
                    {d}
                  </button>
                );
              })}
            </div>
            <span className="block text-xs text-[var(--muted)] mt-1">Tap a day to mark it closed (red). No deliveries on closed days.</span>
          </div>
          <div className="space-y-2">
            <span className="block text-sm font-medium text-[var(--ink-2)]">Holidays</span>
            <div className="flex gap-2 max-w-sm">
              <input className="input" type="date" min={today} value={holiday} aria-label="Holiday date" onChange={(e) => setHoliday(e.target.value)} />
              <button
                type="button"
                className="btn btn-quiet btn-sm !min-h-[44px] shrink-0"
                disabled={!holiday || cart.holidays.includes(holiday) || cart.holidays.length >= 100}
                onClick={() => {
                  setC("holidays", [...cart.holidays, holiday].sort());
                  setHoliday("");
                }}
              >
                <Icon name="plus" className="h-4 w-4" /> Add
              </button>
            </div>
            <div className="flex flex-wrap gap-1.5">
              {cart.holidays.length === 0 && <span className="text-xs text-[var(--muted)]">No holidays added.</span>}
              {cart.holidays.map((h) => (
                <span key={h} className={`chip ${h < today ? "opacity-50" : ""}`}>
                  {new Date(`${h}T00:00:00`).toLocaleDateString("en-IN", { weekday: "short", day: "numeric", month: "short", year: "numeric" })}
                  <button type="button" aria-label={`Remove holiday ${h}`} onClick={() => setC("holidays", cart.holidays.filter((x) => x !== h))}>
                    <Icon name="x" className="h-3.5 w-3.5" />
                  </button>
                </span>
              ))}
            </div>
          </div>
          <label className="flex items-start gap-3 cursor-pointer">
            <input type="checkbox" className="sr-only peer" checked={cart.allowDateChoice} onChange={(e) => setC("allowDateChoice", e.target.checked)} />
            <span
              aria-hidden="true"
              className={`mt-0.5 shrink-0 h-6 w-11 rounded-full p-0.5 transition peer-focus-visible:ring-2 peer-focus-visible:ring-mor ${
                cart.allowDateChoice ? "bg-mor" : "bg-ink/15"
              }`}
            >
              <span className={`block h-5 w-5 rounded-full bg-white shadow transition ${cart.allowDateChoice ? "translate-x-5" : ""}`} />
            </span>
            <span>
              <span className="block text-sm font-medium">Let retailers choose the delivery day</span>
              <span className="block text-xs text-[var(--muted)]">Off: every order goes on the earliest delivery day.</span>
            </span>
          </label>
          <label className={`block max-w-xs ${cart.allowDateChoice ? "" : "opacity-50"}`}>
            <span className="block text-sm font-medium text-[var(--ink-2)] mb-1">Days ahead to offer</span>
            <input
              className="input"
              inputMode="numeric"
              disabled={!cart.allowDateChoice}
              value={cart.maxDaysAhead}
              onChange={(e) => setC("maxDaysAhead", e.target.value)}
            />
            <span className="block text-xs text-[var(--muted)] mt-1">How many open delivery days they can pick from (1 to 30).</span>
          </label>
        </section>

        <div className="sticky bottom-[5.5rem] md:bottom-3 z-10">
          <div className="card p-3 flex flex-wrap items-center justify-between gap-2">
            <p className="text-sm">
              {error ? (
                <span className="text-[#a8281e]">{error}</span>
              ) : dirty ? (
                <span className="text-[var(--ink-2)]">You have unsaved changes.</span>
              ) : savedAt ? (
                <span className="text-[var(--mint-text)] inline-flex items-center gap-1.5">
                  <Icon name="check" className="h-4 w-4" />
                  Saved at {savedAt.toLocaleTimeString("en-IN", { hour: "numeric", minute: "2-digit" })}
                </span>
              ) : (
                <span className="text-[var(--muted)]">All changes saved.</span>
              )}
            </p>
            <div className="flex gap-2">
              {dirty && (
                <button
                  type="button"
                  className="btn btn-quiet btn-sm"
                  disabled={busy}
                  onClick={() => {
                    setForm(saved);
                    setCart(cartSaved);
                    setError(null);
                  }}
                >
                  Undo
                </button>
              )}
              <button type="submit" className="btn btn-kesar btn-sm" disabled={!dirty || busy}>
                {busy ? "Saving…" : dirty ? "Save changes" : "Saved"}
              </button>
            </div>
          </div>
        </div>
      </form>
      <GatewaySettings />
      <GstSettings invoice={gst.invoice} business={gst.business} />
      <DeliverySettings delivery={delivery} />
      <StockSettings inventory={inventory} />
      <FieldSettings field={field} />
      <MessageSettings notify={engage.notify} channels={engage.channels} />
      <SupportSettings support={engage.support} />
      <ReferralSettings referral={engage.referral} />
    </div>
  );
}

// ───────────────────────────── GST & invoices ─────────────────────────────

type Business = {
  name: string;
  legalName: string | null;
  gstin: string | null;
  stateCode: string | null;
  address: string | null;
  phone: string | null;
};

type GstForm = {
  legalName: string;
  gstin: string;
  stateCode: string;
  address: string;
  phone: string;
  scheme: InvoiceSettings["scheme"];
  issueAt: InvoiceSettings["issueAt"];
  prefixes: InvoiceSettings["prefixes"];
  ratesIncludeGst: boolean;
  roundOff: InvoiceSettings["roundOff"];
  layout: InvoiceSettings["layout"];
  numberingStyle: InvoiceSettings["numbering"]["style"];
  numberingDigits: string;
  city: string;
  pinCode: string;
  terms: string;
  bankName: string;
  bankAccount: string;
  bankIfsc: string;
  upiQr: boolean;
  deliverySac: string;
  einvEnabled: boolean;
  einvProvider: InvoiceSettings["einvoice"]["provider"];
  ewayThreshold: string;
  tally: InvoiceSettings["tally"];
};

const BUSINESS_KEYS = ["legalName", "gstin", "stateCode", "address", "phone"] as const;
const INVOICE_KEYS = ["scheme", "issueAt", "ratesIncludeGst", "roundOff", "layout", "city", "pinCode", "terms", "bankName", "bankAccount", "bankIfsc", "upiQr", "deliverySac"] as const;
const STATE_OPTIONS = Object.entries(STATE_NAMES).sort((a, b) => a[1].localeCompare(b[1]));
const TALLY_FIELDS: { key: keyof InvoiceSettings["tally"]; label: string; hint?: string }[] = [
  { key: "sales", label: "Sales", hint: "Put {rate} in the name for one ledger per GST rate, e.g. “Sales @{rate}%” becomes Sales @18%." },
  { key: "salesReturns", label: "Sales returns", hint: "Used for credit notes. {rate} works here too." },
  { key: "cgst", label: "CGST" },
  { key: "sgst", label: "SGST" },
  { key: "igst", label: "IGST" },
  { key: "roundOff", label: "Round off", hint: "Paise added or taken off when bills are rounded to the rupee." },
  { key: "cash", label: "Cash" },
  { key: "bank", label: "Bank", hint: "UPI, bank transfer and cheque receipts." },
  { key: "debtorsGroup", label: "Retailers' group", hint: "Group for retailer ledgers, usually Sundry Debtors." },
];

function toGstForm(inv: InvoiceSettings, b: Business): GstForm {
  return {
    legalName: b.legalName ?? "",
    gstin: b.gstin ?? "",
    stateCode: b.stateCode ?? "",
    address: b.address ?? "",
    phone: b.phone ?? "",
    scheme: inv.scheme,
    issueAt: inv.issueAt,
    prefixes: { ...inv.prefixes },
    ratesIncludeGst: inv.ratesIncludeGst,
    roundOff: inv.roundOff,
    layout: inv.layout,
    numberingStyle: inv.numbering.style,
    numberingDigits: String(inv.numbering.digits),
    city: inv.city,
    pinCode: inv.pinCode,
    terms: inv.terms,
    bankName: inv.bankName,
    bankAccount: inv.bankAccount,
    bankIfsc: inv.bankIfsc,
    upiQr: inv.upiQr,
    deliverySac: inv.deliverySac,
    einvEnabled: inv.einvoice.enabled,
    einvProvider: inv.einvoice.provider,
    ewayThreshold: rupees(inv.ewayThreshold),
    tally: { ...inv.tally },
  };
}

type GstPatch = { invoice?: Record<string, unknown>; business?: Record<string, unknown> };

/** Only what changed, as { invoice?, business? }, or an error message. */
function toGstPatch(f: GstForm, was: GstForm): GstPatch | string {
  const business: Record<string, unknown> = {};
  for (const k of BUSINESS_KEYS) {
    if (f[k].trim() !== was[k]) business[k] = k === "stateCode" ? f[k] || null : f[k].trim();
  }
  const invoice: Record<string, unknown> = {};
  for (const k of INVOICE_KEYS) {
    const v = f[k];
    const clean = typeof v === "string" ? v.trim() : v;
    if (clean !== was[k]) invoice[k] = clean;
  }
  if (JSON.stringify(f.prefixes) !== JSON.stringify(was.prefixes)) {
    invoice.prefixes = Object.fromEntries(Object.entries(f.prefixes).map(([k, v]) => [k, v.trim().toUpperCase()]));
  }
  if (JSON.stringify(f.tally) !== JSON.stringify(was.tally)) {
    invoice.tally = Object.fromEntries(Object.entries(f.tally).map(([k, v]) => [k, v.trim()]));
  }
  if (f.numberingStyle !== was.numberingStyle || f.numberingDigits.trim() !== was.numberingDigits) {
    const digits = Number(f.numberingDigits.trim());
    if (!Number.isInteger(digits) || digits < 3 || digits > 8) return "Number width must be 3 to 8 digits";
    invoice.numbering = { style: f.numberingStyle, digits };
  }
  if (f.einvEnabled !== was.einvEnabled || f.einvProvider !== was.einvProvider) {
    invoice.einvoice = { enabled: f.einvEnabled, provider: f.einvProvider };
  }
  if (f.ewayThreshold.trim() !== was.ewayThreshold) {
    try {
      const p = toPaise(f.ewayThreshold.trim() || "0");
      if (p < 0) return "E-way bill limit can't be less than ₹0";
      invoice.ewayThreshold = p;
    } catch {
      return "E-way bill limit must be an amount in rupees";
    }
  }
  const out: GstPatch = {};
  if (Object.keys(business).length) out.business = business;
  if (Object.keys(invoice).length) out.invoice = invoice;
  return out;
}

function Choice<T extends string>({
  value,
  onChange,
  options,
}: {
  value: T;
  onChange: (v: T) => void;
  options: readonly (readonly [T, string, string])[];
}) {
  return (
    <div className="flex rounded-2xl p-1 bg-ink/5 max-w-md" role="radiogroup">
      {options.map(([v, label, hint]) => (
        <button
          key={v}
          type="button"
          role="radio"
          aria-checked={value === v}
          onClick={() => onChange(v)}
          className={`flex-1 rounded-xl py-2 px-2 text-sm font-bold transition ${
            value === v ? "bg-gradient-to-br from-mor to-[#0c3634] text-white" : "text-[var(--ink-2)]"
          }`}
        >
          {label}
          <span className={`block text-[11px] font-normal ${value === v ? "text-white/75" : "text-[var(--muted)]"}`}>{hint}</span>
        </button>
      ))}
    </div>
  );
}

const NUMBER_TYPES = [
  ["TAX_INVOICE", "Tax invoice"],
  ["BILL_OF_SUPPLY", "Bill of supply"],
  ["CREDIT_NOTE", "Credit note"],
  ["DEBIT_NOTE", "Debit note"],
] as const;
type NumberType = (typeof NUMBER_TYPES)[number][0];
type NextInfo = Record<NumberType, { next: number; printed: string }>;

/**
 * Carry on the old book's series: the next number per document type. Saved on
 * its own (not with the form) because it moves a counter, and only forward.
 */
function NextNumbers() {
  const [info, setInfo] = useState<NextInfo | null>(null);
  const [typed, setTyped] = useState<Partial<Record<NumberType, string>>>({});
  const [busy, setBusy] = useState<NumberType | null>(null);
  const [msg, setMsg] = useState<{ type: NumberType; text: string; ok: boolean } | null>(null);

  useEffect(() => {
    let live = true;
    fetch("/api/admin/settings/numbering")
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => live && d && setInfo(d.next))
      .catch(() => {});
    return () => {
      live = false;
    };
  }, []);

  async function apply(type: NumberType) {
    const next = Number((typed[type] ?? "").trim());
    if (!Number.isInteger(next) || next < 1) return setMsg({ type, text: "Type the number only, e.g. 4262 for A004262", ok: false });
    setBusy(type);
    setMsg(null);
    try {
      const res = await fetch("/api/admin/settings/numbering", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ type, next }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error ?? "Could not set the number");
      setInfo((prev) => (prev ? { ...prev, [type]: { next: data.next, printed: data.printed } } : prev));
      setTyped((prev) => ({ ...prev, [type]: "" }));
      setMsg({ type, text: `Next one will be ${data.printed}`, ok: true });
    } catch (err) {
      setMsg({ type, text: err instanceof Error ? err.message : "Could not set the number", ok: false });
    } finally {
      setBusy(null);
    }
  }

  if (!info) return null;
  return (
    <div className="mt-4 rounded-2xl bg-ink/5 p-4 space-y-3">
      <div>
        <p className="text-sm font-semibold text-[var(--ink)]">Carry on from your old software</p>
        <p className="text-xs text-[var(--muted)] mt-0.5">
          If the last bill in your old software was A004261, set the tax invoice&apos;s next number to 4262. Numbers can only move forward, never back.
        </p>
      </div>
      <div className="grid sm:grid-cols-2 gap-3">
        {NUMBER_TYPES.map(([type, label]) => (
          <div key={type} className="min-w-0">
            <p className="text-xs font-medium text-[var(--ink-2)]">
              {label}: next is <span className="font-bold text-[var(--ink)]">{info[type].printed}</span>
            </p>
            <div className="flex gap-2 mt-1">
              <input
                className="input !py-1.5 min-w-0"
                inputMode="numeric"
                maxLength={8}
                placeholder={String(info[type].next)}
                aria-label={`${label} next number`}
                value={typed[type] ?? ""}
                onChange={(e) => setTyped((prev) => ({ ...prev, [type]: e.target.value.replace(/\D/g, "") }))}
                onKeyDown={(e) => {
                  // Enter sets this number; it must not submit the settings form around it.
                  if (e.key === "Enter") {
                    e.preventDefault();
                    if (typed[type] && busy === null) apply(type);
                  }
                }}
              />
              <button type="button" className="btn btn-quiet btn-sm shrink-0" disabled={busy !== null || !typed[type]} onClick={() => apply(type)}>
                {busy === type ? "Setting…" : "Set"}
              </button>
            </div>
            {msg?.type === type && (
              <p className={`text-xs mt-1 ${msg.ok ? "text-[var(--mint-text)]" : "text-[#a8281e]"}`}>{msg.text}</p>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

function GstSettings({ invoice, business }: { invoice: InvoiceSettings; business: Business }) {
  const [saved, setSaved] = useState(() => toGstForm(invoice, business));
  const [savedBiz, setSavedBiz] = useState(business);
  const [savedInv, setSavedInv] = useState(invoice);
  const [f, setF] = useState(saved);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [savedAt, setSavedAt] = useState<Date | null>(null);

  const dirty = JSON.stringify(f) !== JSON.stringify(saved);
  const set = <K extends keyof GstForm>(k: K, v: GstForm[K]) => {
    setF((prev) => ({ ...prev, [k]: v }));
    setError(null);
  };
  const setGstin = (raw: string) => {
    const g = raw.replace(/\s/g, "").toUpperCase().slice(0, 15);
    const code = g.slice(0, 2);
    setF((prev) => ({ ...prev, gstin: g, stateCode: g.length >= 2 && STATE_NAMES[code] ? code : prev.stateCode }));
    setError(null);
  };

  async function save(e: React.FormEvent) {
    e.preventDefault();
    const patch = toGstPatch(f, saved);
    if (typeof patch === "string") return setError(patch);
    if (!patch.invoice && !patch.business) {
      setF(saved);
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/admin/settings", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(patch),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error ?? "Could not save");
      const biz: Business = { ...savedBiz, ...(data.business ?? {}) };
      const inv: InvoiceSettings = data.invoice ?? savedInv;
      const next = toGstForm(inv, biz);
      setSavedBiz(biz);
      setSavedInv(inv);
      setSaved(next);
      setF(next);
      setSavedAt(new Date());
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save");
    } finally {
      setBusy(false);
    }
  }

  const missing = [
    !f.gstin.trim() && "GSTIN: needed for tax invoices and e-invoices",
    !f.pinCode.trim() && "PIN code: needed for e-invoices",
    !f.stateCode && "State: decides whether CGST + SGST or IGST is charged",
  ].filter(Boolean) as string[];

  return (
    <form onSubmit={save} className="space-y-5">
      <div id="gst" className="pt-4 scroll-mt-20">
        <p className="page-kick">GST &amp; invoices</p>
        <h2 className="font-heading font-bold text-xl text-[var(--ink)] mt-1">How invoices are made</h2>
        <p className="text-sm text-[var(--muted)] mt-1">Changes apply to new invoices. Invoices already issued keep the details they were made with.</p>
      </div>

      {missing.length > 0 && (
        <div className="card p-4 flex items-start gap-3 !bg-[var(--genda-tint)]">
          <Icon name="alert" className="h-5 w-5 shrink-0 text-[var(--genda-text)] mt-0.5" />
          <div className="text-sm min-w-0">
            <p className="font-semibold">Still missing</p>
            <ul className="list-disc pl-5">
              {missing.map((m) => (
                <li key={m}>{m}</li>
              ))}
            </ul>
          </div>
        </div>
      )}

      <section className="card p-5 space-y-4">
        <p className="font-heading font-bold">Your business</p>
        <div className="grid sm:grid-cols-2 gap-4">
          <Field label="Legal name" hint={`As on your GST certificate. Blank = ${savedBiz.name}.`}>
            <input className="input" maxLength={100} value={f.legalName} onChange={(e) => set("legalName", e.target.value)} />
          </Field>
          <Field label="GSTIN" hint="15 characters. Fills in the state.">
            <input
              className="input uppercase"
              autoCapitalize="characters"
              autoCorrect="off"
              spellCheck={false}
              placeholder="27ABCDE1234F1Z5"
              value={f.gstin}
              onChange={(e) => setGstin(e.target.value)}
            />
          </Field>
          <Field label="State">
            <select className="input" value={f.stateCode} onChange={(e) => set("stateCode", e.target.value)}>
              <option value="">Choose a state</option>
              {STATE_OPTIONS.map(([code, name]) => (
                <option key={code} value={code}>
                  {name} ({code})
                </option>
              ))}
            </select>
          </Field>
          <Field label="Phone on invoices">
            <input className="input" inputMode="tel" maxLength={14} value={f.phone} onChange={(e) => set("phone", e.target.value)} />
          </Field>
          <Field label="Address" className="sm:col-span-2">
            <input className="input" maxLength={200} placeholder="Shop / godown, street, area" value={f.address} onChange={(e) => set("address", e.target.value)} />
          </Field>
          <Field label="City">
            <input className="input" maxLength={50} value={f.city} onChange={(e) => set("city", e.target.value)} />
          </Field>
          <Field label="PIN code">
            <input
              className="input"
              inputMode="numeric"
              maxLength={6}
              value={f.pinCode}
              onChange={(e) => set("pinCode", e.target.value.replace(/\D/g, ""))}
            />
          </Field>
        </div>
      </section>

      <section className="card p-5 space-y-4">
        <p className="font-heading font-bold">Invoice rules</p>
        <div>
          <span className="block text-sm font-medium text-[var(--ink-2)] mb-1.5">GST scheme</span>
          <Choice
            value={f.scheme}
            onChange={(v) => set("scheme", v)}
            options={[
              ["regular", "Regular", "Tax invoices with GST"],
              ["composition", "Composition", "Bills of supply, no GST"],
            ]}
          />
          <span className="block text-xs text-[var(--muted)] mt-1">
            Choose Composition only if you are registered under the composition scheme. You then don&apos;t charge GST on your bills.
          </span>
        </div>
        <div>
          <span className="block text-sm font-medium text-[var(--ink-2)] mb-1.5">Make the invoice</span>
          <Choice
            value={f.issueAt}
            onChange={(v) => set("issueAt", v)}
            options={[
              ["dispatch", "At dispatch", "When the order leaves"],
              ["delivery", "At delivery", "When it is delivered"],
            ]}
          />
          <span className="block text-xs text-[var(--muted)] mt-1">The sale goes into the retailer&apos;s khata at the same moment.</span>
        </div>
        <div>
          <span className="block text-sm font-medium text-[var(--ink-2)] mb-1.5">Number prefixes</span>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            {(
              [
                ["tax", "Tax invoice"],
                ["bos", "Bill of supply"],
                ["credit", "Credit note"],
                ["debit", "Debit note"],
              ] as const
            ).map(([k, label]) => (
              <Field key={k} label={label}>
                <input
                  className="input uppercase"
                  maxLength={5}
                  autoCapitalize="characters"
                  value={f.prefixes[k]}
                  onChange={(e) => set("prefixes", { ...f.prefixes, [k]: e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, "") })}
                />
              </Field>
            ))}
          </div>
          <span className="block text-xs text-[var(--muted)] mt-1">
            {f.numberingStyle === "running"
              ? `Numbers look like ${f.prefixes.tax || "INV"}${"1".padStart(Number(f.numberingDigits) || 6, "0")}: prefix, then a number that keeps counting across years.`
              : `Numbers look like ${f.prefixes.tax || "INV"}2627-00001: prefix, financial year, running number.`}{" "}
            Up to 5 letters or digits.
          </span>
        </div>
        <div>
          <span className="block text-sm font-medium text-[var(--ink-2)] mb-1.5">Invoice numbers</span>
          <Choice
            value={f.numberingStyle}
            onChange={(v) => set("numberingStyle", v)}
            options={[
              ["fy", "New series each year", "INV2627-00001"],
              ["running", "One running series", "A004262, A004263…"],
            ]}
          />
          {f.numberingStyle === "running" && (
            <Field label="Digits after the prefix" hint="A004262 has 6. 3 to 8." className="max-w-[12rem] mt-3">
              <input
                className="input"
                inputMode="numeric"
                maxLength={1}
                value={f.numberingDigits}
                onChange={(e) => set("numberingDigits", e.target.value.replace(/\D/g, ""))}
              />
            </Field>
          )}
          {saved.numberingStyle === "running" && <NextNumbers />}
        </div>
        <Toggle
          checked={f.ratesIncludeGst}
          onChange={(v) => set("ratesIncludeGst", v)}
          label="Rates include GST"
          hint="Product rates, price lists and special rates already have GST in them (the RATE most dealer billing software prints). GST is taken out of each line instead of added on top. Applies to orders placed after you switch."
        />
        <Toggle
          checked={f.roundOff === "rupee"}
          onChange={(v) => set("roundOff", v ? "rupee" : "none")}
          label="Round bills to the rupee"
          hint="Every bill total is rounded to the whole rupee (50 paise and above go up). The paise show on the bill as Round off and go to the Rounding off account. Credit and debit notes are rounded the same way. Applies to orders placed after you switch."
        />
        <div>
          <span className="block text-sm font-medium text-[var(--ink-2)] mb-1.5">Bill layout</span>
          <Choice
            value={f.layout}
            onChange={(v) => set("layout", v)}
            options={[
              ["standard", "Standard", "Clean GST invoice"],
              ["trade", "Trade bill", "Cases, MRP, salesman, GST table"],
            ]}
          />
          <span className="block text-xs text-[var(--muted)] mt-1">
            Trade bill prints cases and pieces, MRP, rate with GST, net rate, SGST/CGST %, the salesman, the due date, a GST class table and sign boxes.
          </span>
        </div>
        <Field label="SAC code for the delivery charge" hint="Printed on the delivery charge line. 996511 is road transport of goods." className="max-w-xs">
          <input
            className="input"
            inputMode="numeric"
            maxLength={8}
            value={f.deliverySac}
            onChange={(e) => set("deliverySac", e.target.value.replace(/\D/g, ""))}
          />
        </Field>
      </section>

      <section className="card p-5 space-y-4">
        <p className="font-heading font-bold">Printed on the invoice</p>
        <Field label="Terms" hint="Shown at the foot of every invoice.">
          <textarea className="input min-h-[80px]" maxLength={500} value={f.terms} onChange={(e) => set("terms", e.target.value)} />
        </Field>
        <div className="grid sm:grid-cols-3 gap-4">
          <Field label="Bank name">
            <input className="input" maxLength={60} value={f.bankName} onChange={(e) => set("bankName", e.target.value)} />
          </Field>
          <Field label="Account number">
            <input
              className="input"
              inputMode="numeric"
              maxLength={18}
              value={f.bankAccount}
              onChange={(e) => set("bankAccount", e.target.value.replace(/\D/g, ""))}
            />
          </Field>
          <Field label="IFSC">
            <input
              className="input uppercase"
              maxLength={11}
              autoCapitalize="characters"
              value={f.bankIfsc}
              onChange={(e) => set("bankIfsc", e.target.value.toUpperCase().replace(/\s/g, ""))}
            />
          </Field>
        </div>
        <p className="text-xs text-[var(--muted)] -mt-2">Leave the bank details blank to keep them off the invoice.</p>
        <Toggle
          checked={f.upiQr}
          onChange={(v) => set("upiQr", v)}
          label="UPI QR code on invoices"
          hint="A QR for the amount due, using the UPI ID under “UPI for Pay now” above."
        />
      </section>

      <section className="card p-5 space-y-4">
        <p className="font-heading font-bold">e-Invoice and e-way bill</p>
        <Toggle
          checked={f.einvEnabled}
          onChange={(v) => set("einvEnabled", v)}
          label="Make e-invoices"
          hint="Turn on when your yearly turnover needs e-invoicing. Only invoices and notes for retailers with a GSTIN get one."
        />
        <Field label="e-Invoice service" className={`max-w-xs ${f.einvEnabled ? "" : "opacity-50"}`}>
          <select
            className="input"
            disabled={!f.einvEnabled}
            value={f.einvProvider}
            onChange={(e) => set("einvProvider", e.target.value as GstForm["einvProvider"])}
          >
            <option value="sandbox">Test mode (sandbox)</option>
            <option value="none">None</option>
          </select>
        </Field>
        <Field label="E-way bill needed from (₹)" hint="Invoice value from which an e-way bill is asked for. ₹50,000 in most states." className="max-w-xs">
          <input className="input" inputMode="decimal" value={f.ewayThreshold} onChange={(e) => set("ewayThreshold", e.target.value)} />
        </Field>
      </section>

      <section className="card p-5 space-y-4">
        <div>
          <p className="font-heading font-bold">Tally ledger names</p>
          <p className="text-sm text-[var(--muted)] mt-1">Spell them exactly as in Tally, so the Tally download lands in the right ledgers.</p>
        </div>
        <div className="grid sm:grid-cols-2 gap-4">
          {TALLY_FIELDS.map((t) => (
            <Field key={t.key} label={t.label} hint={t.hint}>
              <input className="input" maxLength={60} value={f.tally[t.key]} onChange={(e) => set("tally", { ...f.tally, [t.key]: e.target.value })} />
            </Field>
          ))}
        </div>
      </section>

      <div className="sticky bottom-[5.5rem] md:bottom-3 z-10">
        <div className="card p-3 flex flex-wrap items-center justify-between gap-2">
          <p className="text-sm min-w-0">
            {error ? (
              <span className="text-[#a8281e]">{error}</span>
            ) : dirty ? (
              <span className="text-[var(--ink-2)]">Unsaved GST &amp; invoice changes.</span>
            ) : savedAt ? (
              <span className="text-[var(--mint-text)] inline-flex items-center gap-1.5">
                <Icon name="check" className="h-4 w-4" />
                Saved at {savedAt.toLocaleTimeString("en-IN", { hour: "numeric", minute: "2-digit" })}
              </span>
            ) : (
              <span className="text-[var(--muted)]">GST &amp; invoice settings saved.</span>
            )}
          </p>
          <div className="flex gap-2">
            {dirty && (
              <button
                type="button"
                className="btn btn-quiet btn-sm"
                disabled={busy}
                onClick={() => {
                  setF(saved);
                  setError(null);
                }}
              >
                Undo
              </button>
            )}
            <button type="submit" className="btn btn-kesar btn-sm" disabled={!dirty || busy}>
              {busy ? "Saving…" : dirty ? "Save GST settings" : "Saved"}
            </button>
          </div>
        </div>
      </div>
    </form>
  );
}
