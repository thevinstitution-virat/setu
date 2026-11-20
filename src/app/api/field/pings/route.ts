import { NextResponse } from "next/server";
import { guard } from "@/lib/guard";
import { withMoney } from "@/lib/ledger";
import { moneyFail } from "@/lib/money-api";
import { recordPings, type PingIn } from "@/lib/field";

/**
 * Body: { source?: "app" | "android", pings: [{ at, lat, lng, accuracy?, battery? }] }
 * Positions are kept only while on duty and only when the business turned
 * tracking on. Not audited (high volume); the rows themselves are the record.
 */
export async function POST(req: Request) {
  const auth = await guard("attendance.mark");
  if (!auth.ok) return auth.res;
  const body = await req.json().catch(() => null);
  const raw: unknown[] = Array.isArray(body?.pings) ? body.pings.slice(0, 500) : [];
  const n = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : null);
  const pings: PingIn[] = [];
  for (const p of raw as Record<string, unknown>[]) {
    const at = new Date(typeof p?.at === "string" || typeof p?.at === "number" ? p.at : NaN);
    const lat = n(p?.lat);
    const lng = n(p?.lng);
    if (Number.isNaN(at.getTime()) || lat === null || lng === null) continue;
    const battery = n(p.battery);
    pings.push({ at, lat, lng, accuracy: n(p.accuracy), battery: battery === null ? null : Math.max(0, Math.min(100, Math.round(battery))) });
  }
  if (!pings.length) return NextResponse.json({ error: "No positions sent" }, { status: 400 });
  try {
    const res = await withMoney(auth.tenant.id, auth.session.userId, (ctx) => recordPings(ctx, auth.session.userId, pings, body?.source === "android" ? "android" : "app"));
    return NextResponse.json(res);
  } catch (e) {
    return moneyFail(e);
  }
}
