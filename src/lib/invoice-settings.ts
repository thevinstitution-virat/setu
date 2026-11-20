import { PREFIX_RE } from "@/lib/gst";

/**
 * Per-tenant invoice and GST rules, stored in Tenant.settings.invoice. The
 * seller's legal identity (legal name, GSTIN, state, address) lives on the
 * Tenant row; everything here has a safe default.
 */
export type InvoiceSettings = {
  /** "regular" charges GST on tax invoices; "composition" issues bills of supply with no GST. */
  scheme: "regular" | "composition";
  /** When the invoice is issued and the sale booked: when the order leaves ("dispatch") or when it is delivered. */
  issueAt: "dispatch" | "delivery";
  prefixes: { tax: string; bos: string; credit: string; debit: string };
  /** Seller's city and PIN code (e-invoice and the invoice header). */
  city: string;
  pinCode: string;
  /** Shown at the foot of every invoice. */
  terms: string;
  /** Bank details printed on the invoice (optional). */
  bankName: string;
  bankAccount: string;
  bankIfsc: string;
  /** Print a UPI QR for the amount due (uses the UPI ID from money settings). */
  upiQr: boolean;
  /** SAC code for the delivery charge line. */
  deliverySac: string;
  einvoice: {
    /** Turn on once the tenant's turnover needs e-invoicing (B2B invoices and notes only). */
    enabled: boolean;
    /** "sandbox" makes test IRNs locally; a real GST provider plugs in here. */
    provider: "sandbox" | "none";
  };
  /** Consignment value (paise) from which an e-way bill is needed. */
  ewayThreshold: number;
  tally: {
    sales: string;
    salesReturns: string;
    cgst: string;
    sgst: string;
    igst: string;
    cash: string;
    bank: string;
    debtorsGroup: string;
  };
};

export const INVOICE_DEFAULTS: InvoiceSettings = {
  scheme: "regular",
  issueAt: "dispatch",
  prefixes: { tax: "INV", bos: "BOS", credit: "CN", debit: "DN" },
  city: "",
  pinCode: "",
  terms: "Goods once sold will be taken back only as per our return policy. Subject to local jurisdiction.",
  bankName: "",
  bankAccount: "",
  bankIfsc: "",
  upiQr: true,
  deliverySac: "996511",
  einvoice: { enabled: false, provider: "sandbox" },
  ewayThreshold: 50_000_00,
  tally: {
    sales: "Sales",
    salesReturns: "Sales Returns",
    cgst: "Output CGST",
    sgst: "Output SGST",
    igst: "Output IGST",
    cash: "Cash",
    bank: "Bank",
    debtorsGroup: "Sundry Debtors",
  },
};

export function invoiceSettings(settings: unknown): InvoiceSettings {
  const s = ((settings ?? {}) as { invoice?: Partial<InvoiceSettings> }).invoice ?? {};
  return {
    ...INVOICE_DEFAULTS,
    ...s,
    prefixes: { ...INVOICE_DEFAULTS.prefixes, ...(s.prefixes ?? {}) },
    einvoice: { ...INVOICE_DEFAULTS.einvoice, ...(s.einvoice ?? {}) },
    tally: { ...INVOICE_DEFAULTS.tally, ...(s.tally ?? {}) },
  };
}

const str = (v: unknown, max: number) => String(v ?? "").trim().slice(0, max);

/** Validate a settings patch. Returns an error or the clean (merged for nested objects) patch. */
export function parseInvoiceSettings(input: Record<string, unknown>, current: InvoiceSettings): Partial<InvoiceSettings> | string {
  const out: Partial<InvoiceSettings> = {};
  if ("scheme" in input) {
    if (input.scheme !== "regular" && input.scheme !== "composition") return "GST scheme must be regular or composition";
    out.scheme = input.scheme;
  }
  if ("issueAt" in input) {
    if (input.issueAt !== "dispatch" && input.issueAt !== "delivery") return "Issue the invoice at dispatch or at delivery";
    out.issueAt = input.issueAt;
  }
  if ("prefixes" in input) {
    const p = (input.prefixes ?? {}) as Record<string, unknown>;
    const next = { ...current.prefixes };
    for (const k of ["tax", "bos", "credit", "debit"] as const) {
      if (k in p) {
        const v = str(p[k], 5).toUpperCase();
        if (!PREFIX_RE.test(v)) return "Prefixes: 1–5 capital letters or digits, starting with a letter";
        next[k] = v;
      }
    }
    if (new Set(Object.values(next)).size !== 4) return "Each document type needs its own prefix";
    out.prefixes = next;
  }
  if ("city" in input) out.city = str(input.city, 50);
  if ("pinCode" in input) {
    const v = str(input.pinCode, 6);
    if (v && !/^[1-9][0-9]{5}$/.test(v)) return "PIN code must be 6 digits";
    out.pinCode = v;
  }
  if ("terms" in input) out.terms = str(input.terms, 500);
  if ("bankName" in input) out.bankName = str(input.bankName, 60);
  if ("bankAccount" in input) {
    const v = str(input.bankAccount, 20);
    if (v && !/^[0-9]{6,18}$/.test(v)) return "Account number must be 6 to 18 digits";
    out.bankAccount = v;
  }
  if ("bankIfsc" in input) {
    const v = str(input.bankIfsc, 11).toUpperCase();
    if (v && !/^[A-Z]{4}0[A-Z0-9]{6}$/.test(v)) return "IFSC looks wrong (11 characters, like ABCD0123456)";
    out.bankIfsc = v;
  }
  if ("upiQr" in input) out.upiQr = !!input.upiQr;
  if ("deliverySac" in input) {
    const v = str(input.deliverySac, 8);
    if (!/^\d{4,8}$/.test(v)) return "SAC code must be 4 to 8 digits";
    out.deliverySac = v;
  }
  if ("einvoice" in input) {
    const e = (input.einvoice ?? {}) as Record<string, unknown>;
    const next = { ...current.einvoice };
    if ("enabled" in e) next.enabled = !!e.enabled;
    if ("provider" in e) {
      if (e.provider !== "sandbox" && e.provider !== "none") return "Unknown e-invoice provider";
      next.provider = e.provider;
    }
    out.einvoice = next;
  }
  if ("ewayThreshold" in input) {
    const n = Number(input.ewayThreshold);
    if (!Number.isInteger(n) || n < 0 || n > 1_000_000_000) return "E-way bill threshold must be whole paise";
    out.ewayThreshold = n;
  }
  if ("tally" in input) {
    const t = (input.tally ?? {}) as Record<string, unknown>;
    const next = { ...current.tally };
    for (const k of Object.keys(next) as (keyof InvoiceSettings["tally"])[]) {
      if (k in t) {
        const v = str(t[k], 60);
        if (!v) return "Tally ledger names can't be blank";
        next[k] = v;
      }
    }
    out.tally = next;
  }
  return out;
}
