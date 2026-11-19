/**
 * Field sales force (Phase 6): attendance for every field role, location
 * pings during duty only, leave, dated beat plans, visits with an order /
 * no-order outcome, new shops from the field (approval queue), targets and
 * incentives, and the supervisor's team view.
 *
 * Server only. Functions take the money Ctx (one tenant transaction) and
 * throw MoneyError(message, status) for rule breaks, like lib/stock.ts.
 */
import type { Role, TargetMetric } from "@/generated/prisma/client";
import type { Ctx } from "@/lib/ledger";
import type { Tx } from "@/lib/db";
import { MoneyError } from "@/lib/money-error";
import { can } from "@/lib/permissions";
import { validGstin } from "@/lib/gst";
import {
  FIELD_ROLES,
  fieldSettings,
  isFieldRole,
  isLeaveType,
  isNoOrderReason,
  type ExceptionKind,
  type FieldSettings,
} from "@/lib/field-settings";
import {
  addDay,
  daysInclusive,
  isDay,
  isLate,
  istDay,
  istDayRange,
  istMinutes,
  istMonthRange,
  isMonth,
  longestGapMinutes,
  metres,
  pathMetres,
  payout,
  pctOf,
  validFssai,
  validMobile,
  weekday,
} from "@/lib/field-math";

const fail = (msg: string, status = 400, extra?: Record<string, unknown>) => new MoneyError(msg, status, extra);

export async function fieldSettingsOf(tx: Tx, tenantId: string): Promise<FieldSettings> {
  const t = await tx.tenant.findUniqueOrThrow({ where: { id: tenantId }, select: { settings: true } });
  return fieldSettings(t.settings);
}

// ───────────────────────────── scope ─────────────────────────────

export type Who = { userId: string; role: Role };

/**
 * Whose field data this person may see: null = everyone (admins), a
 * supervisor = themselves and their team, anyone else = only themselves.
 */
export async function teamScope(tx: Tx, who: Who): Promise<string[] | null> {
  if (can(who.role, "team.manage")) return null;
  if (who.role === "SUPERVISOR") {
    const team = await tx.user.findMany({ where: { supervisorId: who.userId }, select: { id: true } });
    return [who.userId, ...team.map((u) => u.id)];
  }
  return [who.userId];
}

export function inScope(scope: string[] | null, userId: string) {
  return scope === null || scope.includes(userId);
}

const scopeWhere = (scope: string[] | null) => (scope === null ? {} : { id: { in: scope } });

/** Active field staff in scope. */
export function fieldMembers(tx: Tx, scope: string[] | null) {
  return tx.user.findMany({
    where: { ...scopeWhere(scope), role: { in: [...FIELD_ROLES] }, active: true },
    select: { id: true, name: true, role: true, phone: true, supervisorId: true, salesAgentProfile: { select: { id: true } } },
    orderBy: { name: "asc" },
  });
}

/** The acting user, as a Who (for routes that only have the Ctx). */
export async function actor(ctx: Ctx): Promise<Who> {
  const u = await ctx.tx.user.findUniqueOrThrow({ where: { id: ctx.actorId! }, select: { id: true, role: true } });
  return { userId: u.id, role: u.role };
}

/** Supervisors may only plan for sales agents in their team; admins for anyone. */
export async function assertAgentInScope(ctx: Ctx, salesAgentId: unknown) {
  const scope = await teamScope(ctx.tx, await actor(ctx));
  const agent = typeof salesAgentId === "string" ? await ctx.tx.salesAgentProfile.findUnique({ where: { id: salesAgentId }, select: { userId: true } }) : null;
  if (!agent) throw fail("Pick the sales agent");
  if (!inScope(scope, agent.userId)) throw fail("That agent is not in your team", 403);
}

/** Supervisors may only act for people in their team; admins for anyone. */
export async function assertUserInScope(ctx: Ctx, userId: unknown) {
  if (typeof userId !== "string") throw fail("Pick the person");
  if (!inScope(await teamScope(ctx.tx, await actor(ctx)), userId)) throw fail("That person is not in your team", 403);
}

// ───────────────────────────── attendance ─────────────────────────────

export type Punch = { selfie?: string | null; lat?: number | null; lng?: number | null; accuracy?: number | null; now?: Date };

function needPunchProof(s: FieldSettings, p: Punch, verb: string) {
  if (s.selfie && !p.selfie) throw fail(`Take a selfie to ${verb}`);
  if (s.geo && (p.lat == null || p.lng == null)) throw fail(`Turn on location to ${verb}`);
}

/**
 * Check in for today (IST). Idempotent. `auto` is used when a driver goes on
 * duty: no selfie is asked and an existing day is simply returned.
 */
export async function checkIn(ctx: Ctx, userId: string, p: Punch, opts: { auto?: boolean } = {}) {
  const s = await fieldSettingsOf(ctx.tx, ctx.tenantId);
  const now = p.now ?? new Date();
  const date = istDay(now);
  const day = await ctx.tx.attendance.findUnique({ where: { tenantId_userId_date: { tenantId: ctx.tenantId, userId, date } } });
  if (day?.checkInAt) {
    if (day.checkOutAt && !opts.auto) throw fail("You have already checked out today", 409);
    return day;
  }
  if (!opts.auto) needPunchProof(s, p, "check in");
  const data = {
    checkInAt: now,
    checkInLat: p.lat ?? null,
    checkInLng: p.lng ?? null,
    checkInAccuracy: p.accuracy ?? null,
    checkInSelfie: p.selfie ?? null,
    late: isLate(now, s.workStart),
  };
  return day
    ? ctx.tx.attendance.update({ where: { id: day.id }, data })
    : ctx.tx.attendance.create({ data: { userId, date, ...data } });
}

