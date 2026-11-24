import { NextResponse } from "next/server";
import { guard } from "@/lib/guard";
import { audit, requestIp } from "@/lib/audit";
import { moneyFail } from "@/lib/money-api";
import { withMoney } from "@/lib/ledger";
import { fyStart, todayIst } from "@/lib/books";
import { buildCaPack, caPackData } from "@/lib/final-accounts-export";

/** GET ?from=&to=: the CA pack (zip of PDFs and Excel) for a period; this financial year so far by default. */
export async function GET(req: Request) {
  const auth = await guard("accounts.view");
  if (!auth.ok) return auth.res;
  const sp = new URL(req.url).searchParams;
  const to = sp.get("to") || todayIst();
  const from = sp.get("from") || fyStart(to);
  try {
    const data = await withMoney(auth.tenant.id, auth.session.userId, (ctx) => caPackData(ctx, from, to));
    const pack = await buildCaPack(data);
    await audit(auth.db, {
      actorId: auth.session.userId,
      action: "books.capack",
      entity: "Tenant",
      entityId: auth.tenant.id,
      after: { from, to, files: pack.names.length, balanced: pack.balanced },
      ip: requestIp(req),
    });
    return new NextResponse(new Uint8Array(pack.bytes), {
      headers: { "content-type": "application/zip", "content-disposition": `attachment; filename="CA-pack-${from}-to-${to}.zip"`, "cache-control": "no-store" },
    });
  } catch (e) {
    return moneyFail(e);
  }
}
