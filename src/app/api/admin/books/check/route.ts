import { NextResponse } from "next/server";
import { guard } from "@/lib/guard";
import { withMoney } from "@/lib/ledger";
import { checkBooks } from "@/lib/books";

/** GET: run the books check (read-only). */
export async function GET() {
  const auth = await guard("accounts.view");
  if (!auth.ok) return auth.res;
  const check = await withMoney(auth.tenant.id, auth.session.userId, (ctx) => checkBooks(ctx));
  return NextResponse.json({ check }, { headers: { "cache-control": "no-store" } });
}
