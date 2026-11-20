import { NextResponse } from "next/server";
import { guard } from "@/lib/guard";
import { can } from "@/lib/permissions";
import { istDayStart } from "@/lib/gst";
import type { EInvoiceStatus, InvoiceType, Prisma } from "@/generated/prisma/client";

const TYPES: InvoiceType[] = ["TAX_INVOICE", "BILL_OF_SUPPLY", "CREDIT_NOTE", "DEBIT_NOTE"];
const EINV: EInvoiceStatus[] = ["NOT_REQUIRED", "PENDING", "GENERATED", "FAILED", "CANCELLED"];
const YMD = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Documents list. Staff with invoices.view: everything, filterable. A retailer:
 * only their own. Query: from, to (YYYY-MM-DD, IST), type, einv, q (number,
 * order number or shop name), retailerId, page (50 per page).
 */
export async function GET(req: Request) {
  const auth = await guard();
  if (!auth.ok) return auth.res;
  const { db, session } = auth;
  const sp = new URL(req.url).searchParams;
  const where: Prisma.InvoiceWhereInput = {};

  if (session.role === "RETAILER") {
    const me = await db.retailerProfile.findUnique({ where: { userId: session.userId }, select: { id: true } });
    if (!me) return NextResponse.json({ error: "Retailer profile not found" }, { status: 404 });
    where.retailerId = me.id;
  } else if (!can(session.role, "invoices.view")) {
    return NextResponse.json({ error: "You don't have access to this" }, { status: 403 });
  } else if (sp.get("retailerId")) {
    where.retailerId = sp.get("retailerId")!;
  }

  const from = sp.get("from");
  const to = sp.get("to");
  if ((from && !YMD.test(from)) || (to && !YMD.test(to))) return NextResponse.json({ error: "Dates must be YYYY-MM-DD" }, { status: 400 });
  if (from || to) {
    where.date = {};
    if (from) where.date.gte = istDayStart(from);
    if (to) where.date.lt = new Date(istDayStart(to).getTime() + 86_400_000);
  }
  const type = sp.get("type");
  if (type) {
    if (!TYPES.includes(type as InvoiceType)) return NextResponse.json({ error: "Unknown type" }, { status: 400 });
    where.type = type as InvoiceType;
  }
  const einv = sp.get("einv");
  if (einv) {
    if (!EINV.includes(einv as EInvoiceStatus)) return NextResponse.json({ error: "Unknown e-invoice status" }, { status: 400 });
    where.einvStatus = einv as EInvoiceStatus;
  }
  const q = sp.get("q")?.trim().slice(0, 60);
  if (q) {
    where.OR = [
      { number: { contains: q, mode: "insensitive" } },
      { retailer: { outletName: { contains: q, mode: "insensitive" } } },
      { order: { orderNumber: { contains: q, mode: "insensitive" } } },
    ];
  }
  const page = Math.max(1, Math.min(1000, Number(sp.get("page")) || 1));

  const [rows, count, sums] = await Promise.all([
    db.invoice.findMany({
      where,
      orderBy: [{ date: "desc" }, { number: "desc" }],
      skip: (page - 1) * 50,
      take: 50,
      select: {
        id: true,
        type: true,
        number: true,
        date: true,
        total: true,
        taxable: true,
        cgst: true,
        sgst: true,
        igst: true,
        b2b: true,
        einvStatus: true,
        einvError: true,
        ewbNo: true,
        noteKind: true,
        reason: true,
        retailer: { select: { id: true, outletName: true } },
        order: { select: { id: true, orderNumber: true } },
        original: { select: { id: true, number: true } },
      },
    }),
    db.invoice.count({ where }),
    db.invoice.groupBy({ by: ["type"], where, _sum: { taxable: true, cgst: true, sgst: true, igst: true, total: true }, _count: { _all: true } }),
  ]);
  const bills = await db.bill.findMany({ where: { number: { in: rows.map((r) => r.number) } }, select: { number: true, amount: true, paid: true } });
  const due = new Map(bills.map((b) => [b.number, b.amount - b.paid]));
  return NextResponse.json({
    invoices: rows.map((r) => ({ ...r, due: due.get(r.number) ?? null })),
    count,
    page,
    pages: Math.max(1, Math.ceil(count / 50)),
    totals: sums.map((s) => ({ type: s.type, count: s._count._all, ...s._sum })),
  });
}
