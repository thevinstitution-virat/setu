import { NextResponse } from "next/server";
import { guard } from "@/lib/guard";
import { audit, requestIp } from "@/lib/audit";
import { asPlatform } from "@/lib/db";
import { istDayStart } from "@/lib/gst";
import { invoiceSettings } from "@/lib/invoice-settings";
import { gstr1Workbook, salesRegisterWorkbook, tallyXml, type ExportDoc, type ExportReceipt } from "@/lib/gst-exports";
import type { Party } from "@/lib/invoice";

const YMD = /^\d{4}-\d{2}-\d{2}$/;
const XLSX = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

/**
 * Accountant downloads for a date range (IST, inclusive):
 *   ?kind=gstr1|register|tally&from=YYYY-MM-DD&to=YYYY-MM-DD[&masters=0]
 * GSTR-1 should be run for one calendar month.
 */
export async function GET(req: Request) {
  const auth = await guard("invoices.view");
  if (!auth.ok) return auth.res;
  const { db, session, tenant } = auth;
  const sp = new URL(req.url).searchParams;
  const kind = sp.get("kind");
  const from = sp.get("from") ?? "";
  const to = sp.get("to") ?? "";
  if (kind !== "gstr1" && kind !== "register" && kind !== "tally") return NextResponse.json({ error: "kind must be gstr1, register or tally" }, { status: 400 });
  if (!YMD.test(from) || !YMD.test(to) || from > to) return NextResponse.json({ error: "Give from and to dates (YYYY-MM-DD)" }, { status: 400 });
  const start = istDayStart(from);
  const end = new Date(istDayStart(to).getTime() + 86_400_000);
  if (end.getTime() - start.getTime() > 400 * 86_400_000) return NextResponse.json({ error: "Export at most about a year at a time" }, { status: 400 });

  const docs = (await db.invoice.findMany({
    where: { date: { gte: start, lt: end } },
    orderBy: [{ date: "asc" }, { number: "asc" }],
    include: {
      lines: { orderBy: { sl: "asc" } },
      original: { select: { id: true, number: true, date: true, b2b: true, interState: true, total: true } },
      order: { select: { orderNumber: true } },
    },
  })) as ExportDoc[];

  const t = await asPlatform((tx) => tx.tenant.findUniqueOrThrow({ where: { id: tenant.id }, select: { name: true, legalName: true, settings: true } }));
  const settings = invoiceSettings(t.settings);
  const stamp = `${from}_to_${to}`;
  let body: Buffer | string;
  let type: string;
  let file: string;

  if (kind === "gstr1") {
    body = await gstr1Workbook(docs);
    type = XLSX;
    file = `GSTR1_${stamp}.xlsx`;
  } else if (kind === "register") {
    body = await salesRegisterWorkbook(docs);
    type = XLSX;
    file = `Sales_register_${stamp}.xlsx`;
  } else {
    const payments = await db.payment.findMany({
      where: { state: "CONFIRMED", method: { in: ["CASH", "UPI", "BANK", "CHEQUE"] }, collectedAt: { gte: start, lt: end } },
      orderBy: { collectedAt: "asc" },
      include: {
        allocations: { include: { bill: { select: { number: true } } } },
        retailer: { include: { user: { select: { phone: true } }, area: { select: { name: true } } } },
      },
    });
    const receipts: ExportReceipt[] = payments.map((p) => ({
      number: p.number,
      date: p.collectedAt,
      amount: p.amount,
      method: p.method,
      reference: p.reference,
      retailerId: p.retailerId,
      allocations: p.allocations.map((a) => ({ billNumber: a.bill.number, amount: a.amount })),
      buyer: {
        legalName: p.retailer.legalName || p.retailer.outletName,
        tradeName: p.retailer.outletName,
        gstin: p.retailer.gstin,
        stateCode: p.retailer.stateCode || (p.retailer.gstin ? p.retailer.gstin.slice(0, 2) : "") || "",
        address: [p.retailer.shopNumber, p.retailer.complexName, p.retailer.area.name].filter(Boolean).join(", "),
        city: p.retailer.area.name,
        pinCode: p.retailer.pinCode,
        phone: p.retailer.user.phone ?? null,
      } satisfies Party,
    }));
    body = tallyXml(docs, receipts, settings.tally, { company: t.legalName || t.name, masters: sp.get("masters") !== "0" });
    type = "application/xml; charset=utf-8";
    file = `Tally_${stamp}.xml`;
  }

  await audit(db, { actorId: session.userId, action: `export.${kind}`, entity: "Invoice", after: { from, to, documents: docs.length }, ip: requestIp(req) });
  return new Response(typeof body === "string" ? body : new Uint8Array(body), {
    headers: { "Content-Type": type, "Content-Disposition": `attachment; filename="${file}"`, "Cache-Control": "private, no-store" },
  });
}
