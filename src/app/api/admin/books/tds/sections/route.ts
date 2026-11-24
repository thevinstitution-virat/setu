import { NextResponse } from "next/server";
import { guard } from "@/lib/guard";
import { audit, requestIp } from "@/lib/audit";
import { moneyFail } from "@/lib/money-api";
import { withMoney } from "@/lib/ledger";
import { saveTdsSection, tdsSections } from "@/lib/tds";

/** GET: the TDS sections (all, with ?all=1). */
export async function GET(req: Request) {
  const auth = await guard("accounts.view");
  if (!auth.ok) return auth.res;
  const all = new URL(req.url).searchParams.get("all") === "1";
  try {
    return NextResponse.json(await withMoney(auth.tenant.id, auth.session.userId, (ctx) => tdsSections(ctx, all)), { headers: { "cache-control": "no-store" } });
  } catch (e) {
    return moneyFail(e);
  }
}

const limit = (v: unknown) => (v === null || v === "" || v === undefined ? null : Number(v));

/** POST { id?, code, name, rateInd, rateOther, rateNoPan (hundredths of %), single?, yearly? (paise), overOnly, active, note }: add or change a section. */
export async function POST(req: Request) {
  const auth = await guard("accounts.post");
  if (!auth.ok) return auth.res;
  const b = ((await req.json().catch(() => null)) ?? {}) as Record<string, unknown>;
  try {
    const r = await withMoney(auth.tenant.id, auth.session.userId, (ctx) =>
      saveTdsSection(ctx, {
        id: typeof b.id === "string" ? b.id : null,
        code: String(b.code ?? ""),
        name: String(b.name ?? ""),
        rateInd: Number(b.rateInd),
        rateOther: Number(b.rateOther),
        rateNoPan: Number(b.rateNoPan),
        single: limit(b.single),
        yearly: limit(b.yearly),
        overOnly: !!b.overOnly,
        active: b.active !== false,
        note: typeof b.note === "string" ? b.note : null,
      }),
    );
    await audit(auth.db, { actorId: auth.session.userId, action: "tds.section", entity: "TdsSection", entityId: r.id, after: r, ip: requestIp(req) });
    return NextResponse.json(r);
  } catch (e) {
    return moneyFail(e);
  }
}
