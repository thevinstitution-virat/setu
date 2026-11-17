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

export async function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;

  const matchedPrefix = Object.keys(protectedPrefixes).find((p) =>
    pathname.startsWith(p)
  );
  if (!matchedPrefix) return NextResponse.next();

  const token = request.cookies.get(SESSION_COOKIE)?.value;
  if (!token) {
    return NextResponse.redirect(new URL("/login", request.url));
  }

  try {
    const { payload } = await jwtVerify(token, secret);
    const role = payload.role as string;
    if (role !== protectedPrefixes[matchedPrefix]) {
      return NextResponse.redirect(new URL(roleHomes[role] ?? "/login", request.url));
    }
    return NextResponse.next();
  } catch {
    return NextResponse.redirect(new URL("/login", request.url));
  }
}

export const config = {
  matcher: ["/admin/:path*", "/retailer/:path*", "/sales/:path*", "/delivery/:path*"],
};
