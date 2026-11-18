import { NextResponse } from "next/server";
import type { TenantDb } from "@/lib/db";
import { keyBelongsTo } from "@/lib/storage";
import { normaliseCoupon } from "@/lib/pricing";
import { parseSchemeParams } from "@/lib/schemes";
import type { SchemeType } from "@/generated/prisma/client";

/**
 * Input checks for the catalogue / pricing admin routes. Foreign keys and id
 * arrays are NOT filtered by row-level security, so every id a client sends
 * is checked to belong to this tenant (ownIds) before it is stored.
 */

export const bad = (error: string, status = 400) => NextResponse.json({ error }, { status });

type Kind = "area" | "group" | "product" | "brand" | "category" | "retailer" | "priceList";

/** True when every id exists in this tenant (empty = true). */
export async function ownIds(db: TenantDb, kind: Kind, ids: string[]): Promise<boolean> {
  const uniq = [...new Set(ids)];
  if (!uniq.length) return true;
  const where = { id: { in: uniq } };
  const n = await {
    area: () => db.area.count({ where }),
    group: () => db.retailerGroup.count({ where }),
    product: () => db.product.count({ where }),
    brand: () => db.brand.count({ where }),
    category: () => db.category.count({ where }),
    retailer: () => db.retailerProfile.count({ where }),
    priceList: () => db.priceList.count({ where }),
  }[kind]();
  return n === uniq.length;
}

export function idArray(v: unknown, max = 1000): string[] | null {
  if (v === undefined) return null;
  if (!Array.isArray(v) || v.length > max || v.some((x) => typeof x !== "string" || !x || x.length > 40)) return null;
  return [...new Set(v as string[])];
}

const text = (v: unknown, max: number) => (typeof v === "string" ? v.trim().slice(0, max) : "");
const optText = (v: unknown, max: number) => (typeof v === "string" && v.trim() ? v.trim().slice(0, max) : null);
const paise = (v: unknown) => typeof v === "number" && Number.isInteger(v) && v >= 0 && v <= 100_000_000_00;
const GST_RATES = [0, 0.1, 0.25, 1, 1.5, 3, 5, 6, 7.5, 12, 18, 28, 40];

function dateOrNull(v: unknown): Date | null | "bad" {
  if (v === null || v === undefined || v === "") return null;
  if (typeof v !== "string") return "bad";
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? "bad" : d;
}

export type ProductData = Record<string, unknown>;

