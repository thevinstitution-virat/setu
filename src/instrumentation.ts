import type { Instrumentation } from "next";

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
