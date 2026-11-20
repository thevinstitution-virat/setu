import { NextResponse } from "next/server";
import { guard } from "@/lib/guard";
import { asPlatform, withTenantTx } from "@/lib/db";
import { checklist, isStepKey } from "@/lib/onboarding";
import type { Prisma } from "@/generated/prisma/client";

/** The set-up checklist for a new business. */
export async function GET() {
  const auth = await guard("settings.manage");
  if (!auth.ok) return auth.res;
  return NextResponse.json(await withTenantTx(auth.tenant.id, (tx) => checklist(tx, auth.tenant.id)));
}

/** Body: { step, state: "done" | "skipped" | "todo" } to tick a step off, or { dismiss: true | false } to hide the checklist. */
export async function PATCH(req: Request) {
  const auth = await guard("settings.manage");
  if (!auth.ok) return auth.res;
  const body = await req.json().catch(() => null);
  const t = await asPlatform((tx) => tx.tenant.findUniqueOrThrow({ where: { id: auth.tenant.id }, select: { onboarding: true } }));
  const ob = { ...((t.onboarding ?? {}) as Record<string, unknown>) };
  const steps = { ...((ob.steps ?? {}) as Record<string, string>) };
  if (typeof body?.dismiss === "boolean") {
    if (body.dismiss) ob.dismissedAt = new Date().toISOString();
    else delete ob.dismissedAt;
  } else if (isStepKey(body?.step) && ["done", "skipped", "todo"].includes(body?.state)) {
    if (body.state === "todo") delete steps[body.step];
    else steps[body.step] = body.state;
    ob.steps = steps;
  } else {
    return NextResponse.json({ error: "Send a step and its state, or dismiss" }, { status: 400 });
  }
  await asPlatform((tx) => tx.tenant.update({ where: { id: auth.tenant.id }, data: { onboarding: ob as Prisma.InputJsonValue } }));
  return NextResponse.json(await withTenantTx(auth.tenant.id, (tx) => checklist(tx, auth.tenant.id)));
}
