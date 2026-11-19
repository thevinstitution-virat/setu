/**
 * The AI gateway (roadmap §7): the one place the app calls a language model.
 *
 * - Provider and model come from the server's environment (AI_PROVIDER,
 *   AI_MODEL), so the model can be swapped without touching features.
 *   Providers: "anthropic" (Claude, official SDK), "fake" (tests), "none"
 *   (the default: every feature uses its plain rules).
 * - A business may use AI only when its plan has the `ai` module, it hasn't
 *   turned AI off (Settings → Automation) and is under its monthly cap.
 * - Every call is logged in AiCostLog with tokens, cost and credits, and the
 *   credits are added to the month's usage (billed over the plan's allowance).
 * - Prompts are scrubbed of phone numbers, emails, GSTINs and PANs before
 *   they leave; features send product data only.
 * - Output is checked against a schema; anything else counts as a failure
 *   and the feature falls back to its rules. The AI never writes to the
 *   books: features turn its output into Suggestions a person accepts.
 */
import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import type * as z from "zod";
import { withTenantTx, type Tx } from "@/lib/db";
import { MoneyError } from "@/lib/money-error";
import { usagePeriod } from "@/lib/billing";
import { hasFeature } from "@/lib/plans";
import { aiSettings, PAISE_PER_CREDIT } from "@/lib/ai-settings";

export type AiProvider = "anthropic" | "fake" | "none";

/** Claude list prices, US$ per million tokens [input, output]. */
const PRICES: Record<string, [number, number]> = {
  "claude-opus-5-5": [4, 20],
  "claude-sonnet-5-5": [2, 10],
  "claude-haiku-5-5": [0.1, 0.5],
  "claude-opus-5": [5, 25],
  "claude-sonnet-5": [2, 10],
  "claude-opus-4-8": [5, 25],
};

export function aiConfig() {
  const p = (process.env.AI_PROVIDER ?? "none").trim().toLowerCase();
  const provider: AiProvider = p === "anthropic" || p === "fake" ? p : "none";
  return {
    provider,
    model: process.env.AI_MODEL?.trim() || "claude-opus-5-5",
    /** Paise per US$ for the cost log. */
    usdPaise: Number(process.env.AI_USD_PAISE) > 0 ? Number(process.env.AI_USD_PAISE) : 8800,
  };
}

/** Provider cost in paise for a call (unknown models are priced like the default). */
export function costPaise(model: string, u: { inputTokens: number; outputTokens: number }, usdPaise = aiConfig().usdPaise) {
  const [pin, pout] = PRICES[model] ?? PRICES["claude-opus-5-5"];
  return Math.round(((u.inputTokens * pin + u.outputTokens * pout) / 1_000_000) * usdPaise);
}

/** Credits for a call: one per ₹0.50 of provider cost, at least one. */
export const creditsFor = (paise: number) => Math.max(1, Math.ceil(paise / PAISE_PER_CREDIT));

const PERSONAL: [RegExp, string][] = [
  [/[\w.+-]+@[\w-]+\.[\w.-]+/g, "[email removed]"],
  [/\b\d{2}[A-Z]{5}\d{4}[A-Z][A-Z\d]Z[A-Z\d]\b/g, "[GSTIN removed]"],
  [/\b[A-Z]{5}\d{4}[A-Z]\b/g, "[PAN removed]"],
  [/(?:\+?91[\s-]?)?\b[6-9]\d{4}[\s-]?\d{5}\b/g, "[phone removed]"],
];

/** Removes phone numbers, emails, GSTINs and PANs from text before it is sent to a provider. */
export function scrubPersonal(text: string) {
  let out = text;
  for (const [re, by] of PERSONAL) out = out.replace(re, by);
  return out;
}

/** Logs one AI call and adds its credits and cost to this month's usage (billed over the plan's allowance). */
export async function recordAiUse(tx: Tx, tenantId: string, u: { feature: string; provider: string; model: string; inputTokens: number; outputTokens: number; costPaise: number; credits: number; actorId?: string | null }, now = new Date()) {
  for (const n of [u.inputTokens, u.outputTokens, u.costPaise, u.credits]) if (!Number.isInteger(n) || n < 0) throw new MoneyError("AI usage must be whole, non-negative numbers");
  await tx.aiCostLog.create({ data: { ...u, actorId: u.actorId ?? null, createdAt: now } });
  await tx.usageCounter.upsert({
    where: { tenantId_period_metric: { tenantId, period: usagePeriod(now), metric: "ai_credits" } },
    create: { tenantId, period: usagePeriod(now), metric: "ai_credits", value: u.credits, costPaise: u.costPaise },
    update: { value: { increment: u.credits }, costPaise: { increment: u.costPaise } },
  });
}

export type AiUnavailable = "no_provider" | "plan" | "off" | "cap";
export type AiStatus = { available: true; model: string; used: number; cap: number | null } | { available: false; reason: AiUnavailable; message: string; used: number; cap: number | null };

