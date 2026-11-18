import { NextResponse } from "next/server";
import { guard } from "@/lib/guard";
import type { ChequeStatus } from "@/generated/prisma/client";

/** Cheques by status (default: not yet cleared or bounced). */
export async function GET(req: Request) {
  const auth = await guard("cheques.manage");
  if (!auth.ok) return auth.res;
  const status = new URL(req.url).searchParams.get("status") as ChequeStatus | null;
  const cheques = await auth.db.cheque.findMany({
    where:
      status && ["RECEIVED", "DEPOSITED", "CLEARED", "BOUNCED"].includes(status)
        ? { status }
        : // Cheques still to act on; one whose payment was reversed (entered by mistake) is closed.
          { status: { in: ["RECEIVED", "DEPOSITED"] }, payment: { state: "CONFIRMED" } },
    orderBy: { chequeDate: "asc" },
    take: 300,
    include: {
      payment: {
        select: {
          id: true,
          number: true,
          amount: true,
          state: true,
          collectedAt: true,
          retailer: { select: { id: true, outletName: true } },
          collectedBy: { select: { name: true } },
        },
      },
    },
  });
  return NextResponse.json({ cheques });
}
