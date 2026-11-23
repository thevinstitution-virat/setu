/**
 * Request checks shared by the proxy (edge-safe: no database, no Node APIs).
 *
 * Cross-site writes: the session cookie is SameSite=Lax, which already keeps
 * it off cross-site POSTs in current browsers. As a second lock, a browser
 * write to /api whose Origin is another host is refused. Calls without an
 * Origin (Razorpay and Meta webhooks, the API with keys, curl) pass, as do
 * the webhook and public API paths.
 */

const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);
const OPEN_PREFIXES = ["/api/webhooks/", "/api/platform/webhooks/", "/api/v1/"];

/** True when a state-changing /api request comes from a page on another host. */
export function crossSiteRefused(o: { method: string; path: string; origin: string | null; host: string | null }) {
  if (!o.path.startsWith("/api/") || SAFE_METHODS.has(o.method.toUpperCase())) return false;
  if (OPEN_PREFIXES.some((p) => o.path.startsWith(p))) return false;
  if (o.origin === null) return false;
  if (!o.host) return true;
  try {
    return new URL(o.origin).host.toLowerCase() !== o.host.toLowerCase();
  } catch {
    return true; // "null" (sandboxed frames, file://) or junk
  }
}

/** The fuller policy, report-only for now (security report 23 Nov, finding 8). */
export const REPORT_ONLY_CSP = [
  "default-src 'self'",
  // Next inlines its start-up scripts; no outside scripts.
  "script-src 'self' 'unsafe-inline'",
  "style-src 'self' 'unsafe-inline'",
  // Uploaded files may come from the storage host (signed links).
  "img-src 'self' data: blob: https:",
  "media-src 'self' blob: https:",
  "font-src 'self' data:",
  "connect-src 'self' https:",
  "worker-src 'self' blob:",
  "frame-src 'self'",
  "frame-ancestors 'none'",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
].join("; ");

/** Security headers for every response (see next.config.ts). */
export const SECURITY_HEADERS: { key: string; value: string }[] = [
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "X-Frame-Options", value: "DENY" },
  // Camera (photos, selfies), location (visits, deliveries) and the mic (spoken orders) on our own pages only.
  { key: "Permissions-Policy", value: "camera=(self), geolocation=(self), microphone=(self), payment=(self), usb=(), interest-cohort=()" },
  // No script rules (Next inlines its own); this only stops framing, plugins, <base> tricks and forms posting elsewhere.
  { key: "Content-Security-Policy", value: "frame-ancestors 'none'; object-src 'none'; base-uri 'self'; form-action 'self'" },
  { key: "Strict-Transport-Security", value: "max-age=31536000; includeSubDomains" },
  // Our files and pictures are only for our own pages (business addresses are subdomains: same site).
  { key: "Cross-Origin-Resource-Policy", value: "same-site" },
  // A page opened from ours can't reach back into it; popups we open (payments) still work.
  { key: "Cross-Origin-Opener-Policy", value: "same-origin-allow-popups" },
  // The full policy, watched before it is enforced: the browser reports what it would block
  // (console) and blocks nothing. Enforce it once a few weeks show no real page tripping it.
  { key: "Content-Security-Policy-Report-Only", value: REPORT_ONLY_CSP },
];

/** A session secret fit for production: set, at least 32 characters, not the development default. */
export function secretProblem(secret: string | undefined, name = "SESSION_SECRET"): string | null {
  if (!secret) return `${name} is not set`;
  if (secret === "setu-dev-secret-change-me" || secret === "setu-dev-platform-secret") return `${name} is still the development default`;
  if (secret.length < 32) return `${name} must be at least 32 characters`;
  return null;
}

/**
 * The console (and support links into a business) sign with their own secret,
 * so a leak of the businesses' SESSION_SECRET can't mint console or support access.
 */
export function platformSecretProblem(env: { SESSION_SECRET?: string; PLATFORM_SESSION_SECRET?: string }): string | null {
  const p = secretProblem(env.PLATFORM_SESSION_SECRET, "PLATFORM_SESSION_SECRET");
  if (p) return p;
  if (env.PLATFORM_SESSION_SECRET === env.SESSION_SECRET) return "PLATFORM_SESSION_SECRET must differ from SESSION_SECRET";
  return null;
}

/** Web push services browsers use; the server only ever POSTs to these (no requests into our own network). */
const PUSH_HOSTS = ["fcm.googleapis.com", "android.googleapis.com", "push.services.mozilla.com", "push.apple.com", "notify.windows.com"];

export function pushEndpointAllowed(endpoint: string) {
  try {
    const u = new URL(endpoint);
    if (u.protocol !== "https:" || u.port || u.username || u.password) return false;
    const h = u.hostname.toLowerCase();
    return PUSH_HOSTS.some((p) => h === p || h.endsWith(`.${p}`));
  } catch {
    return false;
  }
}
