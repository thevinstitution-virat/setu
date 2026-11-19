import { NextResponse } from "next/server";
import { guard } from "@/lib/guard";
import { isFieldRole } from "@/lib/field-settings";
import { workspacesFor } from "@/lib/handoff";

/** Other businesses this field user can switch to (same phone, active login there). */
export async function GET() {
  const auth = await guard();
  if (!auth.ok) return auth.res;
  const { session, db, tenant } = auth;
  if (!isFieldRole(session.role)) return NextResponse.json({ current: { name: tenant.name }, workspaces: [], canHop: false });
  const me = await db.user.findUnique({ where: { id: session.userId }, select: { phone: true } });
  const workspaces = me?.phone ? await workspacesFor(me.phone, tenant.id) : [];
  return NextResponse.json({
    current: { name: tenant.name },
    workspaces: workspaces.map((w) => ({ slug: w.slug, name: w.name, role: w.role })),
    // A password session must sign in on the other business; OTP sessions hop straight in.
    canHop: (session.via === "otp" || session.via === "handoff") && session.phone === me?.phone,
  });
}
