import { NextResponse } from "next/server";
import { guard } from "@/lib/guard";
import type { ChequeStatus } from "@/generated/prisma/client";
import { bankTodayWhere } from "@/lib/cheques-due";

/** Cheques by status (default: not yet cleared or bounced; "due": in hand and can be banked today). Always with the bank-today count. */
export async function GET(req: Request) {
  const auth = await guard("cheques.manage");
  if (!auth.ok) return auth.res;
  const status = new URL(req.url).searchParams.get("status") as ChequeStatus | "due" | null;
  const cheques = await auth.db.cheque.findMany({
    where:
      status === "due"
        ? bankTodayWhere()
        : status && ["RECEIVED", "DEPOSITED", "CLEARED", "BOUNCED"].includes(status)
        ? { status: status as ChequeStatus }
        : // Cheques still to act on; one whose payment was reversed (entered by mistake) is closed.
          // (a post-dated cheque is held, with its payment waiting, until it is banked).
          { status: { in: ["RECEIVED", "DEPOSITED"] }, payment: { state: { in: ["CONFIRMED", "POST_DATED"] } } },
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
  const due = await auth.db.cheque.findMany({ where: bankTodayWhere(), select: { payment: { select: { amount: true } } } });
  return NextResponse.json({ cheques, bankToday: { count: due.length, amount: due.reduce((t, r) => t + r.payment.amount, 0) } });
}
