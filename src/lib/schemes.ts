import type { SchemeType } from "@/generated/prisma/client";
import { formatINR } from "@/lib/money";

/**
 * Trade scheme engine (Phase 2). Pure functions — no database — so every rule
 * is unit tested. pricing.ts loads the schemes a retailer qualifies for and
 * calls applySchemes() on the cart.
 *
 * Rules:
 * - Schemes run in priority order (lower first), then oldest first.
 * - A scheme sees only the cart lines in its scope (products / brands /
 *   categories incl. sub-categories; all empty = every line).
 * - Percent and slab discounts are worked out on what is left of each line
 *   after earlier schemes, so stacking never takes a line below zero.
 * - A non-stackable scheme skips lines another scheme already touched, and once
 *   it applies, no later scheme touches its lines.
 * - Budget: a scheme gives at most what is left of its budget (discount is cut
 *   down; free goods drop whole sets). Discounts round down to the paisa.
 */

// ───────────────────────────── params ─────────────────────────────

export type BuyXGetYParams = {
  /** Buy this many base units … */
  buyQty: number;
  /** … get this many free. */
  getQty: number;
  /** Free product (cross-SKU). null = the same product as each bought line. */
  freeProductId?: string | null;
  /** Most sets per order (null = no limit). */
  maxSets?: number | null;
};
export type Slab = { min: number; percent?: number; amount?: number };
export type SlabParams = {
  /** qty = base units of scoped items; value = their value in paise before GST. */
  basis: "qty" | "value";
  /** The highest slab reached applies: percent off, or a flat amount (paise). */
  slabs: Slab[];
  /** Most discount per order, paise. */
  cap?: number | null;
};
export type PercentParams = { percent: number; cap?: number | null; minQty?: number; minValue?: number };
export type FlatParams = { amount: number; perUnit?: boolean; minQty?: number; minValue?: number };
export type SchemeParams = BuyXGetYParams | SlabParams | PercentParams | FlatParams;

const int = (v: unknown, min = 0) => typeof v === "number" && Number.isInteger(v) && v >= min;
const optInt = (v: unknown, min = 0) => v === undefined || v === null || int(v, min);
const pct = (v: unknown) => typeof v === "number" && Number.isFinite(v) && v > 0 && v <= 100;

/** Validate params for a scheme type. Returns an error message or clean params. */
export function parseSchemeParams(type: SchemeType, raw: unknown): SchemeParams | string {
  const p = (raw ?? {}) as Record<string, unknown>;
  switch (type) {
    case "BUY_X_GET_Y": {
      if (!int(p.buyQty, 1)) return "Buy quantity must be a whole number of at least 1";
      if (!int(p.getQty, 1)) return "Free quantity must be a whole number of at least 1";
      if (!optInt(p.maxSets, 1)) return "Most sets must be a whole number of at least 1";
      const free = typeof p.freeProductId === "string" && p.freeProductId ? p.freeProductId : null;
      return { buyQty: p.buyQty as number, getQty: p.getQty as number, freeProductId: free, maxSets: (p.maxSets as number) ?? null };
    }
    case "SLAB": {
      if (p.basis !== "qty" && p.basis !== "value") return "Slab basis must be quantity or value";
      if (!Array.isArray(p.slabs) || !p.slabs.length || p.slabs.length > 20) return "Add 1 to 20 slabs";
      const slabs: Slab[] = [];
      for (const s of p.slabs as Record<string, unknown>[]) {
        if (!int(s?.min, 1)) return "Each slab needs a starting quantity or value of at least 1";
        const hasPct = s.percent !== undefined && s.percent !== null;
        const hasAmt = s.amount !== undefined && s.amount !== null;
        if (hasPct === hasAmt) return "Each slab needs either a percent or an amount off";
        if (hasPct && !pct(s.percent)) return "Slab percent must be more than 0 and at most 100";
        if (hasAmt && !int(s.amount, 1)) return "Slab amount must be at least 1 paisa";
        slabs.push(hasPct ? { min: s.min as number, percent: s.percent as number } : { min: s.min as number, amount: s.amount as number });
      }
      slabs.sort((a, b) => a.min - b.min);
      if (new Set(slabs.map((s) => s.min)).size !== slabs.length) return "Two slabs start at the same point";
      if (!optInt(p.cap, 1)) return "Cap must be at least 1 paisa";
      return { basis: p.basis, slabs, cap: (p.cap as number) ?? null };
    }
    case "PERCENT": {
      if (!pct(p.percent)) return "Percent must be more than 0 and at most 100";
      if (!optInt(p.cap, 1)) return "Cap must be at least 1 paisa";
      if (!optInt(p.minQty, 1) || !optInt(p.minValue, 1)) return "Minimums must be whole numbers";
      return { percent: p.percent as number, cap: (p.cap as number) ?? null, minQty: (p.minQty as number) ?? undefined, minValue: (p.minValue as number) ?? undefined };
    }
    case "FLAT": {
      if (!int(p.amount, 1)) return "Amount off must be at least 1 paisa";
      if (!optInt(p.minQty, 1) || !optInt(p.minValue, 1)) return "Minimums must be whole numbers";
      return { amount: p.amount as number, perUnit: p.perUnit === true, minQty: (p.minQty as number) ?? undefined, minValue: (p.minValue as number) ?? undefined };
    }
  }
}

