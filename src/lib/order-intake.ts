/**
 * A1 on the server: read a typed, spoken or WhatsApp order against the
 * products this shop can see (at its rates). The rules (lib/order-text.ts)
 * always run; when AI is available it reads the message again with the
 * likely products as numbered candidates and picks from them only (it can't
 * invent a product or a price). Nothing is ordered here: the result fills a
 * cart (or a WhatsApp draft) that a person checks and places.
 */
import * as z from "zod";
import type { Prisma } from "@/generated/prisma/client";
import { withTenantTx, type Tx } from "@/lib/db";
import { catalogueFor, retailerPricingCtx, type CatalogueProduct } from "@/lib/pricing";
import { aiJson, aiStatus } from "@/lib/ai";
import { MAX_ORDER_QTY, MAX_ORDER_TEXT, confidenceOf, matchProducts, parseOrderText, parsePhrase, type OrderProduct, type ParsedLine } from "@/lib/order-text";

export type ReadOrder = { lines: ParsedLine[]; source: "ai" | "rules"; credits: number; note: string | null };

const SYSTEM = `You read orders that Indian shopkeepers send to their distributor, in Hindi, Hinglish or English (typed, or spoken and turned into text, so spellings vary).
For each item they ask for, pick the one candidate product it means, by its number, or null if none fits. Never pick a product that isn't in the list.
qty is how many to send. per is "case" only when they asked for cases (peti, carton, box, case, or the product's case name) and the product has a case; otherwise "unit".
Turn weights or volumes into packs using the pack size in the product's name (5 kilo of a 1 kg pack = 5 units). A dozen is 12 units.
said is the words of the message the item came from. Leave out greetings and words like "bhej do", "chahiye".`;

const schema = z.object({
  lines: z.array(z.object({ said: z.string(), i: z.number().int().nullable(), qty: z.number(), per: z.enum(["unit", "case"]) })),
});

const toOrderProduct = (p: CatalogueProduct): OrderProduct => ({ id: p.id, name: p.name, unit: p.unit, caseUnit: p.caseUnit, caseSize: p.caseSize, search: p.search });

/** The products this shop can order (active, visible to it). */
export async function orderableProducts(tx: Tx, retailerId: string) {
  const r = await retailerPricingCtx(tx, retailerId);
  if (!r) return [];
  return catalogueFor(tx, r);
}

/** Candidates for the AI: the whole catalogue when small, else what the rules found for each line. */
function candidates(rules: ParsedLine[], text: string, all: CatalogueProduct[], products: OrderProduct[]): CatalogueProduct[] {
  if (all.length <= 150) return all;
  const ids = new Set<string>();
  for (const l of rules) for (const id of [l.productId, ...l.alternatives]) if (id) ids.add(id);
  // Words the rules didn't place: products that match any one of them.
  for (const w of parsePhrase(text).words) for (const m of matchProducts([w], null, products, 6)) ids.add(m.id);
  const byId = new Map(all.map((p) => [p.id, p]));
  return [...ids].slice(0, 120).map((id) => byId.get(id)!).filter(Boolean);
}

/** Reads `text` for one shop. Never throws for AI trouble: the rules answer instead. */
export async function readOrder(o: { tenantId: string; actorId: string | null; retailerId: string; text: string; now?: Date }): Promise<ReadOrder & { products: CatalogueProduct[] }> {
  const text = o.text.slice(0, MAX_ORDER_TEXT).trim();
  const all = await withTenantTx(o.tenantId, (tx) => orderableProducts(tx, o.retailerId));
  const products = all.map(toOrderProduct);
  const rules = parseOrderText(text, products);
  if (!text) return { lines: [], source: "rules", credits: 0, note: null, products: all };

  const status = await aiStatus(o.tenantId, o.now);
  if (!status.available) return { lines: rules, source: "rules", credits: 0, note: null, products: all };
  const cands = candidates(rules, text, all, products);
  if (!cands.length) return { lines: rules, source: "rules", credits: 0, note: null, products: all };

  const list = cands
    .map((p, i) => `${i}. ${p.name}${p.nameHi ? ` | ${p.nameHi}` : ""}${p.brand ? ` | brand ${p.brand.name}` : ""} | sold per ${p.unit}${p.caseSize ? ` | case: ${p.caseUnit ?? "case"} of ${p.caseSize}` : ""}`)
    .join("\n");
  const r = await aiJson({
    tenantId: o.tenantId,
    actorId: o.actorId,
    feature: "order.read",
    system: SYSTEM,
    prompt: `Candidate products:\n${list}\n\nThe shop's message:\n"""${text}"""`,
    schema,
    maxTokens: 3000,
    now: o.now,
  });
  if (!r.ok) return { lines: rules, source: "rules", credits: 0, note: `${r.message}; read by the built-in rules instead.`, products: all };

  const lines: ParsedLine[] = [];
  for (const x of r.data.lines) {
    const p = x.i !== null ? cands[x.i] : undefined;
    const said = x.said.slice(0, 200);
    const alt = matchProducts(parsePhrase(said).words, null, products, 4).map((m) => m.id);
    if (!p) {
      lines.push({ said, productId: null, qty: Math.max(1, Math.min(MAX_ORDER_QTY, Math.ceil(x.qty) || 1)), per: "unit", confidence: "low", alternatives: alt, note: "Couldn't tell which product: pick one" });
      continue;
    }
    const qty = Math.max(1, Math.min(MAX_ORDER_QTY, Math.ceil(x.qty) || 1));
    const per = x.per === "case" && p.caseSize ? "case" : "unit";
    // Agreeing with the rules makes it sure; otherwise worth a look.
    const rule = rules.find((l) => l.productId === p.id);
    const m = matchProducts(parsePhrase(said).words, null, products, 2);
    const conf = rule && rule.qty === qty && rule.per === per ? "high" : m[0]?.id === p.id ? confidenceOf(m[0].score, m[1]?.score) : "medium";
    lines.push({ said, productId: p.id, qty, per, confidence: conf === "low" ? "medium" : conf, alternatives: alt.filter((id) => id !== p.id), note: x.qty % 1 ? `${x.qty} rounded up to ${qty}` : null });
  }
  return { lines, source: "ai", credits: r.credits, note: null, products: all };
}

/** box → boxes, peti → petis (as said in shops), case → cases. */
const plural = (w: string, n: number) => (n === 1 ? w : /(s|x|z|ch|sh)$/i.test(w) ? `${w}es` : `${w}s`);

/** "• 5 petis of 10 Lemon 1kg" lines for a WhatsApp reply. */
export function linesSummary(lines: ParsedLine[], byId: Map<string, Pick<CatalogueProduct, "name" | "unit" | "caseUnit" | "caseSize">>) {
  return lines
    .map((l) => {
      const p = l.productId ? byId.get(l.productId) : null;
      if (!p) return `• ${l.said}: ? (pick in the app)`;
      const per = l.per === "case" ? `${plural(p.caseUnit ?? "case", l.qty)} of ${p.caseSize}` : p.unit;
      return `• ${l.qty} ${per} ${p.name}`;
    })
    .join("\n");
}

export const DRAFT_DAYS = 3;
export type DraftLines = Prisma.InputJsonValue;
