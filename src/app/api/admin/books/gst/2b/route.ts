import { NextResponse } from "next/server";
import { guard } from "@/lib/guard";
import { audit, requestIp } from "@/lib/audit";
import { moneyFail } from "@/lib/money-api";
import { withMoney } from "@/lib/ledger";
import { Gstr2bError, parse2b } from "@/lib/gst-2b";
import { import2b, remove2b } from "@/lib/gst-returns";

const MAX_BYTES = 10 * 1024 * 1024;

/** POST multipart { period, file (.json / .xlsx / .csv) }: store a month's GSTR-2B (replaces that month's). */
export async function POST(req: Request) {
  const auth = await guard("accounts.post");
  if (!auth.ok) return auth.res;
  const form = await req.formData().catch(() => null);
  const file = form?.get("file");
  const period = String(form?.get("period") ?? "");
  if (!file || typeof file === "string") return NextResponse.json({ error: "Choose the GSTR-2B file" }, { status: 400 });
  if (file.size > MAX_BYTES) return NextResponse.json({ error: "The file is over 10 MB" }, { status: 400 });
  let parsed;
  try {
    parsed = await parse2b(Buffer.from(await file.arrayBuffer()), file.name);
  } catch (e) {
    if (e instanceof Gstr2bError) return NextResponse.json({ error: e.message }, { status: 400 });
    throw e;
  }
  try {
    const r = await withMoney(auth.tenant.id, auth.session.userId, (ctx) => import2b(ctx, period, parsed, file.name));
    await audit(auth.db, { actorId: auth.session.userId, action: "gst.2b", entity: "Gstr2bImport", entityId: r.id, after: { period, file: file.name, rows: r.rows }, ip: requestIp(req) });
    return NextResponse.json(r);
  } catch (e) {
    return moneyFail(e);
  }
}

/** DELETE ?period=YYYY-MM: remove that month's GSTR-2B. */
export async function DELETE(req: Request) {
  const auth = await guard("accounts.post");
  if (!auth.ok) return auth.res;
  const period = new URL(req.url).searchParams.get("period") ?? "";
  try {
    const r = await withMoney(auth.tenant.id, auth.session.userId, (ctx) => remove2b(ctx, period));
    await audit(auth.db, { actorId: auth.session.userId, action: "gst.2b.remove", entity: "Gstr2bImport", entityId: period, after: r, ip: requestIp(req) });
    return NextResponse.json(r);
  } catch (e) {
    return moneyFail(e);
  }
}
