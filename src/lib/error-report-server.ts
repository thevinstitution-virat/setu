/**
 * Server and worker errors → GlitchTip project vbiz-backend (SENTRY_DSN).
 * Without SENTRY_DSN this only logs. See error-report.ts for what is sent.
 */
import { buildEvent, makeDeduper, parseDsn, sendEvent, tenantOfHost, type ReportInput } from "./error-report";

const fresh = makeDeduper(60_000);

export type ServerErrorContext = {
  source: "request" | "worker" | "script";
  method?: string;
  host?: string;
  path?: string;
  route?: string;
  routeType?: string;
  job?: string;
};

export async function reportServerError(error: unknown, ctx: ServerErrorContext): Promise<void> {
  const dsn = parseDsn(process.env.SENTRY_DSN);
  if (!dsn) return;
  const message = error instanceof Error ? error.message : String(error);
  if (!fresh(`${ctx.source}|${ctx.route ?? ctx.job ?? ""}|${message.slice(0, 200)}`)) return;
  const input: ReportInput = {
    error,
    platform: "node",
    environment: process.env.APP_ENV || process.env.NODE_ENV,
    release: process.env.SOURCE_COMMIT || process.env.APP_RELEASE,
    url: ctx.host && ctx.path ? `https://${ctx.host}${ctx.path}` : ctx.path,
    method: ctx.method,
    tags: {
      source: ctx.source,
      business: tenantOfHost(ctx.host, process.env.PLATFORM_DOMAIN),
      route: ctx.route,
      route_type: ctx.routeType,
      job: ctx.job,
    },
  };
  await sendEvent(dsn, buildEvent(input));
}
