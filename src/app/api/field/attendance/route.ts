import { stockMutation, optStr } from "@/lib/stock-api";
import { fieldRead, optNum, qp } from "@/lib/field-api";
import { attendanceMonth, checkIn, checkOut, dutyStart, fieldSettingsOf, inScope, teamScope } from "@/lib/field";
import { MoneyError } from "@/lib/money-error";
import { istDay, istMonth } from "@/lib/field-math";

/**
 * GET ?month=YYYY-MM[&userId=][&lite=1] → today's punch, the rules (selfie / geo /
 * tracking) and the month calendar. Supervisors may pass a team member.
 */
export async function GET(req: Request) {
  const sp = qp(req);
  return fieldRead("attendance.mark", async (ctx, who) => {
    const userId = sp.get("userId") || who.userId;
    if (userId !== who.userId && !inScope(await teamScope(ctx.tx, who), userId)) throw new MoneyError("Not in your team", 403);
    const s = await fieldSettingsOf(ctx.tx, ctx.tenantId);
    const today = await ctx.tx.attendance.findUnique({ where: { tenantId_userId_date: { tenantId: ctx.tenantId, userId, date: istDay() } } });
    const since = await dutyStart(ctx.tx, ctx.tenantId, userId);
    const u = await ctx.tx.user.findUniqueOrThrow({ where: { id: userId }, select: { id: true, name: true, role: true, createdAt: true } });
    // joined: days before the login existed are never "absent".
    const user = { id: u.id, name: u.name, role: u.role, joined: istDay(u.createdAt) };
    const rules = { selfie: s.selfie, geo: s.geo, trackLocation: s.trackLocation, pingMinutes: s.pingMinutes, workStart: s.workStart };
    // ?lite=1: just duty and rules, for the position tracker's poll.
    if (sp.get("lite") === "1") return { userId, user, today, onDuty: !!since, rules };
    return {
      userId,
      user,
      today,
      onDuty: !!since,
      rules,
      month: await attendanceMonth(ctx.tx, userId, sp.get("month") || istMonth()),
    };
  });
}

/** Body: { action: "in" | "out", selfie?: upload key, lat?, lng?, accuracy? } */
export async function POST(req: Request) {
  return stockMutation(
    req,
    "attendance.punch",
    async (ctx, b) => {
      const punch = { selfie: optStr(b.selfie, 300), lat: optNum(b.lat), lng: optNum(b.lng), accuracy: optNum(b.accuracy) };
      if (b.action === "in") return checkIn(ctx, ctx.actorId!, punch);
      if (b.action === "out") return checkOut(ctx, ctx.actorId!, punch);
      throw new MoneyError("Say check in or check out");
    },
    { perm: "attendance.mark", entity: "Attendance" }
  );
}
