/**
 * Payment gateway settings (Tenant.settings.gateway). Client-safe: the
 * secrets are stored encrypted and never sent to the browser; screens only
 * see whether they are set.
 */

export type GatewayProvider = "none" | "razorpay" | "simulator";

export type GatewaySettings = {
  provider: GatewayProvider;
  /** Razorpay key id (rzp_test_… / rzp_live_…); not secret. */
  keyId: string;
  /** Encrypted (lib/secrets.ts). */
  keySecret: string;
  webhookSecret: string;
  /** Let shops pay part of a link. */
  acceptPartial: boolean;
  /** Payment links stay open this many days. */
  linkDays: number;
  /** A delivery QR stays open this many minutes. */
  qrMinutes: number;
  /** Shops can pay their dues online from the khata. */
  retailerPay: boolean;
};

export const GATEWAY_DEFAULTS: GatewaySettings = {
  provider: "none",
  keyId: "",
  keySecret: "",
  webhookSecret: "",
  acceptPartial: false,
  linkDays: 7,
  qrMinutes: 30,
  retailerPay: true,
};

export function gatewaySettings(settings: unknown): GatewaySettings {
  const g = ((settings ?? {}) as { gateway?: Partial<GatewaySettings> }).gateway ?? {};
  return { ...GATEWAY_DEFAULTS, ...g };
}

/** What a screen may see. */
export function publicGateway(g: GatewaySettings) {
  return {
    provider: g.provider,
    keyId: g.keyId,
    mode: g.keyId.startsWith("rzp_live_") ? "live" : g.keyId.startsWith("rzp_test_") ? "test" : null,
    hasKeySecret: !!g.keySecret,
    hasWebhookSecret: !!g.webhookSecret,
    acceptPartial: g.acceptPartial,
    linkDays: g.linkDays,
    qrMinutes: g.qrMinutes,
    retailerPay: g.retailerPay,
  };
}

export const gatewayOn = (g: GatewaySettings) =>
  g.provider === "simulator" || (g.provider === "razorpay" && !!g.keyId && !!g.keySecret);

const int = (v: unknown, min: number, max: number) => (typeof v === "number" && Number.isInteger(v) && v >= min && v <= max ? v : null);

/**
 * Validate a patch. Plain secrets come in as keySecret / webhookSecret and are
 * encrypted by the caller (server); an empty string leaves the saved one.
 */
export function parseGatewaySettings(input: Record<string, unknown>): (Partial<GatewaySettings> & { newKeySecret?: string; newWebhookSecret?: string }) | string {
  const out: Partial<GatewaySettings> & { newKeySecret?: string; newWebhookSecret?: string } = {};
  if ("provider" in input) {
    if (input.provider !== "none" && input.provider !== "razorpay" && input.provider !== "simulator") return "Pick Razorpay or none";
    out.provider = input.provider;
  }
  if ("keyId" in input) {
    const k = typeof input.keyId === "string" ? input.keyId.trim() : "";
    if (k && !/^rzp_(test|live)_[A-Za-z0-9]{8,32}$/.test(k)) return "The key id starts with rzp_test_ or rzp_live_";
    out.keyId = k;
  }
  if ("keySecret" in input && typeof input.keySecret === "string" && input.keySecret.trim()) {
    const v = input.keySecret.trim();
    if (v.length < 12 || v.length > 64 || /\s/.test(v)) return "The key secret looks wrong";
    out.newKeySecret = v;
  }
  if ("webhookSecret" in input && typeof input.webhookSecret === "string" && input.webhookSecret.trim()) {
    const v = input.webhookSecret.trim();
    if (v.length < 8 || v.length > 128) return "The webhook secret must be 8 to 128 characters";
    out.newWebhookSecret = v;
  }
  if ("acceptPartial" in input) out.acceptPartial = input.acceptPartial === true;
  if ("retailerPay" in input) out.retailerPay = input.retailerPay === true;
  if ("linkDays" in input) {
    const v = int(input.linkDays, 1, 90);
    if (v === null) return "Links stay open 1 to 90 days";
    out.linkDays = v;
  }
  if ("qrMinutes" in input) {
    const v = int(input.qrMinutes, 5, 240);
    if (v === null) return "A QR stays open 5 to 240 minutes";
    out.qrMinutes = v;
  }
  return out;
}
