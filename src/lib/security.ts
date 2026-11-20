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
];

/** A session secret fit for production: set, at least 32 characters, not the development default. */
export function secretProblem(secret: string | undefined): string | null {
  if (!secret) return "SESSION_SECRET is not set";
  if (secret === "setu-dev-secret-change-me") return "SESSION_SECRET is still the development default";
  if (secret.length < 32) return "SESSION_SECRET must be at least 32 characters";
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