/** Check out: worked minutes and distance (from today's pings) are frozen on the day. */
export async function checkOut(ctx: Ctx, userId: string, p: Punch) {
  const s = await fieldSettingsOf(ctx.tx, ctx.tenantId);
  const now = p.now ?? new Date();
  const date = istDay(now);
  const day = await ctx.tx.attendance.findUnique({ where: { tenantId_userId_date: { tenantId: ctx.tenantId, userId, date } } });
  if (!day?.checkInAt) throw fail("Check in first", 409);
  if (day.checkOutAt) throw fail("You have already checked out today", 409);
  const shift = await ctx.tx.dutyShift.findFirst({ where: { userId, endAt: null }, select: { id: true } });
  if (shift) throw fail("Go off duty first", 409);
  const open = await openVisitOf(ctx.tx, userId);
  if (open) throw fail(`Check out of ${open.retailer.outletName} first`, 409);
  needPunchProof(s, p, "check out");
  const pings = await ctx.tx.locationPing.findMany({ where: { userId, at: { gte: day.checkInAt, lte: now } }, select: { at: true, lat: true, lng: true, accuracy: true } });
  return ctx.tx.attendance.update({
    where: { id: day.id },
    data: {
      checkOutAt: now,
      checkOutLat: p.lat ?? null,
      checkOutLng: p.lng ?? null,
      checkOutAccuracy: p.accuracy ?? null,
      checkOutSelfie: p.selfie ?? null,
      minutes: Math.max(0, Math.round((now.getTime() - day.checkInAt.getTime()) / 60_000)),
      distanceM: pathMetres(pings),
    },
  });
}

async function openVisitOf(tx: Tx, userId: string) {
  return tx.visit.findFirst({ where: { salesAgent: { userId }, checkOutAt: null }, select: { id: true, retailer: { select: { outletName: true } } } });
}

/** On duty: drivers while their duty shift is open; everyone else from check-in to check-out. */
export async function dutyStart(tx: Tx, tenantId: string, userId: string, now = new Date()): Promise<Date | null> {
  const shift = await tx.dutyShift.findFirst({ where: { userId, endAt: null }, orderBy: { startAt: "desc" }, select: { startAt: true } });
  // Drivers are on duty only while their duty switch is on: going off duty
  // stops positions at once, even before the day's check-out.
  const user = await tx.user.findUnique({ where: { id: userId }, select: { role: true } });
  if (user?.role === "DELIVERY_AGENT") return shift?.startAt ?? null;
  const day = await tx.attendance.findUnique({ where: { tenantId_userId_date: { tenantId, userId, date: istDay(now) } } });
  if (day?.checkInAt && !day.checkOutAt) return day.checkInAt;
  return shift?.startAt ?? null;
}

/** Attendance calendar for one person: days with punches and approved / pending leave. */
export async function attendanceMonth(tx: Tx, userId: string, month: string) {
  if (!isMonth(month)) throw fail("Pick a month");
  const from = `${month}-01`;
  const to = `${month}-31`;
  const [days, leave] = await Promise.all([
    tx.attendance.findMany({ where: { userId, date: { gte: from, lte: to } }, orderBy: { date: "asc" } }),
    tx.leaveRequest.findMany({ where: { userId, status: { in: ["PENDING", "APPROVED"] }, fromDate: { lte: to }, toDate: { gte: from } }, orderBy: { fromDate: "asc" } }),
  ]);
  const worked = days.filter((d) => d.checkInAt);
  return {
    days,
    leave,
    totals: {
      present: worked.length,
      late: worked.filter((d) => d.late).length,
      minutes: worked.reduce((a, d) => a + (d.minutes ?? 0), 0),
      distanceM: worked.reduce((a, d) => a + (d.distanceM ?? 0), 0),
      leaveDays: leave.filter((l) => l.status === "APPROVED").reduce((a, l) => a + overlapDays(l.fromDate, l.toDate, from, to), 0),
    },
  };
}

const overlapDays = (a1: string, a2: string, b1: string, b2: string) => daysInclusive(a1 > b1 ? a1 : b1, a2 < b2 ? a2 : b2);

// ───────────────────────────── location pings ─────────────────────────────

export type PingIn = { at: Date; lat: number; lng: number; accuracy: number | null; battery: number | null };

/** Store positions sent while on duty. Positions from before duty started, or off duty, are refused. */
export async function recordPings(ctx: Ctx, userId: string, pings: PingIn[], source: "app" | "android", now = new Date()) {
  const s = await fieldSettingsOf(ctx.tx, ctx.tenantId);
  if (!s.trackLocation) throw fail("Location tracking is off for this business", 409);
  const start = await dutyStart(ctx.tx, ctx.tenantId, userId, now);
  if (!start) throw fail("Positions are only kept while you are on duty", 409);
  const ok = pings
    .filter((p) => p.at >= start && p.at.getTime() <= now.getTime() + 120_000 && Math.abs(p.lat) <= 90 && Math.abs(p.lng) <= 180)
    .slice(0, 500);
  if (ok.length) {
    await ctx.tx.locationPing.createMany({
      data: ok.map((p) => ({ userId, at: p.at, lat: p.lat, lng: p.lng, accuracy: p.accuracy, battery: p.battery, source })),
    });
  }
  return { saved: ok.length, skipped: pings.length - ok.length, nextInSeconds: s.pingMinutes * 60 };
}

/** Delete positions older than the retention period (nightly job). */
export async function purgePings(ctx: Ctx, now = new Date()) {
  const s = await fieldSettingsOf(ctx.tx, ctx.tenantId);
  const res = await ctx.tx.locationPing.deleteMany({ where: { at: { lt: new Date(now.getTime() - s.pingRetentionDays * 86_400_000) } } });
  return res.count;
}

// ───────────────────────────── leave ─────────────────────────────

export async function requestLeave(ctx: Ctx, userId: string, input: { fromDate: unknown; toDate: unknown; type: unknown; reason?: string | null }, now = new Date()) {
  const { fromDate, toDate, type } = input;
  if (!isDay(fromDate) || !isDay(toDate)) throw fail("Pick the leave dates");
  if (toDate < fromDate) throw fail("The last day is before the first day");
  if (!isLeaveType(type)) throw fail("Pick the kind of leave");
  if (fromDate < addDay(istDay(now), -7)) throw fail("Leave can be asked for up to 7 days back");
  const days = daysInclusive(fromDate, toDate);
  if (days > 60) throw fail("Ask for at most 60 days at a time");
  const clash = await ctx.tx.leaveRequest.findFirst({
    where: { userId, status: { in: ["PENDING", "APPROVED"] }, fromDate: { lte: toDate }, toDate: { gte: fromDate } },
    select: { fromDate: true, toDate: true },
  });
  if (clash) throw fail(`You already asked for leave from ${clash.fromDate} to ${clash.toDate}`, 409);
  return ctx.tx.leaveRequest.create({ data: { userId, fromDate, toDate, days, type, reason: input.reason?.trim() || null } });
}

