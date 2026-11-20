import { APP_NAME, APP_SHORT_NAME } from "@/lib/brand";

/**
 * White-label (Phase 9). A tenant's look lives in Tenant.brand:
 *
 *   { appName, shortName, tagline, logoKey, iconKey, primary, accent, surface,
 *     invoice: { accent, footer, showLogo }, sender: { smsSenderId, whatsappName, emailFromName, replyTo } }
 *
 * Colours map onto our design tokens (globals.css): primary → the deep "mor"
 * family (headers, links, nav), accent → the "kesar" family (main buttons),
 * surface → the page background. Shades are derived here, and every colour is
 * checked for contrast before it is saved, so a tenant cannot make the app
 * unreadable. Only #rrggbb values ever reach the CSS (no injection).
 *
 * Without the whiteLabel module only the app name applies; logo and colours
 * fall back to ours (effectiveBrand).
 */

export type Brand = {
  appName?: string;
  shortName?: string;
  tagline?: string;
  logoKey?: string;
  iconKey?: string;
  primary?: string;
  accent?: string;
  surface?: string;
  invoice?: { accent?: string; footer?: string; showLogo?: boolean };
  sender?: { smsSenderId?: string; whatsappName?: string; emailFromName?: string; replyTo?: string };
};

export const DEFAULT_COLOURS = { primary: "#155651", accent: "#db5c17", surface: "#f6f1e7" } as const;

