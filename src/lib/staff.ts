import type { TenantDb } from "@/lib/db";
import { validMobile } from "@/lib/field-math";

/**
 * Optional staff fields from an admin form: phone (OTP sign-in and the
 * multi-business switch) and supervisor. Only the keys present change.
 */
export async function checkStaffFields(
  db: TenantDb,
  userId: string | null,
  body: Record<string, unknown> | null
): Promise<{ data: { phone?: string | null; supervisorId?: string | null } } | { error: string }> {
  const data: { phone?: string | null; supervisorId?: string | null } = {};
  if (body && "phone" in body) {
    const phone = typeof body.phone === "string" ? body.phone.replace(/\D/g, "") : "";
    if (phone) {
      if (!validMobile(phone)) return { error: "Enter a 10-digit mobile number" };
      const clash = await db.user.findFirst({ where: { phone, ...(userId ? { id: { not: userId } } : {}) }, select: { name: true } });
      if (clash) return { error: `${clash.name} already uses this mobile number` };
    }
    data.phone = phone || null;
  }
  if (body && "supervisorId" in body) {
    const sid = typeof body.supervisorId === "string" && body.supervisorId ? body.supervisorId : null;
    if (sid) {
      if (sid === userId) return { error: "Someone can't supervise themselves" };
      const sup = await db.user.findUnique({ where: { id: sid }, select: { role: true, active: true } });
      if (!sup || sup.role !== "SUPERVISOR" || !sup.active) return { error: "Pick an active supervisor" };
    }
    data.supervisorId = sid;
  }
  return { data };
}
