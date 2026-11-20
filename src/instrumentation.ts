import type { Instrumentation } from "next";

/**
 * Refuse to start in production with a missing, short or development session
 * secret: several places (the proxy, OTP and invoice links) would otherwise
 * fall back to the development value and sign cookies anyone could forge.
 */
export async function register() {
  if (process.env.NODE_ENV !== "production" || process.env.NEXT_PHASE === "phase-production-build") return;
  const { platformSecretProblem, secretProblem } = await import("@/lib/security");
  const problem = secretProblem(process.env.SESSION_SECRET) ?? platformSecretProblem({ SESSION_SECRET: process.env.SESSION_SECRET, PLATFORM_SESSION_SECRET: process.env.PLATFORM_SESSION_SECRET });
  if (problem) throw new Error(`${problem}. Set it in the server's environment (any random string of 32+ characters) and start again.`);
}

/**
 * Server errors → alert (Telegram when configured). Only the path, method and
 * host are sent — never headers, cookies or bodies, which may hold personal
 * data or session tokens.
 */
export const onRequestError: Instrumentation.onRequestError = async (err, request, context) => {
  const { sendAlert } = await import("@/lib/alerts");
  const message = err instanceof Error ? err.message : String(err);
  const digest = typeof err === "object" && err !== null && "digest" in err ? String(err.digest) : "";
  const host = request.headers["x-forwarded-host"] ?? request.headers["host"] ?? "";
  await sendAlert(
    `Server error: ${message.slice(0, 160)}`,
    [
      `${request.method} ${String(host)}${request.path}`,
      `${context.routerKind} ${context.routeType} ${context.routePath}`,
      digest && `digest ${digest}`,
    ]
      .filter(Boolean)
      .join("\n")
  );
};
