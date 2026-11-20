import { NextResponse } from "next/server";
import { guard } from "@/lib/guard";
import { automationSettings } from "@/lib/automation-settings";
import { ask } from "@/lib/ask";
import { MAX_QUESTION } from "@/lib/ask-rules";

/**
 * A11: POST { question } → an answer from the fixed report queries (needs
 * reports.view, like the Reports pages). Read-only.
 */
export async function POST(req: Request) {
  const auth = await guard("reports.view");
  if (!auth.ok) return auth.res;
  const { session, db, tenant } = auth;
  const body = (await req.json().catch(() => null)) as { question?: unknown } | null;
  const question = typeof body?.question === "string" ? body.question.trim() : "";
  if (!question) return NextResponse.json({ error: "Ask a question first" }, { status: 400 });
  if (question.length > MAX_QUESTION) return NextResponse.json({ error: `Keep the question under ${MAX_QUESTION} letters` }, { status: 400 });
  const t = await db.tenant.findUnique({ where: { id: tenant.id }, select: { settings: true } });
  if (!automationSettings(t?.settings).ask.on) return NextResponse.json({ error: "Questions are turned off (Settings → Automation)" }, { status: 403 });

  const r = await ask({ tenantId: tenant.id, actorId: session.userId, question });
  if (!r.ok) return NextResponse.json({ error: r.message, note: r.note }, { status: 422 });
  return NextResponse.json({ answer: r.answer });
}
