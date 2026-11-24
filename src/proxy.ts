import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { jwtVerify } from "jose";
import { crossSiteRefused } from "@/lib/security";
import { appSecret } from "@/lib/app-secret";
import { officeAllows } from "@/lib/permissions";

const SESSION_COOKIE = "setu_session";

const roleHomes: Record<string, string> = {
  ADMIN: "/admin",
  ACCOUNTANT: "/admin/books",
  RETAILER: "/retailer",
  SALES_AGENT: "/sales",
  DELIVERY_AGENT: "/delivery",
};

const protectedPrefixes: Record<string, string> = {
  "/admin": "ADMIN",
  "/retailer": "RETAILER",
  "/sales": "SALES_AGENT",
  "/delivery": "DELIVERY_AGENT",
};

/**
 * 1. Passes the path and method on to the app (x-setu-path / x-setu-method),
 *    so guard() and layouts can check the plan's modules and read-only
 *    support sessions in one place. Any such header sent by a client is
 *    overwritten here.
 * 2. Refuses writes to /api from pages on another host (lib/security.ts).
 * 3. Sends signed-out visitors of the role areas to /login.
 */
export async function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;
  const headers = new Headers(request.headers);
  headers.set("x-setu-path", pathname);
  headers.set("x-setu-method", request.method);
  const next = () => NextResponse.next({ request: { headers } });
  // Stay on the visitor's own address: build it from the Host header (request.url can carry the
  // server's own host under `next start` / a proxy). The proxy layer refuses a relative Location
  // ("Invalid URL"), so this must be absolute.
  // The Host header only: X-Forwarded-Host is whatever the client sent unless a proxy rewrote it (lib/tenant.ts).
  const host = request.headers.get("host");
  const proto = (request.headers.get("x-forwarded-proto") ?? request.nextUrl.protocol.replace(":", "")).split(",")[0].trim();
  const to = (path: string) => NextResponse.redirect(new URL(path, host ? `${proto}://${host}` : request.url), 307);

  if (crossSiteRefused({ method: request.method, path: pathname, origin: request.headers.get("origin"), host })) {
    return NextResponse.json({ error: "This request came from another site and was refused" }, { status: 403 });
  }

  const matchedPrefix = Object.keys(protectedPrefixes).find((p) => pathname === p || pathname.startsWith(`${p}/`));
  if (!matchedPrefix) return next();

  const token = request.cookies.get(SESSION_COOKIE)?.value;
  if (!token) {
    return to("/login");
  }

  try {
    const { payload } = await jwtVerify(token, new TextEncoder().encode(appSecret("SESSION_SECRET")), { algorithms: ["HS256"] });
    const role = payload.role as string;
    // The accountant shares the office, but only its books and money pages.
    if (matchedPrefix === "/admin" && role === "ACCOUNTANT") {
      return officeAllows(role, pathname) ? next() : to(roleHomes.ACCOUNTANT);
    }
    if (role !== protectedPrefixes[matchedPrefix]) {
      return to(roleHomes[role] ?? "/login");
    }
    return next();
  } catch {
    return to("/login");
  }
}

export const config = {
  // Everything except Next's own files and static assets.
  matcher: ["/((?!_next/static|_next/image|favicon.ico|icon-192.png|icon-512.png|sw.js).*)"],
};
