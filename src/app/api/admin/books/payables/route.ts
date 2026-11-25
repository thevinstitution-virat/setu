import { NextResponse } from "next/server";
import { guard } from "@/lib/guard";
import { audit, requestIp } from "@/lib/audit";
import { withMoney } from "@/lib/ledger";
import { isDay, readPeriod, todayIst } from "@/lib/books";
import { fileResponse } from "@/lib/books-export";
import { billsFallingDue, openBillsOn, payablesBySupplier, paymentsList } from "@/lib/supplier-payments";
import { billsCsv, billsSheet, bySupplierCsv, bySupplierSheet, dueCsv, dueSheet, paymentsCsv, paymentsSheet } from "@/lib/payables-export";

const REPORTS = ["suppliers", "bills", "due", "payments"] as const;
type Report = (typeof REPORTS)[number];

/**
 * GET ?report=suppliers|bills|due|payments &asOn= (or &from=&to= for payments)
 *     &supplier= &format=json|csv|pdf: what we owe suppliers, and what we paid.
 */
export async function GET(req: Request) {
  const auth = await guard("accounts.view");
  if (!auth.ok) return auth.res;
  const sp = new URL(req.url).searchParams;
  const report: Report = REPORTS.find((r) => r === sp.get("report")) ?? "suppliers";
  const asOn = sp.get("asOn") || todayIst();
  if (!isDay(asOn)) return NextResponse.json({ error: "Dates must be YYYY-MM-DD" }, { status: 400 });
  const supplierId = sp.get("supplier") || null;
  const format = sp.get("format");
  const out = await withMoney(auth.tenant.id, auth.session.userId, async (ctx) => {
    const who = supplierId
      ? ((
          await ctx.tx.supplier.findUnique({
            where: { id: supplierId },
            select: { name: true },
          })
        )?.name ?? "")
      : "";
    switch (report) {
      case "bills": {
        const bills = await openBillsOn(ctx, asOn, { supplierId });
        return {
          json: { bills, asOn },
          file: `payables-bills-${asOn}`,
          csv: billsCsv(bills),
          sheet: billsSheet(bills, asOn, who),
        };
      }
      case "due": {
        const due = await billsFallingDue(ctx, asOn, 7, { supplierId });
        return {
          json: { due },
          file: `payables-due-${asOn}`,
          csv: dueCsv(due),
          sheet: dueSheet(due, who),
        };
      }
      case "payments": {
        const p = readPeriod(sp);
        if ("error" in p) return { error: p.error };
        const payments = await paymentsList(ctx, p.from, p.to, {
          supplierId,
        });
        return {
          json: { payments },
          file: `supplier-payments-${p.from}-to-${p.to}`,
          csv: paymentsCsv(payments),
          sheet: paymentsSheet(payments, who),
        };
      }
      default: {
        const bySupplier = await payablesBySupplier(ctx, asOn, {
          supplierId,
        });
        return {
          json: { bySupplier },
          file: `payables-${asOn}`,
          csv: bySupplierCsv(bySupplier),
          sheet: bySupplierSheet(bySupplier, who),
        };
      }
    }
  });
  if ("error" in out) return NextResponse.json({ error: out.error }, { status: 400 });
  if (format === "csv" || format === "pdf") {
    await audit(auth.db, {
      actorId: auth.session.userId,
      action: "report.export",
      entity: "Report",
      entityId: `books:payables:${report}`,
      after: { format, asOn, supplierId },
      ip: requestIp(req),
    });
    return fileResponse(auth.db, auth.tenant.id, format, out.file, out.csv, out.sheet);
  }
  return NextResponse.json(out.json, {
    headers: { "cache-control": "no-store" },
  });
}