/** Approve / reject (supervisor of that person, or admin), or cancel (the person, or a decider). */
export async function decideLeave(ctx: Ctx, who: Who, id: string, action: "approve" | "reject" | "cancel", note: string | null, now = new Date()) {
  const leave = await ctx.tx.leaveRequest.findUnique({ where: { id } });
  if (!leave) throw fail("Leave request not found", 404);
  const scope = await teamScope(ctx.tx, who);
  const decider = (can(who.role, "team.supervise") || can(who.role, "team.manage")) && inScope(scope, leave.userId) && leave.userId !== who.userId;
  if (action === "cancel") {
    if (leave.userId !== who.userId && !decider) throw fail("You can't change this leave", 403);
    if (leave.status === "REJECTED" || leave.status === "CANCELLED") throw fail("This leave is already closed", 409);
    if (leave.status === "APPROVED" && leave.fromDate <= istDay(now) && !decider) throw fail("Leave that has started can only be cancelled by your supervisor", 409);
    return ctx.tx.leaveRequest.update({ where: { id }, data: { status: "CANCELLED", decidedById: who.userId, decidedAt: now, decisionNote: note } });
  }
  if (!decider) throw fail(leave.userId === who.userId ? "Someone else must approve your own leave" : "You can't decide this leave", 403);
  if (leave.status !== "PENDING") throw fail("This leave was already decided", 409);
  if (action === "reject" && !note) throw fail("Say why the leave is refused");
  return ctx.tx.leaveRequest.update({
    where: { id },
    data: { status: action === "approve" ? "APPROVED" : "REJECTED", decidedById: who.userId, decidedAt: now, decisionNote: note },
  });
}

/** People (of these) on approved leave on a day. */
export async function onLeave(tx: Tx, userIds: string[], date: string): Promise<Set<string>> {
  const rows = await tx.leaveRequest.findMany({ where: { userId: { in: userIds }, status: "APPROVED", fromDate: { lte: date }, toDate: { gte: date } }, select: { userId: true } });
  return new Set(rows.map((r) => r.userId));
}

// ───────────────────────────── beats ─────────────────────────────

export type BeatInput = { name?: unknown; salesAgentId?: unknown; areaId?: unknown; weekdays?: unknown; retailerIds?: unknown; active?: unknown };

export async function saveBeat(ctx: Ctx, id: string | null, input: BeatInput) {
  const name = typeof input.name === "string" ? input.name.trim().slice(0, 80) : "";
  if (!name) throw fail("Name the beat");
  if (typeof input.salesAgentId !== "string" || !(await ctx.tx.salesAgentProfile.findUnique({ where: { id: input.salesAgentId }, select: { id: true } })))
    throw fail("Pick the sales agent");
  if (typeof input.areaId !== "string" || !(await ctx.tx.area.findUnique({ where: { id: input.areaId }, select: { id: true } }))) throw fail("Pick the area");
  const weekdays = Array.isArray(input.weekdays) ? [...new Set(input.weekdays.map(Number))].sort() : [];
  if (weekdays.some((d) => !Number.isInteger(d) || d < 0 || d > 6)) throw fail("Days must be Sunday to Saturday");
  const retailerIds = Array.isArray(input.retailerIds) ? [...new Set(input.retailerIds.map(String))] : null;
  if (retailerIds) {
    if (retailerIds.length > 300) throw fail("A beat can have at most 300 shops");
    const found = await ctx.tx.retailerProfile.count({ where: { id: { in: retailerIds } } });
    if (found !== retailerIds.length) throw fail("Some shops were not found");
  }
  const data = { name, salesAgentId: input.salesAgentId, areaId: input.areaId, weekdays, ...(typeof input.active === "boolean" ? { active: input.active } : {}) };
  const beat = id ? await ctx.tx.beat.update({ where: { id }, data }) : await ctx.tx.beat.create({ data });
  if (retailerIds) {
    await ctx.tx.beatRetailer.deleteMany({ where: { beatId: beat.id } });
    if (retailerIds.length) await ctx.tx.beatRetailer.createMany({ data: retailerIds.map((retailerId, seq) => ({ beatId: beat.id, retailerId, seq })) });
  }
  return beat;
}

/** Set (or clear, with beatId undefined → back to the usual weekdays) the beat for dates. */
export async function setBeatPlans(ctx: Ctx, salesAgentId: string, entries: { date: unknown; beatId?: string | null; clear?: boolean; note?: string | null }[]) {
  if (!entries.length || entries.length > 62) throw fail("Plan 1 to 62 days at a time");
  const beats = await ctx.tx.beat.findMany({ where: { salesAgentId }, select: { id: true } });
  const own = new Set(beats.map((b) => b.id));
  const out = [];
  for (const e of entries) {
    if (!isDay(e.date)) throw fail("Bad date in the plan");
    if (e.clear) {
      await ctx.tx.beatPlan.deleteMany({ where: { salesAgentId, date: e.date } });
      continue;
    }
    if (e.beatId && !own.has(e.beatId)) throw fail("That beat belongs to another agent");
    out.push(
      await ctx.tx.beatPlan.upsert({
        where: { tenantId_salesAgentId_date: { tenantId: ctx.tenantId, salesAgentId, date: e.date } },
        create: { salesAgentId, date: e.date, beatId: e.beatId ?? null, note: e.note ?? null, createdById: ctx.actorId },
        update: { beatId: e.beatId ?? null, note: e.note ?? null, createdById: ctx.actorId },
      })
    );
  }
  return out;
}

/** The beat an agent works on a day: a dated plan wins, else the first active beat on that weekday. */
export async function beatForDay(tx: Tx, tenantId: string, salesAgentId: string, date: string) {
  const plan = await tx.beatPlan.findUnique({ where: { tenantId_salesAgentId_date: { tenantId, salesAgentId, date } } });
  if (plan) {
    const beat = plan.beatId ? await tx.beat.findUnique({ where: { id: plan.beatId } }) : null;
    return { plan, beat, source: "plan" as const };
  }
  const beat = await tx.beat.findFirst({ where: { salesAgentId, active: true, weekdays: { has: weekday(date) } }, orderBy: { name: "asc" } });
  return { plan: null, beat, source: beat ? ("weekday" as const) : null };
}

