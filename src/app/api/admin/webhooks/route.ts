import { NextResponse } from "next/server";
import { guard } from "@/lib/guard";
import { audit, requestIp } from "@/lib/audit";
import { checkWebhookUrl, MAX_ENDPOINTS, newWebhookSecret, parseEvents, sealSecret } from "@/lib/webhooks";

/** Body: { url, events: [...], description? }. The signing secret comes back once here (and on Reveal). */
export async function POST(req: Request) {
  const auth = await guard("integrations.manage");
  if (!auth.ok) return auth.res;
  const { session, db } = auth;
  const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  const url = checkWebhookUrl(body?.url);
  if (typeof url === "string") return NextResponse.json({ error: url }, { status: 400 });
  const events = parseEvents(body?.events);
  if (typeof events === "string") return NextResponse.json({ error: events }, { status: 400 });
  if ((await db.webhookEndpoint.count()) >= MAX_ENDPOINTS) return NextResponse.json({ error: `At most ${MAX_ENDPOINTS} webhook addresses` }, { status: 409 });
  const secret = newWebhookSecret();
  const description = typeof body?.description === "string" ? body.description.trim().slice(0, 100) || null : null;
  const row = await db.webhookEndpoint.create({ data: { url: url.url, events, description, secret: sealSecret(secret), createdById: session.userId } });
  await audit(db, { actorId: session.userId, action: "webhook.create", entity: "WebhookEndpoint", entityId: row.id, after: { url: url.url, events }, ip: requestIp(req) });
  return NextResponse.json({ id: row.id, url: row.url, events, description, secret }, { status: 201 });
}