/** Short text for a scheme, e.g. "Buy 10 get 1 free", "5% off (up to ₹200)". */
export function describeScheme(type: SchemeType, params: unknown, freeName?: string | null): string {
  const p = params as Record<string, never>;
  switch (type) {
    case "BUY_X_GET_Y": {
      const x = p as unknown as BuyXGetYParams;
      return `Buy ${x.buyQty} get ${x.getQty} ${freeName ? `${freeName} ` : ""}free`;
    }
    case "SLAB": {
      const x = p as unknown as SlabParams;
      const unit = (n: number) => (x.basis === "qty" ? `${n}+` : `${formatINR(n, { whole: true })}+`);
      return x.slabs.map((s) => `${unit(s.min)}: ${s.percent ? `${s.percent}%` : formatINR(s.amount!, { whole: true })} off`).join(" · ");
    }
    case "PERCENT": {
      const x = p as unknown as PercentParams;
      return `${x.percent}% off${x.cap ? ` (up to ${formatINR(x.cap, { whole: true })})` : ""}${x.minValue ? ` on ${formatINR(x.minValue, { whole: true })}+` : ""}${x.minQty ? ` on ${x.minQty}+ units` : ""}`;
    }
    case "FLAT": {
      const x = p as unknown as FlatParams;
      return `${formatINR(x.amount, { whole: x.amount % 100 === 0 })} off${x.perUnit ? " per unit" : ""}${x.minValue ? ` on ${formatINR(x.minValue, { whole: true })}+` : ""}${x.minQty ? ` on ${x.minQty}+ units` : ""}`;
    }
  }
}

// ───────────────────────────── engine ─────────────────────────────

export type EngineLine = {
  productId: string;
  /** The product's category and every parent category. */
  categoryPath: string[];
  brandId: string | null;
  quantity: number;
  /** Effective rate before GST, paise per base unit. */
  price: number;
};

export type EngineScheme = {
  id: string;
  name: string;
  type: SchemeType;
  params: SchemeParams;
  productIds: string[];
  brandIds: string[];
  categoryIds: string[];
  stackable: boolean;
  priority: number;
  createdAt?: Date;
  /** Paise left in the budget; null = no budget. */
  budgetLeft: number | null;
  /** Uses left for this retailer; null = no limit. */
  usesLeft: number | null;
};

export type FreeGoods = { productId: string; quantity: number; schemeId: string; unitPrice: number };
export type AppliedScheme = {
  schemeId: string;
  name: string;
  type: SchemeType;
  /** Discount + free-goods value, paise. */
  value: number;
  discount: number;
  freeQty: number;
  /** Cut down because the budget ran low. */
  capped: boolean;
};

export type SchemeResult = {
  discounts: number[];
  /** Scheme ids that applied to each line. */
  lineSchemes: string[][];
  free: FreeGoods[];
  applied: AppliedScheme[];
};

export function inScope(s: Pick<EngineScheme, "productIds" | "brandIds" | "categoryIds">, l: EngineLine): boolean {
  if (!s.productIds.length && !s.brandIds.length && !s.categoryIds.length) return true;
  return (
    s.productIds.includes(l.productId) ||
    (l.brandId !== null && s.brandIds.includes(l.brandId)) ||
    l.categoryPath.some((c) => s.categoryIds.includes(c))
  );
}

/** Split `amount` over lines in proportion to `weights`, never more than each weight. */
export function splitProportional(amount: number, weights: number[]): number[] {
  const total = weights.reduce((a, b) => a + b, 0);
  if (amount <= 0 || total <= 0) return weights.map(() => 0);
  const a = Math.min(amount, total);
  const out = weights.map((w) => Math.floor((a * w) / total));
  let left = a - out.reduce((x, y) => x + y, 0);
  // Hand out the remaining paise, largest lines first.
  const order = weights.map((_, i) => i).sort((i, j) => weights[j] - weights[i]);
  for (let k = 0; left > 0; k = (k + 1) % order.length) {
    const i = order[k];
    if (out[i] < weights[i]) {
      out[i] += 1;
      left -= 1;
    }
  }
  return out;
}

