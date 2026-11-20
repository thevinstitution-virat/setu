/**
 * The business's AI switches, in Tenant.settings.ai (client-safe).
 * `monthlyCredits` caps AI credits a month (null = no cap beyond the plan's
 * billing); when reached, features fall back to their plain rules.
 */
export type AiSettings = { on: boolean; monthlyCredits: number | null };

export const AI_DEFAULTS: AiSettings = { on: true, monthlyCredits: null };

export function aiSettings(settings: unknown): AiSettings {
  const saved = ((settings as { ai?: Partial<AiSettings> } | null)?.ai ?? {}) as Partial<AiSettings>;
  return { ...AI_DEFAULTS, ...saved };
}

export function parseAiSettings(input: Record<string, unknown>): Partial<AiSettings> | string {
  const out: Partial<AiSettings> = {};
  if ("on" in input) {
    if (typeof input.on !== "boolean") return "AI must be on or off";
    out.on = input.on;
  }
  if ("monthlyCredits" in input) {
    const v = input.monthlyCredits;
    if (v === null || v === "") out.monthlyCredits = null;
    else if (typeof v !== "number" || !Number.isInteger(v) || v < 0 || v > 1_000_000) return "The monthly cap must be a whole number of credits (or empty for no cap)";
    else out.monthlyCredits = v;
  }
  return out;
}

/** What one credit stands for, shown on screens: about ₹0.50 of provider cost. */
export const PAISE_PER_CREDIT = 50;
