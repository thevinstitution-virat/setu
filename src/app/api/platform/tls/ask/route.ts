import { NextResponse } from "next/server";
import { tlsAllowed } from "@/lib/domains";

/**
 * Caddy on-demand TLS "ask" endpoint: ?domain=<host> → 200 when we serve that
 * host (a verified custom domain or one of our tenant addresses), else 404.
 * No sign-in (Caddy calls it); it reveals only yes / no.
 */
export async function GET(req: Request) {
  const domain = new URL(req.url).searchParams.get("domain") ?? "";
  return (await tlsAllowed(domain)) ? new NextResponse("ok") : new NextResponse("no", { status: 404 });
}
