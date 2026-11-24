import { NextResponse } from "next/server";
import { guard } from "@/lib/guard";
import { audit, requestIp } from "@/lib/audit";
import { moneyFail } from "@/lib/money-api";
import { withMoney } from "@/lib/ledger";
import { MAX_ROWS, parseSheet } from "@/lib/importers";
import { applyOldTb, checkOldTb, OLD_TB_TEMPLATE, PARALLEL_TEMPLATE, parallelRun, readOldTb } from "@/lib/switch-over";

const MAX_BYTES = 5 * 1024 * 1024;
const cell = (v: string) => (/[",\r\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);

/** GET ?template=tb|parallel: the sheet to fill in (CSV). */
export async function GET(req: Request) {
  const auth = await guard("accounts.view");
  if (!auth.ok) return auth.res;
  const which = new URL(req.url).searchParams.get("template");
  const t = which === "parallel" ? PARALLEL_TEMPLATE : OLD_TB_TEMPLATE;
  const csv = [t.columns, ...t.example].map((r) => r.map(cell).join(",")).join("\r\n") + "\r\n";
  return new NextResponse("﻿" + csv, {
    headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="${which === "parallel" ? "parallel-run" : "old-trial-balance"}-template.csv"` },
  });
}

/**
 * multipart: file + what:
 *  - what=tb, mode=check: the old trial balance matched and checked;
 *  - what=tb, mode=apply, startOn: use it as the opening balances;
 *  - what=parallel, day: our figures against the old software's on that day.
 */
export async function POST(req: Request) {
  const form = await req.formData().catch(() => null);
  const what = String(form?.get("what") ?? "tb");
  const mode = String(form?.get("mode") ?? "check");
  const auth = await guard(what === "tb" && mode === "apply" ? "accounts.setup" : "accounts.view");
  if (!auth.ok) return auth.res;
  const file = form?.get("file");
  if (!(file instanceof File)) return NextResponse.json({ error: "Attach a CSV or Excel file" }, { status: 400 });
  if (!/\.(csv|xlsx)$/i.test(file.name)) return NextResponse.json({ error: "Use a .csv or .xlsx file (old .xls: save as .xlsx first)" }, { status: 415 });
  if (file.size > MAX_BYTES) return NextResponse.json({ error: "File is larger than 5 MB" }, { status: 413 });
  let rows;
  try {
    rows = await parseSheet(Buffer.from(await file.arrayBuffer()), file.name);
  } catch {
    return NextResponse.json({ error: "Could not read this file" }, { status: 400 });
  }
  if (!rows.length) return NextResponse.json({ error: "The file has no data rows" }, { status: 400 });
  if (rows.length > MAX_ROWS) return NextResponse.json({ error: `At most ${MAX_ROWS} rows per file` }, { status: 400 });
  const run = <T>(fn: Parameters<typeof withMoney<T>>[2]) => withMoney(auth.tenant.id, auth.session.userId, fn);
  try {
    if (what === "parallel") return NextResponse.json(await run((ctx) => parallelRun(ctx, String(form?.get("day") ?? ""), rows)));
    if (mode === "apply") {
      const startOn = String(form?.get("startOn") ?? "");
      const r = await run(async (ctx) => {
        const read = await readOldTb(ctx, rows);
        if (read.errors.length) return { errors: read.errors, opening: null };
        return { errors: [], opening: await applyOldTb(ctx, read.rows, startOn) };
      });
      if (r.opening) await audit(auth.db, { actorId: auth.session.userId, action: "books.opening.sheet", entity: "Tenant", entityId: auth.tenant.id, after: { startOn, file: file.name, rows: rows.length, difference: r.opening.difference }, ip: requestIp(req) });
      return NextResponse.json(r, { status: r.opening ? 200 : 400 });
    }
    return NextResponse.json(
      await run(async (ctx) => {
        const read = await readOldTb(ctx, rows);
        return { ...checkOldTb(read.rows, read.opening), errors: read.errors, startOn: read.opening.startOn };
      }),
    );
  } catch (e) {
    return moneyFail(e);
  }
}
