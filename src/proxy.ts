import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { jwtVerify } from "jose";

const SESSION_COOKIE = "setu_session";
const secret = new TextEncoder().encode(
  process.env.SESSION_SECRET ?? "setu-dev-secret-change-me"
);

const roleHomes: Record<string, string> = {
  ADMIN: "/admin",
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
 * 2. Sends signed-out visitors of the role areas to /login.
 */
export async function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;
  const headers = new Headers(request.headers);
  headers.set("x-setu-path", pathname);
  headers.set("x-setu-method", request.method);
  const next = () => NextResponse.next({ request: { headers } });
  // Relative Location: stay on the visitor's own address (request.url can carry the server's host).
  const to = (path: string) => new NextResponse(null, { status: 307, headers: { Location: path } });

  const matchedPrefix = Object.keys(protectedPrefixes).find((p) => pathname === p || pathname.startsWith(`${p}/`));
  if (!matchedPrefix) return next();

  const token = request.cookies.get(SESSION_COOKIE)?.value;
  if (!token) {
    return to("/login");
  }

  try {
    const { payload } = await jwtVerify(token, secret);
    const role = payload.role as string;
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
