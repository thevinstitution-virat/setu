import { NextResponse } from "next/server";
import { guard } from "@/lib/guard";
import { withMoney } from "@/lib/ledger";
import { CHEQUE_STATUS_LABEL, issuedCheques } from "@/lib/supplier-payments";
import type { IssuedChequeStatus } from "@/generated/prisma/client";

/** GET ?status=ISSUED|CLEARED|BOUNCED|CANCELLED: the cheques we wrote. */
export async function GET(req: Request) {
  const auth = await guard("accounts.view");
  if (!auth.ok) return auth.res;
  const s = new URL(req.url).searchParams.get("status");
  const status = s && s in CHEQUE_STATUS_LABEL ? (s as IssuedChequeStatus) : null;
  const cheques = await withMoney(auth.tenant.id, auth.session.userId, (ctx) => issuedCheques(ctx, status));
  return NextResponse.json({ cheques }, { headers: { "cache-control": "no-store" } });
}
