import { randomBytes } from "node:crypto";
import type { TenantDb } from "@/lib/db";
import { sameText, sha256, token } from "@/lib/secrets";

/**
 * API keys for the business's own software (ERP, Tally bridge, BI). Read-only
 * in this phase. A key looks like `setu_<prefix>_<secret>`: the prefix finds
 * the row, only the SHA-256 of the whole key is stored, and the key is shown
 * once when made.
 */

export const SCOPES = {
  "retailers:read": "Shops (name, area, GSTIN, credit terms)",
  "products:read": "Products and prices",
  "orders:read": "Orders and their lines",
  "invoices:read": "Invoices and notes",
  "payments:read": "Payments received",
  "stock:read": "Stock on hand",
} as const;
export type Scope = keyof typeof SCOPES;
export const ALL_SCOPES = Object.keys(SCOPES) as Scope[];

export const RATE_PER_MINUTE = 120;
export const MAX_KEYS = 20;

const PREFIX_CHARS = "abcdefghijkmnpqrstuvwxyz23456789";
const newPrefix = () =>
  Array.from(randomBytes(8))
    .map((b) => PREFIX_CHARS[b % PREFIX_CHARS.length])
    .join("");

export function makeKey() {
  const prefix = newPrefix();
  const key = `setu_${prefix}_${token(24)}`;
  return { prefix, key, hash: sha256(key) };
}

export function parseScopes(v: unknown): Scope[] | string {
  if (!Array.isArray(v) || !v.length) return "Choose what the key may read";
  const out = [...new Set(v.filter((s): s is Scope => typeof s === "string" && s in SCOPES))];
  if (out.length !== v.length) return "Unknown permission in the list";
  return out;
}

/** The key from `Authorization: Bearer …` or `X-Api-Key`. */
export function keyFrom(req: Request) {
  const auth = req.headers.get("authorization");
  const k = auth?.match(/^Bearer\s+(\S+)$/i)?.[1] ?? req.headers.get("x-api-key") ?? "";
  return /^setu_[a-z0-9]{8}_[A-Za-z0-9_-]{20,}$/.test(k) ? k : null;
}

// Per-process limiter (one web container per business today; a shared store comes with scaling out).
const hits = new Map<string, { at: number; n: number }>();
function limited(id: string, now: number) {
  const h = hits.get(id);
  if (!h || now - h.at >= 60_000) {
    hits.set(id, { at: now, n: 1 });
    if (hits.size > 5000) for (const [k, v] of hits) if (now - v.at >= 60_000) hits.delete(k);
    return false;
  }
  h.n++;
  return h.n > RATE_PER_MINUTE;
}

export type KeyCheck = { ok: true; keyId: string; scopes: Scope[] } | { ok: false; status: number; error: string };

export async function checkKey(db: TenantDb, req: Request, need: Scope, ip: string | null, now = Date.now()): Promise<KeyCheck> {
  const key = keyFrom(req);
  if (!key) return { ok: false, status: 401, error: "Send the API key as Authorization: Bearer setu_…" };
  const prefix = key.split("_")[1];
  const row = await db.apiKey.findFirst({ where: { prefix }, select: { id: true, hash: true, scopes: true, revokedAt: true, lastUsedAt: true } });
  if (!row || !sameText(row.hash, sha256(key))) return { ok: false, status: 401, error: "This API key is not valid" };
  if (row.revokedAt) return { ok: false, status: 401, error: "This API key was revoked" };
  if (!row.scopes.includes(need)) return { ok: false, status: 403, error: `This key may not use ${need}` };
  if (limited(row.id, now)) return { ok: false, status: 429, error: `More than ${RATE_PER_MINUTE} requests a minute` };
  if (!row.lastUsedAt || now - row.lastUsedAt.getTime() > 60_000) {
    await db.apiKey.update({ where: { id: row.id }, data: { lastUsedAt: new Date(now), lastUsedIp: ip?.slice(0, 60) ?? null } }).catch(() => null);
  }
  return { ok: true, keyId: row.id, scopes: row.scopes as Scope[] };
}