/** Whether this business can use AI right now, and why not. */
export async function aiStatus(tenantId: string, now = new Date()): Promise<AiStatus> {
  const cfg = aiConfig();
  const { settings, used } = await withTenantTx(tenantId, async (tx) => ({
    settings: aiSettings((await tx.tenant.findUniqueOrThrow({ where: { id: tenantId }, select: { settings: true } })).settings),
    used: (await tx.usageCounter.findUnique({ where: { tenantId_period_metric: { tenantId, period: usagePeriod(now), metric: "ai_credits" } }, select: { value: true } }))?.value ?? 0,
  }));
  const cap = settings.monthlyCredits;
  const no = (reason: AiUnavailable, message: string): AiStatus => ({ available: false, reason, message, used, cap });
  if (cfg.provider === "none") return no("no_provider", "AI isn't set up on this server yet, so suggestions come from the built-in rules.");
  if (!(await hasFeature(tenantId, "ai"))) return no("plan", "Your plan doesn't include AI assistants, so suggestions come from the built-in rules.");
  if (!settings.on) return no("off", "AI is turned off in Settings → Automation, so suggestions come from the built-in rules.");
  if (cap !== null && used >= cap) return no("cap", `This month's AI cap of ${cap} credits is used up, so suggestions come from the built-in rules.`);
  return { available: true, model: cfg.model, used, cap };
}

type FakeHandler = (o: { feature: string; system: string; prompt: string }) => { data: unknown; inputTokens?: number; outputTokens?: number } | { refuse: true };
let fake: FakeHandler | null = null;
/** Tests: what the "fake" provider answers. */
export function setFakeAi(h: FakeHandler | null) {
  fake = h;
}

export type AiResult<T> = { ok: true; data: T; credits: number; model: string } | { ok: false; reason: AiUnavailable | "refused" | "error"; message: string };

let client: Anthropic | null = null;

/**
 * One structured call: the model must answer with JSON matching `schema`.
 * Returns ok: false (never throws for AI trouble) so the caller can fall
 * back to its rules.
 */
export async function aiJson<T>(o: { tenantId: string; actorId?: string | null; feature: string; system: string; prompt: string; schema: z.ZodType<T>; maxTokens?: number; now?: Date }): Promise<AiResult<T>> {
  const now = o.now ?? new Date();
  const status = await aiStatus(o.tenantId, now);
  if (!status.available) return { ok: false, reason: status.reason, message: status.message };
  const cfg = aiConfig();
  const prompt = scrubPersonal(o.prompt);
  const log = async (model: string, inputTokens: number, outputTokens: number) => {
    const paise = costPaise(model, { inputTokens, outputTokens }, cfg.usdPaise);
    const credits = creditsFor(paise);
    await withTenantTx(o.tenantId, (tx) => recordAiUse(tx, o.tenantId, { feature: o.feature, provider: cfg.provider, model, inputTokens, outputTokens, costPaise: paise, credits, actorId: o.actorId ?? null }, now));
    return credits;
  };

  if (cfg.provider === "fake") {
    if (!fake) return { ok: false, reason: "error", message: "No fake AI handler set" };
    const r = fake({ feature: o.feature, system: o.system, prompt });
    if ("refuse" in r) {
      await log(cfg.model, 100, 0);
      return { ok: false, reason: "refused", message: "The AI declined this request" };
    }
    const credits = await log(cfg.model, r.inputTokens ?? 500, r.outputTokens ?? 200);
    const parsed = o.schema.safeParse(r.data);
    if (!parsed.success) return { ok: false, reason: "error", message: "The AI's answer didn't fit the expected shape" };
    return { ok: true, data: parsed.data, credits, model: cfg.model };
  }

  try {
    client ??= new Anthropic();
    const res = await client.beta.messages.parse(
      {
        model: cfg.model,
        max_tokens: o.maxTokens ?? 16000,
        betas: ["server-side-fallback-2026-07-01"],
        fallbacks: "default",
        system: o.system,
        messages: [{ role: "user", content: prompt }],
        output_config: { format: zodOutputFormat(o.schema), effort: "low" },
      },
      { timeout: 90_000 }
    );
    const u = res.usage;
    const inputTokens = (u.input_tokens ?? 0) + Math.round((u.cache_creation_input_tokens ?? 0) * 1.25) + Math.round((u.cache_read_input_tokens ?? 0) * 0.1);
    const credits = await log(res.model, inputTokens, u.output_tokens ?? 0);
    if (res.stop_reason === "refusal") return { ok: false, reason: "refused", message: "The AI declined this request" };
    if (res.stop_reason === "max_tokens") return { ok: false, reason: "error", message: "The AI's answer was cut off" };
    const parsed = o.schema.safeParse(res.parsed_output);
    if (!parsed.success) return { ok: false, reason: "error", message: "The AI's answer didn't fit the expected shape" };
    return { ok: true, data: parsed.data, credits, model: res.model };
  } catch (e) {
    if (e instanceof Anthropic.RateLimitError) return { ok: false, reason: "error", message: "The AI service is busy; try again in a minute" };
    if (e instanceof Anthropic.AuthenticationError) return { ok: false, reason: "error", message: "The AI service rejected the server's key" };
    if (e instanceof Anthropic.APIError) return { ok: false, reason: "error", message: `The AI service answered ${e.status ?? "with an error"}` };
    console.error("[ai]", o.feature, e);
    return { ok: false, reason: "error", message: "Couldn't reach the AI service" };
  }
}
