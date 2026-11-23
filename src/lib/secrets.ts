import { createCipheriv, createDecipheriv, createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { devOrTest } from "@/lib/app-secret";

/**
 * Secrets a business gives us (gateway key secret, webhook secrets) are kept
 * encrypted with AES-256-GCM. The key comes from SECRETS_KEY (32 bytes,
 * base64 or hex); production refuses to run without it. Stored form:
 * `v1:<iv>:<tag>:<data>` (base64url).
 */

function key(): Buffer {
  const raw = process.env.SECRETS_KEY;
  if (raw) {
    const b = /^[0-9a-f]{64}$/i.test(raw) ? Buffer.from(raw, "hex") : Buffer.from(raw, "base64");
    if (b.length !== 32) throw new Error("SECRETS_KEY must be 32 bytes (64 hex characters or base64)");
    return b;
  }
  if (!devOrTest()) throw new Error("SECRETS_KEY must be set (64 hex characters)");
  // Dev / tests only: a fixed key derived from the session secret.
  return createHash("sha256").update(`setu-dev-secrets:${process.env.SESSION_SECRET ?? ""}`).digest();
}

export function encryptSecret(plain: string): string {
  const iv = randomBytes(12);
  const c = createCipheriv("aes-256-gcm", key(), iv);
  const data = Buffer.concat([c.update(plain, "utf8"), c.final()]);
  return ["v1", iv.toString("base64url"), c.getAuthTag().toString("base64url"), data.toString("base64url")].join(":");
}

export function decryptSecret(stored: string | null | undefined): string | null {
  if (!stored) return null;
  const [v, iv, tag, data] = stored.split(":");
  if (v !== "v1" || !iv || !tag || data === undefined) return null;
  try {
    // A full 16-byte tag only: a shortened one would make forging a stored secret far easier.
    const authTag = Buffer.from(tag, "base64url");
    if (authTag.length !== 16) return null;
    const d = createDecipheriv("aes-256-gcm", key(), Buffer.from(iv, "base64url"), { authTagLength: 16 });
    d.setAuthTag(authTag);
    return Buffer.concat([d.update(Buffer.from(data, "base64url")), d.final()]).toString("utf8");
  } catch {
    return null;
  }
}

/** Constant-time compare of two strings (signatures). */
export function sameText(a: string, b: string) {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

export const sha256 = (s: string) => createHash("sha256").update(s).digest("hex");

/** Random token, URL-safe. */
export const token = (bytes = 24) => randomBytes(bytes).toString("base64url");
