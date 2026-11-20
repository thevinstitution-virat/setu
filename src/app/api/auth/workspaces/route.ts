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
  // Only a session that proved this phone by code may see the other businesses: an owner can type
  // any number on a staff login, and must not learn who else employs that number.
  const proved = (session.via === "otp" || session.via === "handoff") && !!me?.phone && session.phone === me.phone;
  const workspaces = proved ? await workspacesFor(me!.phone!, tenant.id) : [];
  return NextResponse.json({
    current: { name: tenant.name },
    workspaces: workspaces.map((w) => ({ slug: w.slug, name: w.name, role: w.role })),
    canHop: proved,
  });
}