/** Product create (partial = false) or update (partial = true) body → data or error. */
export async function parseProduct(db: TenantDb, tenantId: string, b: Record<string, unknown>, partial: boolean): Promise<ProductData | string> {
  const d: ProductData = {};
  const has = (k: string) => k in b;
  const need = (k: string) => !partial || has(k);

  if (need("name")) {
    if (!text(b.name, 120)) return "Name is required";
    d.name = text(b.name, 120);
  }
  if (need("sku")) {
    if (!/^[A-Za-z0-9._\-/]{1,40}$/.test(text(b.sku, 40))) return "SKU: 1–40 letters, digits, . _ - /";
    d.sku = text(b.sku, 40);
  }
  if (need("unit")) {
    if (!text(b.unit, 20)) return "Unit is required";
    d.unit = text(b.unit, 20);
  }
  if (need("categoryId")) {
    if (typeof b.categoryId !== "string" || !(await ownIds(db, "category", [b.categoryId]))) return "Choose a category";
    d.categoryId = b.categoryId;
  }
  if (has("brandId")) {
    if (b.brandId === null || b.brandId === "") d.brandId = null;
    else if (typeof b.brandId !== "string" || !(await ownIds(db, "brand", [b.brandId]))) return "Unknown brand";
    else d.brandId = b.brandId;
  }
  for (const k of ["price", "mrp"] as const) {
    if (need(k)) {
      if (!paise(b[k])) return `${k === "price" ? "Rate" : "MRP"} must be whole paise`;
      d[k] = b[k];
    }
  }
  if (has("gstRate")) {
    if (!GST_RATES.includes(Number(b.gstRate))) return `GST must be one of ${GST_RATES.join(", ")}%`;
    d.gstRate = Number(b.gstRate);
  }
  if (has("hsnCode")) {
    const code = optText(b.hsnCode, 8);
    if (code && !/^\d{4,8}$/.test(code)) return "HSN code must be 4 to 8 digits";
    d.hsnCode = code;
    if (code) {
      const hsn = await db.hsnCode.findFirst({ where: { code } });
      if (hsn) d.gstRate = hsn.gstRate; // the HSN table decides the rate
    }
  }
  if (has("caseUnit") || has("caseSize")) {
    const unit = optText(b.caseUnit, 20);
    const size = b.caseSize === null || b.caseSize === "" || b.caseSize === undefined ? null : Number(b.caseSize);
    if ((unit === null) !== (size === null)) return "Give both the case name and how many units are in it";
    if (size !== null && (!Number.isInteger(size) || size < 2 || size > 10000)) return "A case must hold 2 to 10,000 units";
    d.caseUnit = unit;
    d.caseSize = size;
  }
  if (has("moq")) {
    const m = Number(b.moq);
    if (!Number.isInteger(m) || m < 1 || m > 100000) return "Minimum order quantity must be at least 1";
    d.moq = m;
  }
  if (has("sort")) d.sort = Number.isInteger(b.sort) ? b.sort : 0;
  if (has("active")) d.active = b.active === true;
  if (has("specialOffer")) d.specialOffer = optText(b.specialOffer, 120);
  if (has("nameHi")) d.nameHi = optText(b.nameHi, 120);
  if (has("aliases")) d.aliases = optText(b.aliases, 300);
  if (has("description")) d.description = optText(b.description, 1000);
  if (has("images")) {
    // Storage keys (t/<tenant>/product-image/...), not ids: checked by keyBelongsTo.
    if (!Array.isArray(b.images) || b.images.length > 6) return "Up to 6 photos";
    const keys = b.images as string[];
    if (keys.some((k) => typeof k !== "string" || !keyBelongsTo(k, tenantId))) return "Unknown photo";
    d.images = keys.slice(0, 6);
  }
  for (const [k, kind] of [["visibleAreaIds", "area"], ["visibleGroupIds", "group"]] as const) {
    if (has(k)) {
      const ids = idArray(b[k]);
      if (!ids || !(await ownIds(db, kind, ids))) return `Unknown ${kind} in visibility`;
      d[k] = ids;
    }
  }
  return d;
}

export async function parseTargeting(db: TenantDb, b: Record<string, unknown>, withRetailers: boolean) {
  const out: Record<string, string[]> = {};
  const fields = [["areaIds", "area"], ["groupIds", "group"], ...(withRetailers ? ([["retailerIds", "retailer"]] as const) : [])] as const;
  for (const [k, kind] of fields) {
    if (k in b) {
      const ids = idArray(b[k]);
      if (!ids || !(await ownIds(db, kind, ids))) return `Unknown ${kind} in targeting`;
      out[k] = ids;
    }
  }
  return out;
}

const SCHEME_TYPES: SchemeType[] = ["BUY_X_GET_Y", "SLAB", "PERCENT", "FLAT"];