/** Today's route for an agent: the beat's shops in order with today's visit, plus coverage. */
export async function dayRoute(tx: Tx, tenantId: string, salesAgentId: string, date: string) {
  const { plan, beat, source } = await beatForDay(tx, tenantId, salesAgentId, date);
  const { from, to } = istDayRange(date);
  const shops = beat
    ? await tx.beatRetailer.findMany({
        where: { beatId: beat.id },
        orderBy: { seq: "asc" },
        select: {
          seq: true,
          retailer: {
            select: {
              id: true,
              outletName: true,
              shopNumber: true,
              complexName: true,
              pinCode: true,
              lat: true,
              lng: true,
              area: { select: { name: true } },
              user: { select: { phone: true, name: true } },
            },
          },
        },
      })
    : [];
  const visits = await tx.visit.findMany({
    where: { salesAgentId, checkInAt: { gte: from, lt: to } },
    orderBy: { checkInAt: "asc" },
    select: { id: true, retailerId: true, checkInAt: true, checkOutAt: true, outcome: true, noOrderReason: true, orderId: true, offBeat: true, distanceM: true, retailer: { select: { outletName: true } }, order: { select: { orderNumber: true, totalAmount: true } } },
  });
  const byShop = new Map<string, (typeof visits)[number]>();
  for (const v of visits) byShop.set(v.retailerId, v);
  const route = shops.map((s) => ({ seq: s.seq, retailer: s.retailer, visit: byShop.get(s.retailer.id) ?? null }));
  const onRoute = new Set(route.map((r) => r.retailer.id));
  return {
    date,
    source,
    plan: plan ? { id: plan.id, note: plan.note } : null,
    beat: beat ? { id: beat.id, name: beat.name } : null,
    route,
    offRoute: visits.filter((v) => !onRoute.has(v.retailerId)),
    planned: route.length,
    covered: route.filter((r) => r.visit).length,
    ordered: route.filter((r) => r.visit?.outcome === "ORDER" || r.visit?.orderId).length,
  };
}

// ───────────────────────────── visits ─────────────────────────────

export type GeoIn = { lat?: number | null; lng?: number | null; accuracy?: number | null };

export async function startVisit(ctx: Ctx, who: Who, retailerId: string, geo: GeoIn, now = new Date()) {
  const agent = await ctx.tx.salesAgentProfile.findUnique({ where: { userId: who.userId }, select: { id: true } });
  if (!agent) throw fail("Only sales agents log visits", 403);
  const open = await ctx.tx.visit.findFirst({ where: { salesAgentId: agent.id, checkOutAt: null }, select: { id: true, retailerId: true, retailer: { select: { outletName: true } } } });
  if (open) {
    if (open.retailerId === retailerId) return ctx.tx.visit.findUniqueOrThrow({ where: { id: open.id } });
    throw fail(`Check out of ${open.retailer.outletName} first`, 409, { openVisitId: open.id });
  }
  const retailer = await ctx.tx.retailerProfile.findUnique({ where: { id: retailerId }, select: { id: true, salesAgentId: true, lat: true, lng: true } });
  if (!retailer) throw fail("Shop not found", 404);
  const s = await fieldSettingsOf(ctx.tx, ctx.tenantId);
  const route = await dayRoute(ctx.tx, ctx.tenantId, agent.id, istDay(now));
  const onBeat = route.route.some((r) => r.retailer.id === retailerId);
  const offBeat = retailer.salesAgentId !== agent.id && !onBeat;
  if (offBeat && !s.offBeat && !can(who.role, "field.offbeat")) throw fail("This shop is not on your list", 403);
  const distanceM = retailer.lat != null && retailer.lng != null && geo.lat != null && geo.lng != null ? Math.round(metres({ lat: retailer.lat, lng: retailer.lng }, { lat: geo.lat, lng: geo.lng })) : null;
  return ctx.tx.visit.create({
    data: {
      salesAgentId: agent.id,
      retailerId,
      checkInAt: now,
      checkInLat: geo.lat ?? null,
      checkInLng: geo.lng ?? null,
      checkInAccuracy: geo.accuracy ?? null,
      distanceM,
      offBeat,
      beatPlanId: onBeat ? route.plan?.id ?? null : null,
    },
  });
}

/** End a visit: ORDER when an order was placed on it, otherwise a no-order reason is needed. */
export async function endVisit(ctx: Ctx, who: Who, visitId: string, input: { reason?: unknown; note?: string | null } & GeoIn, now = new Date()) {
  const visit = await ctx.tx.visit.findUnique({ where: { id: visitId }, include: { salesAgent: { select: { userId: true } } } });
  if (!visit || visit.salesAgent.userId !== who.userId) throw fail("Visit not found", 404);
  if (visit.checkOutAt) throw fail("This visit is already closed", 409);
  const ordered = !!visit.orderId;
  if (!ordered) {
    if (!isNoOrderReason(input.reason)) throw fail("Say why there was no order");
    if (input.reason === "other" && !input.note) throw fail("Add a note for Other");
  }
  return ctx.tx.visit.update({
    where: { id: visitId },
    data: {
      checkOutAt: now,
      checkOutLat: input.lat ?? null,
      checkOutLng: input.lng ?? null,
      outcome: ordered ? "ORDER" : "NO_ORDER",
      noOrderReason: ordered ? null : (input.reason as string),
      notes: input.note?.trim() || visit.notes,
    },
  });
}

