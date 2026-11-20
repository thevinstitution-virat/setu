import { NextResponse } from "next/server";
import { takeWhatsappOther, takeWhatsappText, validSignature } from "@/lib/order-drafts";

/**
 * Messages shops send to the platform's WhatsApp number (Meta Cloud API).
 * GET: Meta's one-time check (hub.verify_token = WHATSAPP_VERIFY_TOKEN).
 * POST: signed with the app secret (X-Hub-Signature-256, WHATSAPP_APP_SECRET).
 * Text messages become order drafts the shop checks in the app (A1); we always
 * answer 200 quickly so Meta doesn't retry, and dedupe on the message id.
 */
export async function GET(req: Request) {
  const token = process.env.WHATSAPP_VERIFY_TOKEN;
  if (!token) return NextResponse.json({ error: "Not set up" }, { status: 404 });
  const q = new URL(req.url).searchParams;
  if (q.get("hub.mode") === "subscribe" && q.get("hub.verify_token") === token) return new Response(q.get("hub.challenge") ?? "", { status: 200 });
  return NextResponse.json({ error: "Bad token" }, { status: 403 });
}

type Msg = { from?: string; id?: string; type?: string; text?: { body?: string } };
type Body = { object?: string; entry?: { changes?: { field?: string; value?: { messages?: Msg[] } }[] }[] };

export async function POST(req: Request) {
  const secret = process.env.WHATSAPP_APP_SECRET;
  if (!secret) return NextResponse.json({ error: "Not set up" }, { status: 404 });
  const raw = await req.text();
  if (!validSignature(raw, req.headers.get("x-hub-signature-256"), secret)) return NextResponse.json({ error: "Bad signature" }, { status: 401 });
  let body: Body;
  try {
    body = JSON.parse(raw);
  } catch {
    return NextResponse.json({ error: "Bad body" }, { status: 400 });
  }
  const messages = (body.entry ?? []).flatMap((e) => (e.changes ?? []).filter((c) => c.field === "messages").flatMap((c) => c.value?.messages ?? [])).slice(0, 20);
  const results: string[] = [];
  for (const m of messages) {
    if (!m.from || !m.id) continue;
    try {
      const r =
        m.type === "text" && m.text?.body
          ? await takeWhatsappText({ from: m.from, messageId: m.id, text: m.text.body })
          : await takeWhatsappOther({ from: m.from, messageId: m.id, kind: m.type ?? "unknown" });
      results.push(r.status);
    } catch (e) {
      // Never make Meta retry a message we half-handled; the error is in the log.
      console.error("[whatsapp] inbound", e);
      results.push("error");
    }
  }
  return NextResponse.json({ ok: true, results });
}