/** Scheme create / update body → data or error. Type can't change after creation. */
export async function parseScheme(db: TenantDb, b: Record<string, unknown>, existing: { type: SchemeType } | null) {
  const d: Record<string, unknown> = {};
  const has = (k: string) => k in b;
  if (!existing || has("name")) {
    if (!text(b.name, 80)) return "Name is required";
    d.name = text(b.name, 80);
  }
  if (has("description")) d.description = optText(b.description, 300);
  const type = existing?.type ?? (b.type as SchemeType);
  if (!SCHEME_TYPES.includes(type)) return "Choose a scheme type";
  if (!existing) d.type = type;
  if (!existing || has("params")) {
    const params = parseSchemeParams(type, b.params);
    if (typeof params === "string") return params;
    const free = (params as { freeProductId?: string | null }).freeProductId;
    if (free && !(await ownIds(db, "product", [free]))) return "Unknown free product";
    d.params = params;
  }
  for (const [k, kind] of [["productIds", "product"], ["brandIds", "brand"], ["categoryIds", "category"]] as const) {
    if (has(k)) {
      const ids = idArray(b[k]);
      if (!ids || !(await ownIds(db, kind, ids))) return `Unknown ${kind} in scope`;
      d[k] = ids;
    }
  }
  const t = await parseTargeting(db, b, true);
  if (typeof t === "string") return t;
  Object.assign(d, t);
  if (has("couponCode")) {
    const c = normaliseCoupon(b.couponCode);
    if (c && !/^[A-Z0-9_-]{3,30}$/.test(c)) return "Coupon code: 3–30 letters or digits";
    d.couponCode = c || null;
  }
  for (const k of ["startsAt", "endsAt"] as const) {
    if (has(k)) {
      const v = dateOrNull(b[k]);
      if (v === "bad") return "Dates must be valid";
      d[k] = v;
    }
  }
  if (d.startsAt && d.endsAt && (d.startsAt as Date) > (d.endsAt as Date)) return "The scheme ends before it starts";
  if (has("priority")) {
    const p = Number(b.priority);
    if (!Number.isInteger(p) || p < 0 || p > 1000) return "Priority must be 0 to 1000";
    d.priority = p;
  }
  if (has("stackable")) d.stackable = b.stackable !== false;
  if (has("budget")) {
    if (b.budget !== null && !paise(b.budget)) return "Budget must be whole paise";
    d.budget = b.budget;
  }
  if (has("maxUsesPerRetailer")) {
    const m = b.maxUsesPerRetailer;
    if (m !== null && (!Number.isInteger(m) || (m as number) < 1)) return "Uses per retailer must be at least 1";
    d.maxUsesPerRetailer = m;
  }
  if (has("active")) d.active = b.active === true;
  return d;
}

export async function parseBanner(db: TenantDb, tenantId: string, b: Record<string, unknown>, partial: boolean) {
  const d: Record<string, unknown> = {};
  const has = (k: string) => k in b;
  if (!partial || has("title")) {
    if (!text(b.title, 80)) return "Title is required";
    d.title = text(b.title, 80);
  }
  if (has("subtitle")) d.subtitle = optText(b.subtitle, 160);
  if (has("imageKey")) {
    if (b.imageKey !== null && (typeof b.imageKey !== "string" || !keyBelongsTo(b.imageKey, tenantId))) return "Unknown image";
    d.imageKey = b.imageKey;
  }
  if (has("linkType") || has("linkId")) {
    const type = b.linkType ?? null;
    if (type !== null && !["product", "brand", "category", "scheme", "url"].includes(type as string)) return "Unknown link type";
    const id = typeof b.linkId === "string" ? b.linkId.trim().slice(0, 300) : null;
    if (type === "url" && id && !/^https:\/\//.test(id)) return "Links must start with https://";
    if (type && type !== "url" && type !== "scheme" && id && !(await ownIds(db, type as Kind, [id]))) return "Unknown link target";
    d.linkType = type;
    d.linkId = type ? id : null;
  }
  const t = await parseTargeting(db, b, false);
  if (typeof t === "string") return t;
  Object.assign(d, t);
  for (const k of ["startsAt", "endsAt"] as const) {
    if (has(k)) {
      const v = dateOrNull(b[k]);
      if (v === "bad") return "Dates must be valid";
      d[k] = v;
    }
  }
  if (has("sort")) d.sort = Number.isInteger(b.sort) ? b.sort : 0;
  if (has("active")) d.active = b.active === true;
  return d;
}

export { text, optText, paise, GST_RATES };