/**
 * Apply schemes to cart lines. `priceOf` gives the effective rate of a free
 * product that may not be in the cart (null = not available to this retailer,
 * so the scheme is skipped).
 */
export function applySchemes(
  lines: EngineLine[],
  schemes: EngineScheme[],
  priceOf: (productId: string) => number | null
): SchemeResult {
  const discounts = lines.map(() => 0);
  const touched = lines.map(() => false);
  const locked = lines.map(() => false);
  const lineSchemes: string[][] = lines.map(() => []);
  const free: FreeGoods[] = [];
  const applied: AppliedScheme[] = [];
  const net = (i: number) => lines[i].price * lines[i].quantity - discounts[i];

  const sorted = [...schemes].sort(
    (a, b) => a.priority - b.priority || (a.createdAt?.getTime() ?? 0) - (b.createdAt?.getTime() ?? 0) || a.id.localeCompare(b.id)
  );

  for (const s of sorted) {
    if (s.usesLeft !== null && s.usesLeft <= 0) continue;
    if (s.budgetLeft !== null && s.budgetLeft <= 0) continue;
    const idx = lines
      .map((_, i) => i)
      .filter((i) => !locked[i] && (s.stackable || !touched[i]) && lines[i].quantity > 0 && inScope(s, lines[i]));
    if (!idx.length) continue;

    const qty = idx.reduce((a, i) => a + lines[i].quantity, 0);
    const value = idx.reduce((a, i) => a + net(i), 0);
    const budget = s.budgetLeft ?? Infinity;
    let discount = 0;
    let gifts: FreeGoods[] = [];
    let capped = false;

    if (s.type === "BUY_X_GET_Y") {
      const p = s.params as BuyXGetYParams;
      // Candidate sets in order; each set = getQty free units of one product.
      const sets: { productId: string; unitPrice: number }[] = [];
      if (p.freeProductId) {
        const unitPrice = priceOf(p.freeProductId);
        if (unitPrice === null) continue;
        const n = Math.floor(qty / p.buyQty);
        for (let k = 0; k < n; k++) sets.push({ productId: p.freeProductId, unitPrice });
      } else {
        for (const i of idx) {
          const n = Math.floor(lines[i].quantity / p.buyQty);
          for (let k = 0; k < n; k++) sets.push({ productId: lines[i].productId, unitPrice: lines[i].price });
        }
      }
      const maxSets = p.maxSets ?? Infinity;
      let spent = 0;
      let given = 0;
      const byProduct = new Map<string, FreeGoods>();
      for (const set of sets) {
        if (given >= maxSets) break;
        const v = set.unitPrice * p.getQty;
        if (spent + v > budget) {
          capped = true;
          break;
        }
        spent += v;
        given += 1;
        const g = byProduct.get(set.productId) ?? { productId: set.productId, quantity: 0, schemeId: s.id, unitPrice: set.unitPrice };
        g.quantity += p.getQty;
        byProduct.set(set.productId, g);
      }
      gifts = [...byProduct.values()];
      if (!gifts.length) continue;
    } else {
      if (s.type === "PERCENT") {
        const p = s.params as PercentParams;
        if ((p.minQty && qty < p.minQty) || (p.minValue && value < p.minValue)) continue;
        discount = Math.floor((value * p.percent) / 100);
        if (p.cap) discount = Math.min(discount, p.cap);
      } else if (s.type === "FLAT") {
        const p = s.params as FlatParams;
        if ((p.minQty && qty < p.minQty) || (p.minValue && value < p.minValue)) continue;
        discount = p.perUnit ? p.amount * qty : p.amount;
      } else {
        const p = s.params as SlabParams;
        const measure = p.basis === "qty" ? qty : value;
        const slab = [...p.slabs].reverse().find((x) => measure >= x.min);
        if (!slab) continue;
        discount = slab.percent ? Math.floor((value * slab.percent) / 100) : slab.amount!;
        if (p.cap) discount = Math.min(discount, p.cap);
      }
      discount = Math.min(discount, value);
      if (discount > budget) {
        discount = budget;
        capped = true;
      }
      if (discount <= 0) continue;
      const shares = splitProportional(discount, idx.map(net));
      idx.forEach((i, k) => (discounts[i] += shares[k]));
    }

    for (const i of idx) {
      lineSchemes[i].push(s.id);
      touched[i] = true;
      if (!s.stackable) locked[i] = true;
    }
    free.push(...gifts);
    const freeQty = gifts.reduce((a, g) => a + g.quantity, 0);
    const freeValue = gifts.reduce((a, g) => a + g.quantity * g.unitPrice, 0);
    applied.push({ schemeId: s.id, name: s.name, type: s.type, value: discount + freeValue, discount, freeQty, capped });
  }

  return { discounts, lineSchemes, free, applied };
}
