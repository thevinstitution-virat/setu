import { NextResponse } from "next/server";
import { guard } from "@/lib/guard";
import { checkSubject, viewOf } from "@/lib/photo-checks";

/**
 * A3: check the payment proof again now (after the photo or the entry
 * changed, or when AI was busy). Only a note: verifying is still a person's.
 */
export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await guard("payments.verify");
  if (!auth.ok) return auth.res;
  const { id } = await params;
  const p = await auth.db.payment.findUnique({ where: { id }, select: { id: true, proofKey: true } });
  if (!p) return NextResponse.json({ error: "Payment not found" }, { status: 404 });
  if (!p.proofKey) return NextResponse.json({ error: "This payment has no photo" }, { status: 400 });
  const row = await checkSubject(auth.tenant.id, "payment", id, { force: true });
  if (!row) return NextResponse.json({ error: "Couldn't open the photo" }, { status: 409 });
  return NextResponse.json({ photoCheck: viewOf(row) });
}
