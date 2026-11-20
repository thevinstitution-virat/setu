import { NextResponse } from "next/server";
import { guard } from "@/lib/guard";
import { audit, requestIp } from "@/lib/audit";
import { decryptSecret } from "@/lib/secrets";
import { checkWebhookUrl, newWebhookSecret, parseEvents, sealSecret, sendTest } from "@/lib/webhooks";
import type { DeliveryStatus } from "@/generated/prisma/client";
import { HOUR, limited } from "@/lib/rate-limit";

type P = { params: Promise<{ id: string }> };

/** Recent deliveries for one address. ?status=PENDING|SENT|FAILED|DEAD */
export async function GET(req: Request, { params }: P) {
  const auth = await guard("integrations.manage");
  if (!auth.ok) return auth.res;
  const { db } = auth;
  const { id } = await params;
  const status = new URL(req.url).searchParams.get("status") as DeliveryStatus | null;
  const deliveries = await db.webhookDelivery.findMany({
    where: { endpointId: id, ...(status && ["PENDING", "SENT", "FAILED", "DEAD"].includes(status) ? { status } : {}) },
    orderBy: { createdAt: "desc" },
    take: 50,
    select: { id: true, event: true, status: true, attempts: true, nextAttemptAt: true, lastCode: true, lastError: true, durationMs: true, sentAt: true, createdAt: true, payload: true },
  });
  return NextResponse.json({ deliveries });
}

/** Body: { url?, events?, description?, active? } */
export async function PATCH(req: Request, { params }: P) {
  const auth = await guard("integrations.manage");
  if (!auth.ok) return auth.res;
  const { session, db } = auth;
  const { id } = await params;
  const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  const data: { url?: string; events?: string[]; description?: string | null; active?: boolean; failStreak?: number; disabledReason?: null } = {};
  if (body && "url" in body) {
    const u = checkWebhookUrl(body.url);
    if (typeof u === "string") return NextResponse.json({ error: u }, { status: 400 });
    data.url = u.url;
  }
  if (body && "events" in body) {
    const e = parseEvents(body.events);
    if (typeof e === "string") return NextResponse.json({ error: e }, { status: 400 });
    data.events = e;
  }
  if (body && "description" in body) data.description = typeof body.description === "string" ? body.description.trim().slice(0, 100) || null : null;
  if (body && typeof body.active === "boolean") {
    data.active = body.active;
    if (body.active) Object.assign(data, { failStreak: 0, disabledReason: null });
  }
  if (!Object.keys(data).length) return NextResponse.json({ error: "Nothing to save" }, { status: 400 });
  const r = await db.webhookEndpoint.updateMany({ where: { id }, data });
  if (!r.count) return NextResponse.json({ error: "Webhook not found" }, { status: 404 });
  await audit(db, { actorId: session.userId, action: "webhook.update", entity: "WebhookEndpoint", entityId: id, after: data, ip: requestIp(req) });
  return NextResponse.json({ ok: true });
}

/** Body: { action: "test" | "reveal" | "rotate" } */
export async function POST(req: Request, { params }: P) {
  const auth = await guard("integrations.manage");
  if (!auth.ok) return auth.res;
  const { session, db, tenant } = auth;
  const { id } = await params;
  const body = (await req.json().catch(() => null)) as { action?: string } | null;
  const e = await db.webhookEndpoint.findUnique({ where: { id }, select: { id: true, secret: true } });
  if (!e) return NextResponse.json({ error: "Webhook not found" }, { status: 404 });
  switch (body?.action) {
    case "test":
      // Each test is an outbound call from our servers: a few an hour is plenty.
      if (await limited(`webhook-test:${tenant.id}`, id, 20, HOUR)) {
        return NextResponse.json({ error: "Many tests this hour. Try again later." }, { status: 429 });
      }
      return NextResponse.json(await sendTest(tenant.id, id));
    case "reveal":
      await audit(db, { actorId: session.userId, action: "webhook.reveal", entity: "WebhookEndpoint", entityId: id, ip: requestIp(req) });
      return NextResponse.json({ secret: decryptSecret(e.secret) });
    case "rotate": {
      const secret = newWebhookSecret();
      await db.webhookEndpoint.update({ where: { id }, data: { secret: sealSecret(secret) } });
      await audit(db, { actorId: session.userId, action: "webhook.rotate", entity: "WebhookEndpoint", entityId: id, ip: requestIp(req) });
      return NextResponse.json({ secret });
    }
  }
  return NextResponse.json({ error: "Action is test, reveal or rotate" }, { status: 400 });
}

export async function DELETE(req: Request, { params }: P) {
  const auth = await guard("integrations.manage");
  if (!auth.ok) return auth.res;
  const { session, db } = auth;
  const { id } = await params;
  const r = await db.webhookEndpoint.deleteMany({ where: { id } });
  if (!r.count) return NextResponse.json({ error: "Webhook not found" }, { status: 404 });
  await audit(db, { actorId: session.userId, action: "webhook.delete", entity: "WebhookEndpoint", entityId: id, ip: requestIp(req) });
  return NextResponse.json({ ok: true });
}
