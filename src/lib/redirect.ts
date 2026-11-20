import { NextResponse } from "next/server";

/**
 * Redirect to a path on the address the visitor is on. A relative Location
 * (RFC 9110) keeps the browser on its own host: in `next start` and behind
 * the proxy req.url carries the server's own host and port, so
 * `new URL(path, req.url)` sent people to the wrong address (and away from
 * the cookie just set).
 */
export function localRedirect(path: string, status: 303 | 307 = 307) {
  if (!path.startsWith("/") || path.startsWith("//")) throw new Error("localRedirect takes a path");
  return new NextResponse(null, { status, headers: { Location: path } });
}

/** <scheme>://<slug>.<domain>[:port]<path> from PUBLIC_SCHEME / PUBLIC_PORT (not the request). */
export function publicTenantUrl(slug: string, domain: string, path: string) {
  const scheme = process.env.PUBLIC_SCHEME || (domain === "localhost" ? "http" : "https");
  const port = process.env.PUBLIC_PORT ? `:${process.env.PUBLIC_PORT}` : "";
  return `${scheme}://${slug}.${domain}${port}${path}`;
}
