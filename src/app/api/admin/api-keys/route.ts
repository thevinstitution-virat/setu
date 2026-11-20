import { NextResponse } from "next/server";
import { guard } from "@/lib/guard";
import { audit, requestIp } from "@/lib/audit";
import { makeKey, MAX_KEYS, parseScopes } from "@/lib/api-keys";

/** Body: { name, scopes: [...] }. The key comes back once, in this answer only. */
export async function POST(req: Request) {
  const auth = await guard("integrations.manage");
  if (!auth.ok) return auth.res;
  const { session, db } = auth;
  const body = (await req.json().catch(() => null)) as { name?: unknown; scopes?: unknown } | null;
  const name = typeof body?.name === "string" ? body.name.trim().slice(0, 60) : "";
  if (!name) return NextResponse.json({ error: "Name the key (e.g. which software uses it)" }, { status: 400 });
  const scopes = parseScopes(body?.scopes);
  if (typeof scopes === "string") return NextResponse.json({ error: scopes }, { status: 400 });
  if ((await db.apiKey.count({ where: { revokedAt: null } })) >= MAX_KEYS) return NextResponse.json({ error: `At most ${MAX_KEYS} keys; revoke one first` }, { status: 409 });
  const k = makeKey();
  const row = await db.apiKey.create({ data: { name, prefix: k.prefix, hash: k.hash, scopes, createdById: session.userId } });
  await audit(db, { actorId: session.userId, action: "api_key.create", entity: "ApiKey", entityId: row.id, after: { name, scopes, prefix: k.prefix }, ip: requestIp(req) });
  return NextResponse.json({ id: row.id, name, scopes, prefix: k.prefix, key: k.key }, { status: 201 });
}
