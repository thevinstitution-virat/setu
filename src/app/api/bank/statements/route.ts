import { NextResponse } from "next/server";
import { guard } from "@/lib/guard";
import { audit, requestIp } from "@/lib/audit";
import { moneyFail } from "@/lib/money-api";
import { importStatement, MAX_BYTES } from "@/lib/bank";

/** Uploaded statements, newest first, with how many lines still need a look. */
export async function GET() {
  const auth = await guard("bank.reconcile");
  if (!auth.ok) return auth.res;
  const { db } = auth;
  const statements = await db.bankStatement.findMany({
    orderBy: { createdAt: "desc" },
    take: 50,
    include: { uploadedBy: { select: { name: true } } },
  });
  const open = await db.bankLine.groupBy({ by: ["statementId", "status"], where: { statementId: { in: statements.map((s) => s.id) } }, _count: { _all: true } });
  const counts = new Map<string, Record<string, number>>();
  for (const o of open) counts.set(o.statementId, { ...(counts.get(o.statementId) ?? {}), [o.status]: o._count._all });
  const [banks, suppliers] = await Promise.all([
    db.bankAccount.findMany({ where: { active: true }, orderBy: [{ isDefault: "desc" }, { name: "asc" }], select: { id: true, name: true, isDefault: true } }),
    db.supplier.findMany({ where: { active: true }, orderBy: { name: "asc" }, select: { id: true, name: true } }),
  ]);
  return NextResponse.json({
    statements: statements.map((s) => ({ ...s, uploadedBy: s.uploadedBy.name, counts: counts.get(s.id) ?? {} })),
    banks,
    suppliers,
  });
}

/** Multipart: file (CSV / XLSX), bankAccountId (blank = the default bank); account (a label) only before any bank account is set up. */
export async function POST(req: Request) {
  const auth = await guard("bank.reconcile");
  if (!auth.ok) return auth.res;
  const { session, db, tenant } = auth;
  const form = await req.formData().catch(() => null);
  const file = form?.get("file");
  if (!(file instanceof File)) return NextResponse.json({ error: "Choose the statement file" }, { status: 400 });
  if (file.size > MAX_BYTES) return NextResponse.json({ error: "The file is larger than 5 MB" }, { status: 400 });
  try {
    const r = await importStatement(tenant.id, session.userId, {
      fileName: file.name || "statement.csv",
      bankAccountId: String(form?.get("bankAccountId") ?? "") || null,
      account: String(form?.get("account") ?? ""),
      bytes: Buffer.from(await file.arrayBuffer()),
    });
    await audit(db, {
      actorId: session.userId,
      action: "bank.import",
      entity: "BankStatement",
      entityId: r.statement.id,
      after: { file: r.statement.fileName, lines: r.statement.lineCount, duplicates: r.duplicates, matched: r.matched },
      ip: requestIp(req),
    });
    return NextResponse.json(r, { status: 201 });
  } catch (e) {
    return moneyFail(e);
  }
}
