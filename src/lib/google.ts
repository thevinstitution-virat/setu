import { SignJWT, createRemoteJWKSet, jwtVerify, type JWTVerifyGetKey } from "jose";
import { randomBytes, randomUUID } from "node:crypto";
import { cookies } from "next/headers";
import { sessionSecret } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { normaliseHost, platformDomain, resolveTenantByHost } from "@/lib/tenant";

/**
 * "Continue with Google" (OpenID Connect, authorisation-code flow).
 *
 * Google only returns to addresses listed on the OAuth client, and every
 * business has its own address, so there is ONE return address, on the
 * platform: /api/oauth/google/callback. The round trip:
 *
 *   1. start (on the business or console address): a random nonce goes in a
 *      cookie on that address and, signed into `state`, to Google;
 *   2. callback (platform address): checks state, swaps the code for an ID
 *      token straight from Google, checks its signature, audience and nonce;
 *   3. for a business, signs a 2-minute single-use ticket and sends the
 *      browser back to /api/auth/google/finish on the business address,
 *      which only accepts it in the browser holding the nonce cookie.
 *
 * Google proves who the person is; it never creates a login. It finds the
 * login already linked to that Google account, or one whose email is that
 * address, and the second step (lib/mfa.ts) still follows.
 */

export const googleConfigured = () => !!(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET);

const STATE_AUD = "setu-google-state";
const TICKET_AUD = "setu-google-ticket";
export const NONCE_COOKIE = "setu_g";
const NONCE_SECONDS = 10 * 60;

const scheme = () => process.env.PUBLIC_SCHEME || (platformDomain() === "localhost" ? "http" : "https");
const port = () => (process.env.PUBLIC_PORT ? `:${process.env.PUBLIC_PORT}` : "");

/** An address on a business host checked by checkReturnHost (host may carry a dev port). */
export const hostUrl = (host: string, path: string) => `${scheme()}://${host}${path}`;

/** The one redirect URI to register on the Google OAuth client. */
export const googleRedirectUri = () => `${scheme()}://${platformDomain()}${port()}/api/oauth/google/callback`;

export type GoogleIntent = "signin" | "link";

export type GoogleState = {
  /** Business or console. */
  k: "tenant" | "console";
  intent: GoogleIntent;
  /** Nonce: also in the cookie on the starting address and in Google's ID token. */
  n: string;
  /** Business round trips: which business, and the address to return to. */
  tenantId?: string;
  host?: string;
  /** Linking: who asked (must still be the one signed in at the end). */
  uid?: string;
};

export type GoogleIdentity = { sub: string; email: string; name: string };

const HOST_RE = /^[a-z0-9.-]+(:\d{1,5})?$/;

/** Step 1: sets the nonce cookie and returns the Google sign-in address. */
export async function googleStartUrl(s: Omit<GoogleState, "n">): Promise<string> {
  const n = randomBytes(18).toString("base64url");
  (await cookies()).set(NONCE_COOKIE, n, { httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production", path: "/", maxAge: NONCE_SECONDS });
  const state = await new SignJWT({ ...s, n }).setProtectedHeader({ alg: "HS256" }).setAudience(STATE_AUD).setIssuedAt().setExpirationTime("10m").sign(sessionSecret());
  const q = new URLSearchParams({
    client_id: process.env.GOOGLE_CLIENT_ID ?? "",
    redirect_uri: googleRedirectUri(),
    response_type: "code",
    scope: "openid email profile",
    state,
    nonce: n,
    prompt: "select_account",
  });
  return `https://accounts.google.com/o/oauth2/v2/auth?${q.toString()}`;
}

export class GoogleError extends Error {}

export async function readState(token: string | null): Promise<GoogleState> {
  try {
    const { payload } = await jwtVerify(token ?? "", sessionSecret(), { audience: STATE_AUD, algorithms: ["HS256"] });
    const s = payload as unknown as GoogleState;
    if ((s.k !== "tenant" && s.k !== "console") || typeof s.n !== "string" || (s.intent !== "signin" && s.intent !== "link")) throw new Error("bad state");
    return s;
  } catch {
    throw new GoogleError("This Google sign-in has expired. Please try again.");
  }
}

/** The business address in a state, if it really is that business's address. */
export async function checkReturnHost(s: GoogleState): Promise<string> {
  const host = (s.host ?? "").toLowerCase();
  if (!s.tenantId || !HOST_RE.test(host)) throw new GoogleError("This Google sign-in is not for this business.");
  const t = await resolveTenantByHost(normaliseHost(host));
  if (!t || t.id !== s.tenantId) throw new GoogleError("This Google sign-in is not for this business.");
  return host;
}

let jwks: JWTVerifyGetKey | null = null;

/** Step 2: the code for Google's ID token, checked. */
export async function exchangeCode(code: string, nonce: string, fetchImpl: typeof fetch = fetch): Promise<GoogleIdentity> {
  const res = await fetchImpl("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code,
      client_id: process.env.GOOGLE_CLIENT_ID ?? "",
      client_secret: process.env.GOOGLE_CLIENT_SECRET ?? "",
      redirect_uri: googleRedirectUri(),
      grant_type: "authorization_code",
    }),
    signal: AbortSignal.timeout(10_000),
  }).catch(() => null);
  const data = res ? await res.json().catch(() => null) : null;
  if (!res?.ok || typeof data?.id_token !== "string") throw new GoogleError("Google didn't confirm the sign-in. Please try again.");
  jwks ??= createRemoteJWKSet(new URL("https://www.googleapis.com/oauth2/v3/certs"));
  return identityFromIdToken(data.id_token, nonce, jwks);
}