/** Shops an agent may visit: their own first, then (when allowed) any shop matching the search. */
export async function fieldShops(tx: Tx, who: Who, s: FieldSettings, q: string) {
  const agent = await tx.salesAgentProfile.findUnique({ where: { userId: who.userId }, select: { id: true } });
  const any = s.offBeat || can(who.role, "field.offbeat");
  const text = q.trim();
  const match = text
    ? { OR: [{ outletName: { contains: text, mode: "insensitive" as const } }, { pinCode: { startsWith: text } }, { user: { phone: { contains: text } } }, { area: { name: { contains: text, mode: "insensitive" as const } } }] }
    : {};
  const rows = await tx.retailerProfile.findMany({
    where: { ...match, ...(any ? {} : { salesAgentId: agent?.id ?? "-" }), user: { active: true, ...(text ? {} : {}) } },
    select: { id: true, outletName: true, pinCode: true, salesAgentId: true, area: { select: { name: true } }, user: { select: { phone: true } } },
    orderBy: { outletName: "asc" },
    take: text ? 30 : 100,
  });
  return rows
    .map((r) => ({ id: r.id, outletName: r.outletName, pinCode: r.pinCode, area: r.area.name, phone: r.user.phone, mine: !!agent && r.salesAgentId === agent.id }))
    .sort((a, b) => Number(b.mine) - Number(a.mine));
}

// ───────────────────────────── new shops from the field ─────────────────────────────

export type LeadInput = {
  outletName?: unknown;
  ownerName?: unknown;
  phone?: unknown;
  gstin?: unknown;
  fssai?: unknown;
  shopNumber?: unknown;
  complexName?: unknown;
  pinCode?: unknown;
  areaId?: unknown;
  lat?: unknown;
  lng?: unknown;
  accuracy?: unknown;
  photoKey?: string | null;
  note?: unknown;
};

const text = (v: unknown, max = 120) => (typeof v === "string" ? v.trim().slice(0, max) : "");
const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : null);

/** Shops / proposals that clash with this phone or GSTIN. */
export async function leadClashes(tx: Tx, phone: string, gstin: string | null, exceptLeadId?: string) {
  const [user, gst, lead] = await Promise.all([
    tx.user.findFirst({ where: { phone }, select: { name: true, role: true, retailerProfile: { select: { outletName: true } } } }),
    gstin ? tx.retailerProfile.findFirst({ where: { gstin }, select: { outletName: true } }) : null,
    tx.storeLead.findFirst({ where: { status: "PENDING", ...(exceptLeadId ? { id: { not: exceptLeadId } } : {}), OR: [{ phone }, ...(gstin ? [{ gstin }] : [])] }, select: { outletName: true } }),
  ]);
  const out: string[] = [];
  if (user) out.push(`Phone ${phone} already belongs to ${user.retailerProfile?.outletName ?? user.name}`);
  if (gst) out.push(`GSTIN ${gstin} is already on ${gst.outletName}`);
  if (lead) out.push(`${lead.outletName} with the same phone or GSTIN is already waiting for approval`);
  return out;
}

export async function proposeLead(ctx: Ctx, who: Who, input: LeadInput) {
  const outletName = text(input.outletName);
  const ownerName = text(input.ownerName);
  const phone = text(input.phone, 10).replace(/\D/g, "");
  const gstin = text(input.gstin, 15).toUpperCase() || null;
  const fssai = text(input.fssai, 14) || null;
  const shopNumber = text(input.shopNumber, 40);
  const complexName = text(input.complexName);
  const pinCode = text(input.pinCode, 6);
  if (!outletName) throw fail("Enter the shop name");
  if (!ownerName) throw fail("Enter the owner's name");
  if (!validMobile(phone)) throw fail("Enter a 10-digit mobile number");
  if (gstin && !validGstin(gstin)) throw fail("This GSTIN is not valid");
  if (fssai && !validFssai(fssai)) throw fail("FSSAI number must be 14 digits");
  if (!shopNumber || !complexName) throw fail("Enter the shop number and building / market");
  if (!/^\d{6}$/.test(pinCode)) throw fail("Enter the 6-digit PIN code");
  if (typeof input.areaId !== "string" || !(await ctx.tx.area.findUnique({ where: { id: input.areaId }, select: { id: true } }))) throw fail("Pick the area");
  const clashes = await leadClashes(ctx.tx, phone, gstin);
  if (clashes.length) throw fail(clashes[0], 409, { clashes });
  const agent = await ctx.tx.salesAgentProfile.findUnique({ where: { userId: who.userId }, select: { id: true } });
  return ctx.tx.storeLead.create({
    data: {
      outletName,
      ownerName,
      phone,
      gstin,
      fssai,
      shopNumber,
      complexName,
      pinCode,
      areaId: input.areaId,
      lat: num(input.lat),
      lng: num(input.lng),
      accuracy: num(input.accuracy) == null ? null : Math.round(num(input.accuracy)!),
      photoKey: input.photoKey ?? null,
      note: text(input.note, 500) || null,
      createdById: who.userId,
      salesAgentId: agent?.id ?? null,
    },
  });
}

/** Approve (creates the retailer account and shop) or reject a proposed shop. */
export async function decideLead(ctx: Ctx, deciderId: string, id: string, input: { approve: boolean; note?: string | null; salesAgentId?: string | null }, now = new Date()) {
  const lead = await ctx.tx.storeLead.findUnique({ where: { id } });
  if (!lead) throw fail("Proposal not found", 404);
  if (lead.status !== "PENDING") throw fail("This proposal was already decided", 409);
  if (!input.approve) {
    if (!input.note) throw fail("Say why the shop is refused");
    return ctx.tx.storeLead.update({ where: { id }, data: { status: "REJECTED", decidedById: deciderId, decidedAt: now, decisionNote: input.note } });
  }
  const clashes = (await leadClashes(ctx.tx, lead.phone, lead.gstin, lead.id)).filter((c) => !c.includes("waiting for approval"));
  if (clashes.length) throw fail(clashes[0], 409, { clashes });
  const salesAgentId = input.salesAgentId === undefined ? lead.salesAgentId : input.salesAgentId;
  if (salesAgentId && !(await ctx.tx.salesAgentProfile.findUnique({ where: { id: salesAgentId }, select: { id: true } }))) throw fail("Pick a sales agent");
  const user = await ctx.tx.user.create({
    data: {
      name: lead.ownerName,
      phone: lead.phone,
      role: "RETAILER",
      retailerProfile: {
        create: {
          outletName: lead.outletName,
          shopNumber: lead.shopNumber,
          complexName: lead.complexName,
          pinCode: lead.pinCode,
          areaId: lead.areaId,
          salesAgentId: salesAgentId ?? null,
          gstin: lead.gstin,
          stateCode: lead.gstin ? lead.gstin.slice(0, 2) : null,
          fssai: lead.fssai,
          lat: lead.lat,
          lng: lead.lng,
          photoKey: lead.photoKey,
        },
      },
    },
    include: { retailerProfile: true },
  });
  return ctx.tx.storeLead.update({
    where: { id },
    data: { status: "APPROVED", decidedById: deciderId, decidedAt: now, decisionNote: input.note ?? null, retailerId: user.retailerProfile!.id, salesAgentId: salesAgentId ?? null },
  });
}

