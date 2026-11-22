import { createHash, createHmac, randomBytes, randomInt, timingSafeEqual } from "node:crypto";

/**
 * Authenticator-app codes (TOTP, RFC 6238): HMAC-SHA1, 30-second steps,
 * 6 digits — what Google Authenticator, Microsoft Authenticator and Authy
 * all read from the QR code. Plus one-time recovery codes for a lost phone.
 * Pure functions; storage and the sign-in steps are in lib/mfa.ts.
 */

const ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
export const STEP_SECONDS = 30;
const DIGITS = 6;
/** Codes one step either side are accepted: phone clocks drift. */
const DRIFT = 1;

export function base32Encode(buf: Buffer): string {
  let bits = 0;
  let value = 0;
  let out = "";
  for (const byte of buf) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += ALPHABET[(value << (5 - bits)) & 31];
  return out;
}

export function base32Decode(text: string): Buffer {
  const clean = text.toUpperCase().replace(/[\s=-]/g, "");
  let bits = 0;
  let value = 0;
  const out: number[] = [];
  for (const ch of clean) {
    const i = ALPHABET.indexOf(ch);
    if (i < 0) throw new Error("Not a base32 secret");
    value = (value << 5) | i;
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  return Buffer.from(out);
}

/** A new 160-bit secret, base32 (what the QR code carries). */
export function newTotpSecret(): string {
  return base32Encode(randomBytes(20));
}

export const stepAt = (ms: number) => Math.floor(ms / 1000 / STEP_SECONDS);

/** The 6-digit code for one 30-second step. */
export function totpCode(secret: string, step: number): string {
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(step));
  const mac = createHmac("sha1", base32Decode(secret)).update(counter).digest();
  const offset = mac[mac.length - 1] & 15;
  const bin = ((mac[offset] & 0x7f) << 24) | (mac[offset + 1] << 16) | (mac[offset + 2] << 8) | mac[offset + 3];
  return String(bin % 10 ** DIGITS).padStart(DIGITS, "0");
}

/**
 * The step a code belongs to (now ± one step), or null. A step at or before
 * lastStep is refused, so a code that was already used (or an older one)
 * can't be replayed.
 */
export function matchTotp(secret: string, code: string, lastStep: number | null | undefined, now = Date.now()): number | null {
  const given = code.replace(/\s/g, "");
  if (!/^\d{6}$/.test(given)) return null;
  const current = stepAt(now);
  for (let d = -DRIFT; d <= DRIFT; d++) {
    const step = current + d;
    if (lastStep != null && step <= lastStep) continue;
    const want = Buffer.from(totpCode(secret, step));
    if (timingSafeEqual(want, Buffer.from(given))) return step;
  }
  return null;
}

/** otpauth:// link the authenticator app reads (also shown as a QR code). */
export function otpauthUrl(secret: string, account: string, issuer: string): string {
  const label = encodeURIComponent(`${issuer}:${account}`);
  const q = new URLSearchParams({ secret, issuer, algorithm: "SHA1", digits: String(DIGITS), period: String(STEP_SECONDS) });
  return `otpauth://totp/${label}?${q.toString()}`;
}

// ---- Recovery codes -------------------------------------------------------

const RC_ALPHABET = "abcdefghjkmnpqrstuvwxyz23456789"; // no 0/o, 1/l/i
export const RECOVERY_COUNT = 10;

/** Ten fresh codes like "k7m2-9xqp", shown once; only their hashes are kept. */
export function newRecoveryCodes(): string[] {
  const one = () => Array.from({ length: 8 }, () => RC_ALPHABET[randomInt(RC_ALPHABET.length)]).join("");
  return Array.from({ length: RECOVERY_COUNT }, () => {
    const c = one();
    return `${c.slice(0, 4)}-${c.slice(4)}`;
  });
}

export const normaliseRecovery = (code: string) => code.toLowerCase().replace(/[^a-z0-9]/g, "");
export const hashRecovery = (code: string) => createHash("sha256").update(`setu-recovery:${normaliseRecovery(code)}`).digest("hex");

/** The stored hashes left after using `code`, or null when it isn't one of them. */
export function spendRecoveryCode(hashes: string[], code: string): string[] | null {
  if (normaliseRecovery(code).length !== 8) return null;
  const h = hashRecovery(code);
  const i = hashes.indexOf(h);
  return i < 0 ? null : [...hashes.slice(0, i), ...hashes.slice(i + 1)];
}