/** Checks a Google ID token (signature, issuer, audience, expiry, nonce, verified email). */
export async function identityFromIdToken(idToken: string, nonce: string, keys: JWTVerifyGetKey): Promise<GoogleIdentity> {
  let claims: Record<string, unknown>;
  try {
    ({ payload: claims } = await jwtVerify(idToken, keys, {
      issuer: ["https://accounts.google.com", "accounts.google.com"],
      algorithms: ["RS256"],
      audience: process.env.GOOGLE_CLIENT_ID ?? "",
    }));
  } catch {
    throw new GoogleError("Google didn't confirm the sign-in. Please try again.");
  }
  if (claims.nonce !== nonce) throw new GoogleError("This Google sign-in has expired. Please try again.");
  if (claims.email_verified !== true || typeof claims.email !== "string" || typeof claims.sub !== "string") {
    throw new GoogleError("That Google account has no verified email address.");
  }
  return { sub: claims.sub, email: claims.email.toLowerCase(), name: typeof claims.name === "string" ? claims.name : claims.email };
}

/** Step 3 (business): the signed hand-back to the business address. */
export async function signTicket(s: GoogleState, who: GoogleIdentity, host: string): Promise<string> {
  const token = await new SignJWT({ ...who, tenantId: s.tenantId, n: s.n, intent: s.intent, uid: s.uid })
    .setProtectedHeader({ alg: "HS256" })
    .setJti(randomUUID())
    .setAudience(TICKET_AUD)
    .setIssuedAt()
    .setExpirationTime("2m")
    .sign(sessionSecret());
  return hostUrl(host, `/api/auth/google/finish?t=${encodeURIComponent(token)}`);
}

export type Ticket = GoogleIdentity & { tenantId: string; intent: GoogleIntent; uid?: string };

/**
 * On the business address: the ticket must be for this business, from this
 * browser (nonce cookie) and unused (a replay hits AuthTicketUse's key).
 */
export async function redeemTicket(token: string, tenantId: string): Promise<Ticket> {
  let c: Record<string, unknown>;
  try {
    ({ payload: c } = await jwtVerify(token, sessionSecret(), { audience: TICKET_AUD, algorithms: ["HS256"] }));
  } catch {
    throw new GoogleError("This Google sign-in has expired. Please try again.");
  }
  const jar = await cookies();
  const nonce = jar.get(NONCE_COOKIE)?.value;
  jar.delete(NONCE_COOKIE);
  if (c.tenantId !== tenantId) throw new GoogleError("This Google sign-in is not for this business.");
  if (!nonce || nonce !== c.n || typeof c.jti !== "string") throw new GoogleError("This Google sign-in has expired. Please try again.");
  try {
    await prisma.authTicketUse.create({ data: { id: c.jti } });
  } catch {
    throw new GoogleError("This Google sign-in was already used. Please try again.");
  }
  return { sub: String(c.sub), email: String(c.email), name: String(c.name), tenantId, intent: c.intent === "link" ? "link" : "signin", uid: typeof c.uid === "string" ? c.uid : undefined };
}

/** Console round trips end on the same address: the nonce cookie must match. */
export async function checkNonceCookie(n: string) {
  const jar = await cookies();
  const nonce = jar.get(NONCE_COOKIE)?.value;
  jar.delete(NONCE_COOKIE);
  if (!nonce || nonce !== n) throw new GoogleError("This Google sign-in has expired. Please try again.");
}
