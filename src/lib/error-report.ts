/**
 * Error reports to GlitchTip (Sentry-compatible), without the Sentry SDK: a
 * small envelope sender that works in the browser and on the server. Used by
 * error-report-server.ts and error-report-client.ts; nothing here touches
 * Node or the DOM directly.
 *
 * Privacy: only the error (type, message, stack), the page path with the
 * query string removed and token-like or long-number path parts masked, the
 * business (subdomain) and a few tags are sent. Never cookies, headers,
 * request bodies or user details. GlitchTip also drops IP addresses
 * (scrub_ip_addresses on both projects).
 */

export type Dsn = { key: string; origin: string; projectId: string };

/** https://<key>@errors.example.com/<projectId> → parts, or null if unusable. */
export function parseDsn(dsn: string | undefined | null): Dsn | null {
  if (!dsn) return null;
  try {
    const u = new URL(dsn);
    const projectId = u.pathname.replace(/^\/+|\/+$/g, "");
    if (!u.username || !/^\d+$/.test(projectId) || !/^https?:$/.test(u.protocol)) return null;
    return { key: u.username, origin: `${u.protocol}//${u.host}`, projectId };
  } catch {
    return null;
  }
}

/** Drop query and hash; mask path parts that may be secrets or personal data. */
export function scrubUrl(raw: string): string {
  try {
    const u = new URL(raw, "http://x.invalid");
    const path = u.pathname
      .split("/")
      .map((seg) => {
        if (/^\+?\d{10,}$/.test(seg)) return ":num"; // phone numbers
        if (seg.length >= 20 && /^[A-Za-z0-9_.~-]+$/.test(seg) && /\d/.test(seg)) return ":token"; // share links, ids
        return seg;
      })
      .join("/");
    return u.host === "x.invalid" ? path : `${u.protocol}//${u.host}${path}`;
  } catch {
    return "";
  }
}

export type Frame = { function?: string; filename?: string; lineno?: number; colno?: number; in_app?: boolean };

/** V8 ("at fn (file:1:2)") and Firefox/Safari ("fn@file:1:2") stacks → Sentry frames, oldest first. */
export function parseStack(stack: string | undefined): Frame[] {
  if (!stack) return [];
  const frames: Frame[] = [];
  for (const line of stack.split("\n").slice(0, 50)) {
    const v8 = line.match(/^\s*at (?:(.+?) \()?(.+?):(\d+):(\d+)\)?\s*$/);
    const ff = !v8 && line.match(/^\s*(.*?)@(.+?):(\d+):(\d+)\s*$/);
    const m = v8 || ff;
    if (!m) continue;
    const filename = scrubUrl(m[2]) || m[2];
    frames.push({
      function: m[1] || "<anonymous>",
      filename,
      lineno: Number(m[3]),
      colno: Number(m[4]),
      in_app: !/node_modules|\/_next\/static\/chunks\/(framework|main|webpack|turbopack)/.test(filename),
    });
  }
  return frames.reverse();
}

export type ReportInput = {
  error: unknown;
  platform: "javascript" | "node";
  environment?: string;
  release?: string;
  url?: string;
  method?: string;
  tags?: Record<string, string | undefined>;
  extra?: Record<string, unknown>;
  level?: "error" | "warning" | "fatal";
};

function randomHex32(): string {
  const c = (globalThis as { crypto?: Crypto }).crypto;
  if (c?.randomUUID) return c.randomUUID().replace(/-/g, "");
  let s = "";
  for (let i = 0; i < 32; i++) s += Math.floor(Math.random() * 16).toString(16);
  return s;
}

/** The error's type and message, whatever was thrown. */
export function describe(error: unknown): { type: string; value: string; stack?: string } {
  if (error instanceof Error) return { type: error.name || "Error", value: (error.message || "").slice(0, 1000), stack: error.stack };
  if (typeof error === "string") return { type: "Error", value: error.slice(0, 1000) };
  try {
    return { type: "NonError", value: JSON.stringify(error).slice(0, 1000) };
  } catch {
    return { type: "NonError", value: String(error).slice(0, 1000) };
  }
}

export function buildEvent(input: ReportInput) {
  const d = describe(input.error);
  const tags: Record<string, string> = {};
  for (const [k, v] of Object.entries(input.tags ?? {})) if (v) tags[k] = String(v).slice(0, 200);
  const digest = typeof input.error === "object" && input.error && "digest" in input.error ? String((input.error as { digest: unknown }).digest) : undefined;
  if (digest) tags.digest = digest.slice(0, 64);
  const url = input.url ? scrubUrl(input.url) : undefined;
  return {
    event_id: randomHex32(),
    timestamp: new Date().toISOString(),
    platform: input.platform,
    level: input.level ?? "error",
    environment: input.environment,
    release: input.release || undefined,
    tags,
    exception: { values: [{ type: d.type, value: d.value, stacktrace: { frames: parseStack(d.stack) } }] },
    request: url ? { url, method: input.method } : undefined,
    extra: input.extra,
  };
}

/** Sentry envelope: header, item header, event. */
export function toEnvelope(event: ReturnType<typeof buildEvent>): string {
  return `${JSON.stringify({ event_id: event.event_id, sent_at: new Date().toISOString() })}\n${JSON.stringify({ type: "event" })}\n${JSON.stringify(event)}`;
}

/**
 * Send one event. Never throws. text/plain keeps the browser request "simple"
 * (no CORS preflight), as the Sentry browser SDK does.
 */
export async function sendEvent(dsn: Dsn, event: ReturnType<typeof buildEvent>, opts: { keepalive?: boolean; timeoutMs?: number } = {}): Promise<boolean> {
  try {
    const res = await fetch(`${dsn.origin}/api/${dsn.projectId}/envelope/?sentry_key=${encodeURIComponent(dsn.key)}&sentry_version=7`, {
      method: "POST",
      headers: { "Content-Type": "text/plain;charset=UTF-8" },
      body: toEnvelope(event),
      keepalive: opts.keepalive,
      signal: AbortSignal.timeout(opts.timeoutMs ?? 5_000),
    });
    return res.ok;
  } catch {
    return false;
  }
}

/** Same error reported again within `windowMs` → skipped (an outage must not flood). */
export function makeDeduper(windowMs: number, max = 500) {
  const seen = new Map<string, number>();
  return (key: string, now = Date.now()) => {
    const last = seen.get(key);
    if (last !== undefined && now - last < windowMs) return false;
    if (seen.size >= max) seen.clear();
    seen.set(key, now);
    return true;
  };
}

/** The business slug from a host like sharma.ss.vpd.ceo, given the platform domain. */
export function tenantOfHost(host: string | undefined, platformDomain: string | undefined): string | undefined {
  if (!host) return undefined;
  const h = host.toLowerCase().split(":")[0];
  if (!platformDomain) return h;
  const d = platformDomain.toLowerCase();
  if (h === d) return "(platform)";
  return h.endsWith(`.${d}`) ? h.slice(0, -(d.length + 1)) : h;
}
