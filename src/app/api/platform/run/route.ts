import { NextResponse } from "next/server";
import { requestIp } from "@/lib/audit";
import { platformAudit, platformGuard } from "@/lib/platform-auth";
import { runBilling } from "@/lib/billing";
import { runLifecycle } from "@/lib/tenant-data";

/** Run the daily billing and deletion job now (OWNER). Safe to repeat. */
export async function POST(req: Request) {
  const g = await platformGuard("OWNER");
  if (!g.ok) return g.res;
  const billing = await runBilling();
  const lifecycle = await runLifecycle();
  await platformAudit(g.session.platformUserId, "platform.run", { detail: { ...billing, purged: lifecycle.purged.length, exportsExpired: lifecycle.exportsExpired }, ip: requestIp(req) });
  return NextResponse.json({ billing, lifecycle });
}
