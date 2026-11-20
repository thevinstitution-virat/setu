import { NextResponse } from "next/server";
import { guard } from "@/lib/guard";
import { withTenantTx } from "@/lib/db";
import { isSuggestionKind, kindsFor, listSuggestions } from "@/lib/automation";

const STATUSES = ["OPEN", "ACCEPTED", "REJECTED", "EXPIRED"] as const;
type Status = (typeof STATUSES)[number];

/** GET ?status=OPEN|ACCEPTED|REJECTED|EXPIRED&kind= → the suggestions this person may decide, and open counts by kind. */
export async function GET(req: Request) {
  const auth = await guard();
  if (!auth.ok) return auth.res;
  const role = auth.session.role;
  if (!kindsFor(role).length) return NextResponse.json({ error: "Not allowed" }, { status: 403 });
  const sp = new URL(req.url).searchParams;
  const raw = sp.get("status") ?? "OPEN";
  if (!(STATUSES as readonly string[]).includes(raw)) return NextResponse.json({ error: "Unknown status" }, { status: 400 });
  const kind = sp.get("kind");
  if (kind && !isSuggestionKind(kind)) return NextResponse.json({ error: "Unknown kind" }, { status: 400 });
  const out = await withTenantTx(auth.tenant.id, (tx) =>
    listSuggestions(tx, { userId: auth.session.userId, role }, { status: raw as Status, kind: kind && isSuggestionKind(kind) ? kind : undefined })
  );
  return NextResponse.json({ ...out, kinds: kindsFor(role) }, { headers: { "cache-control": "no-store" } });
}