// ───────────────────────────── targets and incentives ─────────────────────────────

export type TargetInput = {
  userId?: unknown;
  period?: unknown;
  metric?: unknown;
  goal?: unknown;
  productId?: unknown;
  brandId?: unknown;
  incentive?: unknown;
  minPct?: unknown;
  capPct?: unknown;
  note?: unknown;
};
const METRICS: TargetMetric[] = ["VALUE", "VOLUME", "NEW_OUTLETS", "COLLECTION"];
const posInt = (v: unknown) => (typeof v === "number" && Number.isInteger(v) && v >= 0 ? v : null);

/** Create or replace the target for a person, month and metric (and product / brand). */
export async function saveTarget(ctx: Ctx, input: TargetInput) {
  if (typeof input.userId !== "string") throw fail("Pick the person");
  const user = await ctx.tx.user.findUnique({ where: { id: input.userId }, select: { role: true, active: true } });
  if (!user || !isFieldRole(user.role)) throw fail("Targets are for field staff");
  if (!isMonth(input.period)) throw fail("Pick the month");
  if (typeof input.metric !== "string" || !METRICS.includes(input.metric as TargetMetric)) throw fail("Pick what is measured");
  const metric = input.metric as TargetMetric;
  const goal = posInt(input.goal);
  if (!goal) throw fail("The goal must be more than 0");
  const incentive = posInt(input.incentive ?? 0);
  const minPct = posInt(input.minPct ?? 80);
  const capPct = posInt(input.capPct ?? 120);
  if (incentive === null) throw fail("Incentive must be 0 or more");
  if (minPct === null || minPct > 100) throw fail("Pay from must be 0 to 100%");
  if (capPct === null || capPct < 100 || capPct > 1000) throw fail("Cap must be 100 to 1000%");
  const productId = metric === "VOLUME" && typeof input.productId === "string" && input.productId ? input.productId : null;
  const brandId = metric === "VOLUME" && !productId && typeof input.brandId === "string" && input.brandId ? input.brandId : null;
  if (productId && !(await ctx.tx.product.findUnique({ where: { id: productId }, select: { id: true } }))) throw fail("Product not found");
  if (brandId && !(await ctx.tx.brand.findUnique({ where: { id: brandId }, select: { id: true } }))) throw fail("Brand not found");
  const data = { goal, incentive, minPct, capPct, note: text(input.note, 200) || null };
  const existing = await ctx.tx.target.findFirst({ where: { userId: input.userId, period: input.period, metric, productId, brandId }, select: { id: true } });
  return existing
    ? ctx.tx.target.update({ where: { id: existing.id }, data })
    : ctx.tx.target.create({ data: { userId: input.userId, period: input.period, metric, productId, brandId, ...data } });
}

/** What each person achieved in a month, per metric (VOLUME for all products). */
export async function achievements(tx: Tx, userIds: string[], period: string) {
  const { from, to } = istMonthRange(period);
  const [orders, items, leads, pays] = await Promise.all([
    tx.order.groupBy({ by: ["placedById"], where: { placedById: { in: userIds }, createdAt: { gte: from, lt: to }, status: { not: "CANCELLED" } }, _sum: { totalAmount: true }, _count: true }),
    tx.orderItem.findMany({
      where: { order: { placedById: { in: userIds }, createdAt: { gte: from, lt: to }, status: { not: "CANCELLED" } } },
      select: { quantity: true, productId: true, product: { select: { brandId: true } }, order: { select: { placedById: true } } },
    }),
    tx.storeLead.groupBy({ by: ["createdById"], where: { createdById: { in: userIds }, status: "APPROVED", decidedAt: { gte: from, lt: to } }, _count: true }),
    tx.payment.groupBy({ by: ["collectedById"], where: { collectedById: { in: userIds }, collectedAt: { gte: from, lt: to }, state: { in: ["CONFIRMED", "PENDING_VERIFICATION"] } }, _sum: { amount: true } }),
  ]);
  return {
    value: new Map(orders.map((o) => [o.placedById!, o._sum.totalAmount ?? 0])),
    orders: new Map(orders.map((o) => [o.placedById!, o._count])),
    items,
    newOutlets: new Map(leads.map((l) => [l.createdById, l._count])),
    collection: new Map(pays.map((p) => [p.collectedById!, p._sum.amount ?? 0])),
  };
}

type Ach = Awaited<ReturnType<typeof achievements>>;

export function achievedFor(a: Ach, t: { userId: string; metric: TargetMetric; productId: string | null; brandId: string | null }): number {
  switch (t.metric) {
    case "VALUE":
      return a.value.get(t.userId) ?? 0;
    case "COLLECTION":
      return a.collection.get(t.userId) ?? 0;
    case "NEW_OUTLETS":
      return a.newOutlets.get(t.userId) ?? 0;
    case "VOLUME":
      return a.items
        .filter((i) => i.order.placedById === t.userId && (!t.productId || i.productId === t.productId) && (!t.brandId || i.product.brandId === t.brandId))
        .reduce((s, i) => s + i.quantity, 0);
  }
}

/** Targets in scope for a month with achievement, % and incentive earned. */
export async function targetProgress(tx: Tx, scope: string[] | null, period: string) {
  if (!isMonth(period)) throw fail("Pick the month");
  const targets = await tx.target.findMany({
    where: { period, ...(scope ? { userId: { in: scope } } : {}) },
    include: { user: { select: { name: true, role: true } } },
    orderBy: [{ user: { name: "asc" } }, { metric: "asc" }],
  });
  const ids = [...new Set(targets.map((t) => t.userId))];
  const a = await achievements(tx, ids, period);
  const names = await productBrandNames(tx, targets);
  return targets.map((t) => {
    const achieved = achievedFor(a, t);
    return { ...t, achieved, pct: pctOf(achieved, t.goal), earned: payout(t, achieved), itemName: t.productId ? names.get(t.productId) ?? null : t.brandId ? names.get(t.brandId) ?? null : null };
  });
}

