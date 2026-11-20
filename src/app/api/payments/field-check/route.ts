import { NextResponse } from "next/server";
import { guard } from "@/lib/guard";
import { moneySettings } from "@/lib/money-settings";

/** For field staff's collect screens: does UPI / bank taken in the field wait for the office (Settings → Money)? */
export async function GET() {
  const auth = await guard();
  if (!auth.ok) return auth.res;
  const t = await auth.db.tenant.findUnique({ where: { id: auth.tenant.id }, select: { settings: true } });
  return NextResponse.json({ check: moneySettings(t?.settings).checkFieldDigital });
}