const HEX = /^#[0-9a-f]{6}$/;
export const normHex = (v: unknown): string | null => {
  if (typeof v !== "string") return null;
  let s = v.trim().toLowerCase();
  if (/^#?[0-9a-f]{3}$/.test(s)) s = "#" + s.replace("#", "").split("").map((c) => c + c).join("");
  if (!s.startsWith("#")) s = "#" + s;
  return HEX.test(s) ? s : null;
};

type RGB = [number, number, number];
const toRgb = (h: string): RGB => {
  const n = parseInt(h.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
};
const toHex = ([r, g, b]: RGB) => "#" + [r, g, b].map((x) => Math.round(Math.max(0, Math.min(255, x))).toString(16).padStart(2, "0")).join("");

/** Blend a colour toward another (t = 0 → a, 1 → b). */
export function mix(a: string, b: string, t: number) {
  const x = toRgb(a);
  const y = toRgb(b);
  return toHex([x[0] + (y[0] - x[0]) * t, x[1] + (y[1] - x[1]) * t, x[2] + (y[2] - x[2]) * t]);
}

/** WCAG relative luminance. */
export function luminance(h: string) {
  const [r, g, b] = toRgb(h).map((v) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** WCAG contrast ratio, 1–21. */
export function contrast(a: string, b: string) {
  const [x, y] = [luminance(a), luminance(b)].sort((p, q) => q - p);
  return (x + 0.05) / (y + 0.05);
}

/** Darken until the colour reads as text on `bg` (≥ 4.5:1). */
export function readableOn(c: string, bg = "#ffffff") {
  let out = c;
  for (let i = 0; i < 20 && contrast(out, bg) < 4.5; i++) out = mix(out, "#000000", 0.08);
  return out;
}

export type ColourCheck = { field: "primary" | "accent" | "surface"; message: string };

/**
 * Contrast rules for a set of colours. primary carries white text (nav,
 * headers) and is used as text on white: ≥ 4.5. accent carries white bold
 * button text: ≥ 3 (large / bold text rule). surface sits behind dark ink: it
 * must stay light.
 */
export function checkColours(c: { primary: string; accent: string; surface: string }): ColourCheck[] {
  const out: ColourCheck[] = [];
  const p = contrast(c.primary, "#ffffff");
  if (p < 4.5) out.push({ field: "primary", message: `Main colour is too light for white text (contrast ${p.toFixed(1)}:1, needs 4.5:1). Pick a darker shade.` });
  const a = contrast(c.accent, "#ffffff");
  if (a < 3) out.push({ field: "accent", message: `Button colour is too light for white text (contrast ${a.toFixed(1)}:1, needs 3:1). Pick a darker shade.` });
  if (luminance(c.surface) < 0.7) out.push({ field: "surface", message: "Background must be a light colour so text stays readable." });
  const ink = contrast("#0f2a2a", c.surface);
  if (ink < 7 && luminance(c.surface) >= 0.7) out.push({ field: "surface", message: `Text on this background is hard to read (contrast ${ink.toFixed(1)}:1, needs 7:1).` });
  return out;
}

const str = (v: unknown, max: number) => (typeof v === "string" ? v.trim().slice(0, max) : undefined);

/** Read a stored brand (tolerant: bad values are dropped). */
export function parseBrand(v: unknown): Brand {
  const o = (v && typeof v === "object" ? v : {}) as Record<string, unknown>;
  const inv = (o.invoice && typeof o.invoice === "object" ? o.invoice : {}) as Record<string, unknown>;
  const snd = (o.sender && typeof o.sender === "object" ? o.sender : {}) as Record<string, unknown>;
  const b: Brand = {};
  const set = <K extends keyof Brand>(k: K, val: Brand[K] | null | undefined) => {
    if (val !== undefined && val !== null && val !== "") b[k] = val;
  };
  set("appName", str(o.appName, 40));
  set("shortName", str(o.shortName, 12));
  set("tagline", str(o.tagline, 120));
  set("logoKey", typeof o.logoKey === "string" ? o.logoKey : undefined);
  set("iconKey", typeof o.iconKey === "string" ? o.iconKey : undefined);
  set("primary", normHex(o.primary));
  set("accent", normHex(o.accent));
  set("surface", normHex(o.surface));
  const invoice: NonNullable<Brand["invoice"]> = {};
  if (normHex(inv.accent)) invoice.accent = normHex(inv.accent)!;
  if (str(inv.footer, 300)) invoice.footer = str(inv.footer, 300);
  if (typeof inv.showLogo === "boolean") invoice.showLogo = inv.showLogo;
  if (Object.keys(invoice).length) b.invoice = invoice;
  const sender: NonNullable<Brand["sender"]> = {};
  const sid = str(snd.smsSenderId, 6)?.toUpperCase();
  if (sid && /^[A-Z]{6}$/.test(sid)) sender.smsSenderId = sid;
  if (str(snd.whatsappName, 40)) sender.whatsappName = str(snd.whatsappName, 40);
  if (str(snd.emailFromName, 40)) sender.emailFromName = str(snd.emailFromName, 40);
  const rt = str(snd.replyTo, 120);
  if (rt && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(rt)) sender.replyTo = rt;
  if (Object.keys(sender).length) b.sender = sender;
  return b;
}

export type BrandInputResult = { ok: true; brand: Brand } | { ok: false; errors: { field: string; message: string }[] };

/**
 * Validate a brand update from the settings screen, merged over the stored
 * one. Strict: a bad colour or sender id is an error, not silently dropped.
 */
export function validateBrandInput(current: Brand, input: Record<string, unknown>, keyOk: (key: string) => boolean): BrandInputResult {
  const errors: { field: string; message: string }[] = [];
  const next: Record<string, unknown> = { ...current, invoice: { ...current.invoice }, sender: { ...current.sender } };
  for (const k of ["appName", "shortName", "tagline"] as const) {
    if (k in input) next[k] = typeof input[k] === "string" ? (input[k] as string).trim() : undefined;
  }
  if (typeof next.appName === "string" && (next.appName as string).length > 40) errors.push({ field: "appName", message: "App name: at most 40 characters" });
  if (typeof next.shortName === "string" && (next.shortName as string).length > 12) errors.push({ field: "shortName", message: "Short name (under the phone icon): at most 12 characters" });
  if (typeof next.tagline === "string" && (next.tagline as string).length > 120) errors.push({ field: "tagline", message: "Sign-in line: at most 120 characters" });
  for (const k of ["logoKey", "iconKey"] as const) {
    if (!(k in input)) continue;
    const v = input[k];
    if (v === null || v === "") next[k] = undefined;
    else if (typeof v === "string" && keyOk(v)) next[k] = v;
    else errors.push({ field: k, message: "Upload the picture again" });
  }
  for (const k of ["primary", "accent", "surface"] as const) {
    if (!(k in input)) continue;
    if (input[k] === null || input[k] === "") next[k] = undefined;
    else if (normHex(input[k])) next[k] = normHex(input[k]);
    else errors.push({ field: k, message: "Colour must look like #1a5c55" });
  }
  const inv = (input.invoice && typeof input.invoice === "object" ? input.invoice : null) as Record<string, unknown> | null;
  if (inv) {
    const o = next.invoice as Record<string, unknown>;
    if ("accent" in inv) {
      if (inv.accent === null || inv.accent === "") delete o.accent;
      else if (normHex(inv.accent)) o.accent = normHex(inv.accent);
      else errors.push({ field: "invoice.accent", message: "Invoice colour must look like #1a5c55" });
    }
    if ("footer" in inv) {
      const f = typeof inv.footer === "string" ? inv.footer.trim() : "";
      if (f.length > 300) errors.push({ field: "invoice.footer", message: "Invoice footer: at most 300 characters" });
      else o.footer = f || undefined;
    }
    if ("showLogo" in inv) o.showLogo = inv.showLogo === true;
  }
  const snd = (input.sender && typeof input.sender === "object" ? input.sender : null) as Record<string, unknown> | null;
  if (snd) {
    const o = next.sender as Record<string, unknown>;
    if ("smsSenderId" in snd) {
      const s = typeof snd.smsSenderId === "string" ? snd.smsSenderId.trim().toUpperCase() : "";
      if (s && !/^[A-Z]{6}$/.test(s)) errors.push({ field: "sender.smsSenderId", message: "SMS sender id: exactly 6 letters (as registered on DLT)" });
      else o.smsSenderId = s || undefined;
    }
    for (const k of ["whatsappName", "emailFromName"] as const) {
      if (!(k in snd)) continue;
      const s = typeof snd[k] === "string" ? (snd[k] as string).trim() : "";
      if (s.length > 40) errors.push({ field: `sender.${k}`, message: "At most 40 characters" });
      else o[k] = s || undefined;
    }
    if ("replyTo" in snd) {
      const s = typeof snd.replyTo === "string" ? snd.replyTo.trim() : "";
      if (s && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s)) errors.push({ field: "sender.replyTo", message: "Reply-to must be an email address" });
      else o.replyTo = s || undefined;
    }
  }
  const brand = parseBrand(next);
  const colours = { ...DEFAULT_COLOURS, ...pick(brand) };
  for (const c of checkColours(colours)) if (brand[c.field]) errors.push(c);
  return errors.length ? { ok: false, errors } : { ok: true, brand };
}

const pick = (b: Brand) => {
  const o: Partial<Record<"primary" | "accent" | "surface", string>> = {};
  if (b.primary) o.primary = b.primary;
  if (b.accent) o.accent = b.accent;
  if (b.surface) o.surface = b.surface;
  return o;
};

/** The brand actually shown: logo and colours only with the whiteLabel module. */
export function effectiveBrand(brand: Brand, whiteLabel: boolean): Brand {
  if (whiteLabel) return brand;
  const { appName, shortName, tagline, sender } = brand;
  return { appName, shortName, tagline, sender };
}

export function appNameOf(brand: Brand, tenantName?: string | null) {
  return brand.appName || tenantName || APP_NAME;
}
export function shortNameOf(brand: Brand, tenantName?: string | null) {
  return brand.shortName || (brand.appName || tenantName || "").slice(0, 12) || APP_SHORT_NAME;
}

/** Token overrides for globals.css. Empty when the tenant uses our colours. */
export function themeVars(brand: Brand): Record<string, string> {
  const v: Record<string, string> = {};
  if (brand.primary) {
    v["--mor"] = brand.primary;
    v["--mor-mid"] = mix(brand.primary, "#000000", 0.35);
    v["--mor-dark"] = mix(brand.primary, "#000000", 0.55);
  }
  if (brand.accent) {
    v["--kesar"] = brand.accent;
    v["--kesar-mid"] = mix(brand.accent, "#000000", 0.1);
    v["--kesar-dark"] = mix(brand.accent, "#000000", 0.25);
    v["--kesar-text"] = readableOn(mix(brand.accent, "#000000", 0.25));
    v["--kesar-tint"] = mix(brand.accent, "#ffffff", 0.85);
  }
  if (brand.surface) v["--background"] = brand.surface;
  return v;
}

/** A `:root{…}` rule, or "" — values are only ever #rrggbb. */
export function themeCss(brand: Brand): string {
  const entries = Object.entries(themeVars(brand)).filter(([, val]) => HEX.test(val));
  return entries.length ? `:root{${entries.map(([k, val]) => `${k}:${val}`).join(";")}}` : "";
}

export function themeColour(brand: Brand) {
  return brand.primary ?? DEFAULT_COLOURS.primary;
}

/** PWA manifest for a tenant (served at /manifest.webmanifest). */
export function manifestFor(brand: Brand, tenantName: string | null) {
  const hasIcon = !!(brand.iconKey || brand.logoKey);
  const icon = (size: number) => ({ src: hasIcon ? `/brand/icon/${size}` : `/icon-${size}.png`, sizes: `${size}x${size}`, type: "image/png", purpose: "any maskable" });
  const name = appNameOf(brand, tenantName);
  return {
    name: tenantName ? name : `${APP_NAME} — Retailer to Delivery`,
    short_name: shortNameOf(brand, tenantName),
    description: tenantName ? `Order, deliver and pay with ${name}.` : "One connected app for retailer ordering, sales field activity and delivery.",
    start_url: "/",
    scope: "/",
    display: "standalone",
    background_color: brand.surface ?? DEFAULT_COLOURS.surface,
    theme_color: themeColour(brand),
    orientation: "portrait",
    icons: [icon(192), icon(512)],
  };
}