async function productBrandNames(tx: Tx, targets: { productId: string | null; brandId: string | null }[]) {
  const pIds = targets.map((t) => t.productId).filter(Boolean) as string[];
  const bIds = targets.map((t) => t.brandId).filter(Boolean) as string[];
  const [ps, bs] = await Promise.all([
    pIds.length ? tx.product.findMany({ where: { id: { in: pIds } }, select: { id: true, name: true } }) : [],
    bIds.length ? tx.brand.findMany({ where: { id: { in: bIds } }, select: { id: true, name: true } }) : [],
  ]);
  return new Map([...ps, ...bs].map((x) => [x.id, x.name]));
}

/** Everyone in scope ranked on one metric for a month (with their target % when set). */
export async function leaderboard(tx: Tx, scope: string[] | null, period: string, metric: TargetMetric) {
  if (!isMonth(period)) throw fail("Pick the month");
  const members = (await fieldMembers(tx, scope)).filter((m) => metric === "NEW_OUTLETS" || m.role !== "SUPERVISOR");
  const a = await achievements(tx, members.map((m) => m.id), period);
  const targets = await tx.target.findMany({ where: { period, metric, productId: null, brandId: null, userId: { in: members.map((m) => m.id) } } });
  const goal = new Map(targets.map((t) => [t.userId, t.goal]));
  return members
    .map((m) => {
      const achieved = achievedFor(a, { userId: m.id, metric, productId: null, brandId: null });
      const g = goal.get(m.id) ?? null;
      return { userId: m.id, name: m.name, role: m.role, achieved, goal: g, pct: g ? pctOf(achieved, g) : null };
    })
    .sort((x, y) => y.achieved - x.achieved || x.name.localeCompare(y.name))
    .map((r, i) => ({ rank: i + 1, ...r }));
}

// ───────────────────────────── team day (supervisor view) ─────────────────────────────

/**
 * One day for everyone in scope: attendance, leave, last position, visits,
 * orders, collections, beat coverage, distance and exceptions.
 */
export async function teamDay(tx: Tx, tenantId: string, scope: string[] | null, date: string, now = new Date()) {
  if (!isDay(date)) throw fail("Pick a day");
  const s = await fieldSettingsOf(tx, tenantId);
  const members = await fieldMembers(tx, scope);
  const ids = members.map((m) => m.id);
  const { from, to } = istDayRange(date);
  const today = istDay(now);
  const [days, leave, pings, visits, orders, pays] = await Promise.all([
    tx.attendance.findMany({ where: { userId: { in: ids }, date } }),
    onLeave(tx, ids, date),
    tx.locationPing.findMany({ where: { userId: { in: ids }, at: { gte: from, lt: to } }, orderBy: { at: "asc" }, select: { userId: true, at: true, lat: true, lng: true, accuracy: true } }),
    tx.visit.findMany({ where: { salesAgent: { userId: { in: ids } }, checkInAt: { gte: from, lt: to } }, select: { salesAgent: { select: { userId: true } }, outcome: true, orderId: true, distanceM: true, checkOutAt: true } }),
    tx.order.groupBy({ by: ["placedById"], where: { placedById: { in: ids }, createdAt: { gte: from, lt: to }, status: { not: "CANCELLED" } }, _sum: { totalAmount: true }, _count: true }),
    tx.payment.groupBy({ by: ["collectedById"], where: { collectedById: { in: ids }, collectedAt: { gte: from, lt: to }, state: { in: ["CONFIRMED", "PENDING_VERIFICATION"] } }, _sum: { amount: true } }),
  ]);
  const dayOf = new Map(days.map((d) => [d.userId, d]));
  const orderOf = new Map(orders.map((o) => [o.placedById!, o]));
  const payOf = new Map(pays.map((p) => [p.collectedById!, p._sum.amount ?? 0]));
  const workStart = Number(s.workStart.slice(0, 2)) * 60 + Number(s.workStart.slice(3));
  const sunday = weekday(date) === 0;

  const rows = [];
  for (const m of members) {
    const att = dayOf.get(m.id) ?? null;
    const mine = pings.filter((p) => p.userId === m.id);
    const last = mine.at(-1) ?? null;
    const vs = visits.filter((v) => v.salesAgent.userId === m.id);
    const route = m.salesAgentProfile ? await dayRoute(tx, tenantId, m.salesAgentProfile.id, date) : null;
    const leaveToday = leave.has(m.id);
    const ended = date < today || !!att?.checkOutAt;
    const ex: ExceptionKind[] = [];
    if (!att?.checkInAt && !leaveToday && !sunday && (date < today || (date === today && istMinutes(now) > workStart + 60))) ex.push("absent");
    if (att?.late) ex.push("late");
    if (att?.checkInAt && !att.checkOutAt && date < today) ex.push("no_checkout");
    if (vs.some((v) => v.distanceM != null && v.distanceM > s.visitRadiusM)) ex.push("far_visit");
    if (s.trackLocation && att?.checkInAt) {
      const end = att.checkOutAt ?? (date === today ? now : to);
      if (longestGapMinutes(mine, att.checkInAt, end) > Math.max(30, s.pingMinutes * 4)) ex.push("ping_gap");
    }
    if (m.role === "SALES_AGENT" && att?.checkInAt && ended) {
      if (vs.length === 0) ex.push("no_visits");
      else if (route && route.planned > 0 && route.covered * 2 < route.planned) ex.push("low_coverage");
    }
    rows.push({
      userId: m.id,
      name: m.name,
      role: m.role,
      phone: m.phone,
      attendance: att && {
        checkInAt: att.checkInAt,
        checkOutAt: att.checkOutAt,
        late: att.late,
        minutes: att.minutes ?? (att.checkInAt && !att.checkOutAt && date === today ? Math.round((now.getTime() - att.checkInAt.getTime()) / 60_000) : null),
        checkInSelfie: att.checkInSelfie,
        checkOutSelfie: att.checkOutSelfie,
        checkInLat: att.checkInLat,
        checkInLng: att.checkInLng,
      },
      onLeave: leaveToday,
      lastPosition: last ? { lat: last.lat, lng: last.lng, at: last.at, accuracy: last.accuracy } : att?.checkInLat != null ? { lat: att.checkInLat, lng: att.checkInLng!, at: att.checkInAt!, accuracy: att.checkInAccuracy } : null,
      distanceM: att?.distanceM ?? pathMetres(mine),
      visits: vs.length,
      noOrder: vs.filter((v) => v.outcome === "NO_ORDER").length,
      orders: orderOf.get(m.id)?._count ?? 0,
      orderValue: orderOf.get(m.id)?._sum.totalAmount ?? 0,
      collected: payOf.get(m.id) ?? 0,
      beat: route?.beat ? { name: route.beat.name, planned: route.planned, covered: route.covered } : null,
      exceptions: ex,
    });
  }
  return { date, settings: { trackLocation: s.trackLocation, workStart: s.workStart, visitRadiusM: s.visitRadiusM }, members: rows };
}

