/**
 * Browser errors → GlitchTip project vbiz-frontend (NEXT_PUBLIC_SENTRY_DSN,
 * inlined at build time). Without it this does nothing. See error-report.ts
 * for what is sent.
 */
import { buildEvent, makeDeduper, parseDsn, sendEvent, tenantOfHost } from "./error-report";

const dsn = parseDsn(process.env.NEXT_PUBLIC_SENTRY_DSN);
const fresh = makeDeduper(5 * 60_000);
const MAX_PER_PAGE = 10;
let sent = 0;

/** Noise that says nothing about our code. */
const IGNORE = [
  /ResizeObserver loop/i,
  /^Script error\.?$/i, // cross-origin script without details
  /extension:\/\//i, // browser extensions
  /Non-Error promise rejection captured/i,
  /AbortError|The operation was aborted|signal is aborted/i, // we abort fetches on purpose
];

export function reportClientError(error: unknown, extra?: { kind?: string; digest?: string }): void {
  if (!dsn || typeof window === "undefined") return;
  if (sent >= MAX_PER_PAGE) return;
  const message = error instanceof Error ? `${error.name}: ${error.message}` : String(error);
  const stack = error instanceof Error ? error.stack ?? "" : "";
  if (IGNORE.some((r) => r.test(message) || r.test(stack))) return;
  if (!fresh(`${location.pathname}|${message.slice(0, 200)}`)) return;
  sent++;
  const event = buildEvent({
    error,
    platform: "javascript",
    environment: process.env.NODE_ENV === "production" ? "prod" : "dev",
    url: location.href,
    tags: {
      source: extra?.kind ?? "browser",
      business: tenantOfHost(location.hostname, undefined),
      lang: document.documentElement.lang || undefined,
      online: navigator.onLine ? "yes" : "no",
      standalone: matchMedia("(display-mode: standalone)").matches ? "yes" : "no",
      digest: extra?.digest,
    },
    extra: { userAgent: navigator.userAgent.slice(0, 300), viewport: `${innerWidth}x${innerHeight}` },
  });
  void sendEvent(dsn, event, { keepalive: true });
}
