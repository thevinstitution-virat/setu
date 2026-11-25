import { NextResponse } from "next/server";
import { guard } from "@/lib/guard";
import { audit, requestIp } from "@/lib/audit";
import { checkStaffFields } from "@/lib/staff";
import { checkLimit, entitlements, LimitError } from "@/lib/plans";
import { addProblem, changeProblem } from "@/lib/team-rules";
import { normaliseEmail, validEmail } from "@/lib/email-auth";
import { EmailError, sendEmail } from "@/lib/email";
import { roleAssignedMail } from "@/lib/email-messages";
import { publicTenantUrl } from "@/lib/redirect";
import { platformDomain } from "@/lib/tenant";

const ROLES = ["ADMIN", "SALES_AGENT", "DELIVERY_AGENT", "SUPERVISOR", "ACCOUNTANT"] as const;

/**
 * POST { email, name?, role, supervisorId? } — the admin gives someone a role by email address.
 * An address that already signed in as a shopkeeper keeps its login and gets the new role; a new
 * address gets a login ready for its first sign-in. Either way the person gets a polite email
 * saying what changed and how to sign in, and sees the first-sign-in form for their role.
 */
export async function POST(req: Request) {
  const auth = await guard("team.manage");
  if (!auth.ok) return auth.res;
  const { session, db, tenant } = auth;
  const body = await req.json().catch(() => null);
  const email = normaliseEmail(body?.email);
  const role = String(body?.role ?? "");
  const name = typeof body?.name === "string" ? body.name.trim().slice(0, 80) : "";

  if (!validEmail(email)) return NextResponse.json({ error: "Enter a real email address" }, { status: 400 });
  if (!(ROLES as readonly string[]).includes(role)) return NextResponse.json({ error: "Choose a role" }, { status: 400 });
  const r = role as (typeof ROLES)[number];

  const me = await db.user.findUniqueOrThrow({ where: { id: session.userId }, select: { name: true, isOwner: true, isSupport: true } });
  const refused = addProblem({ userId: session.userId, isOwner: me.isOwner, isSupport: me.isSupport }, r);
  if (refused) return NextResponse.json({ error: refused }, { status: 403 });
  if (r === "SUPERVISOR" && !(await entitlements(tenant.id)).features.has("field")) {
    return NextResponse.json({ error: "Supervisors come with the Field team module. Move to a plan that has it under Billing.", code: "upgrade", feature: "field" }, { status: 402 });
  }

  const found = await db.user.findMany({
    where: { email: { equals: email, mode: "insensitive" }, isSupport: false },
    select: { id: true, name: true, role: true, active: true, isOwner: true, isSupport: true, emailVerifiedAt: true },
    orderBy: { createdAt: "asc" },
    take: 5,
  });
  const existing = found.find((u) => u.emailVerifiedAt) ?? found[0] ?? null;

  if (existing) {
    const stop = changeProblem({ userId: session.userId, isOwner: me.isOwner, isSupport: me.isSupport }, { id: existing.id, role: existing.role, isOwner: existing.isOwner, isSupport: existing.isSupport }, "edit");
    if (stop) return NextResponse.json({ error: stop }, { status: 403 });
    if (existing.id === session.userId) return NextResponse.json({ error: "You can't change your own role" }, { status: 400 });
    if (existing.role === r && existing.active) return NextResponse.json({ error: `${existing.name} is already a ${r.toLowerCase().replace("_", " ")} here` }, { status: 400 });
  }

  const extra = await checkStaffFields(db, existing?.id ?? null, body && body.supervisorId ? { supervisorId: body.supervisorId } : {});
  if ("error" in extra) return NextResponse.json({ error: extra.error }, { status: 400 });

  try {
    await checkLimit(db, tenant.id, "staff");
  } catch (e) {
    if (e instanceof LimitError) return NextResponse.json({ error: e.message, code: "limit" }, { status: 402 });
    throw e;
  }

  const profiles = {
    ...(r === "SALES_AGENT" ? { salesAgentProfile: { connectOrCreate: { where: { userId: existing?.id ?? "-" }, create: {} } } } : {}),
    ...(r === "DELIVERY_AGENT" ? { deliveryAgentProfile: { connectOrCreate: { where: { userId: existing?.id ?? "-" }, create: {} } } } : {}),
  };

  let userId: string;
  let finalName: string;
  if (existing) {
    // Same login, new role. The admin vouches for the address they typed, as with any staff email.
    await db.user.update({
      where: { id: existing.id },
      data: { role: r, active: true, onboardingDue: true, emailVerifiedAt: existing.emailVerifiedAt ?? new Date(), sessionVersion: { increment: 1 }, ...extra.data, ...(name ? { name } : {}), ...profiles },
    });
    userId = existing.id;
    finalName = name || existing.name;
  } else {
    const created = await db.user.create({
      data: {
        name: name || email.split("@")[0],
        email,
        emailVerifiedAt: new Date(),
        role: r,
        onboardingDue: true,
        ...extra.data,
        ...(r === "SALES_AGENT" ? { salesAgentProfile: { create: {} } } : {}),
        ...(r === "DELIVERY_AGENT" ? { deliveryAgentProfile: { create: {} } } : {}),
      },
    });
    userId = created.id;
    finalName = created.name;
  }

  await audit(db, { actorId: session.userId, action: existing ? "user.role_change" : "user.create", entity: "User", entityId: userId, before: existing ? { role: existing.role } : undefined, after: { email, role: r }, ip: requestIp(req) });

  let emailed = true;
  try {
    await sendEmail(
      roleAssignedMail(email, tenant.name, {
        name: finalName,
        role: r,
        byName: me.name,
        loginUrl: publicTenantUrl(tenant.slug, platformDomain(), "/login"),
        changed: !!existing,
      })
    );
  } catch (e) {
    if (!(e instanceof EmailError)) throw e;
    emailed = false; // The role is saved; the page tells the admin the email did not go.
  }

  return NextResponse.json({ ok: true, userId, emailed, changed: !!existing });
}