// ───────────────────────────── reports ─────────────────────────────

export type ReportKind = "attendance" | "visits" | "stores" | "orders";

/** Rows for a date-wise report (CSV). Days are IST; at most 92 days. */
export async function reportRows(tx: Tx, scope: string[] | null, kind: ReportKind, fromDay: string, toDay: string): Promise<(string | number | null)[][]> {
  if (!isDay(fromDay) || !isDay(toDay) || toDay < fromDay) throw fail("Pick the dates");
  if (daysInclusive(fromDay, toDay) > 92) throw fail("Reports cover at most 92 days");
  const from = istDayRange(fromDay).from;
  const to = istDayRange(toDay).to;
  const userWhere = scope ? { in: scope } : undefined;
  const t = (d: Date | null | undefined) => (d ? new Date(d.getTime() + 330 * 60_000).toISOString().slice(11, 16) : "");
  if (kind === "attendance") {
    const rows = await tx.attendance.findMany({ where: { date: { gte: fromDay, lte: toDay }, ...(userWhere ? { userId: userWhere } : {}) }, include: { user: { select: { name: true, role: true } } }, orderBy: [{ date: "asc" }, { user: { name: "asc" } }] });
    return [
      ["Date", "Name", "Role", "Check in", "Check out", "Hours", "Late", "Distance (km)", "Check-in position"],
      ...rows.map((r) => [r.date, r.user.name, r.user.role, t(r.checkInAt), t(r.checkOutAt), r.minutes != null ? (r.minutes / 60).toFixed(2) : "", r.late ? "Yes" : "", r.distanceM != null ? (r.distanceM / 1000).toFixed(1) : "", r.checkInLat != null ? `${r.checkInLat.toFixed(5)},${r.checkInLng!.toFixed(5)}` : ""]),
    ];
  }
  if (kind === "visits") {
    const rows = await tx.visit.findMany({
      where: { checkInAt: { gte: from, lt: to }, ...(userWhere ? { salesAgent: { userId: userWhere } } : {}) },
      include: { salesAgent: { select: { user: { select: { name: true } } } }, retailer: { select: { outletName: true, area: { select: { name: true } } } }, order: { select: { orderNumber: true, totalAmount: true } } },
      orderBy: { checkInAt: "asc" },
    });
    return [
      ["Date", "Agent", "Shop", "Area", "In", "Out", "Outcome", "No-order reason", "Order", "Order value (Rs)", "Off beat", "Metres from shop", "Note"],
      ...rows.map((v) => [istDay(v.checkInAt), v.salesAgent.user.name, v.retailer.outletName, v.retailer.area.name, t(v.checkInAt), t(v.checkOutAt), v.outcome ?? (v.checkOutAt ? "" : "Open"), v.noOrderReason ?? "", v.order?.orderNumber ?? "", v.order ? (v.order.totalAmount / 100).toFixed(2) : "", v.offBeat ? "Yes" : "", v.distanceM ?? "", v.notes ?? ""]),
    ];
  }
  if (kind === "stores") {
    const rows = await tx.storeLead.findMany({ where: { createdAt: { gte: from, lt: to }, ...(userWhere ? { createdById: userWhere } : {}) }, include: { createdBy: { select: { name: true } }, area: { select: { name: true } } }, orderBy: { createdAt: "asc" } });
    return [
      ["Date", "Proposed by", "Shop", "Owner", "Phone", "Area", "PIN", "GSTIN", "FSSAI", "Status", "Decided", "Note"],
      ...rows.map((l) => [istDay(l.createdAt), l.createdBy.name, l.outletName, l.ownerName, l.phone, l.area.name, l.pinCode, l.gstin ?? "", l.fssai ?? "", l.status, l.decidedAt ? istDay(l.decidedAt) : "", l.decisionNote ?? ""]),
    ];
  }
  const rows = await tx.order.findMany({
    where: { createdAt: { gte: from, lt: to }, placedById: userWhere ?? { not: null } },
    select: { orderNumber: true, createdAt: true, status: true, totalAmount: true, placedById: true, retailer: { select: { outletName: true } } },
    orderBy: { createdAt: "asc" },
  });
  const names = new Map((await tx.user.findMany({ where: { id: { in: [...new Set(rows.map((r) => r.placedById!))] } }, select: { id: true, name: true, role: true } })).map((u) => [u.id, u]));
  return [
    ["Date", "Placed by", "Role", "Order", "Shop", "Status", "Value (Rs)"],
    ...rows.filter((r) => scope !== null || isFieldRole(names.get(r.placedById!)?.role)).map((o) => [istDay(o.createdAt), names.get(o.placedById!)?.name ?? "", names.get(o.placedById!)?.role ?? "", o.orderNumber, o.retailer.outletName, o.status, (o.totalAmount / 100).toFixed(2)]),
  ];
}

/** RFC 4180 CSV, with a BOM so Excel opens it as UTF-8. Cells starting with = + - @ are quoted with a ' to stop formula injection. */
export function toCsv(rows: (string | number | null)[][]): string {
  const cell = (v: string | number | null) => {
    let s = v == null ? "" : String(v);
    if (/^[=+\-@]/.test(s) && typeof v === "string") s = `'${s}`;
    return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return "﻿" + rows.map((r) => r.map(cell).join(",")).join("\r\n") + "\r\n";
}
