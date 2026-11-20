/**
 * Phase 6 demo: a field supervisor with a team of three (two sales agents and
 * the driver), more shops with map pins, weekday beats and a couple of dated
 * plans, 14 days of attendance with positions every 5 minutes, visits with
 * order / no-order outcomes, leave (one approved, one waiting), shops added
 * from the field (waiting, one with a duplicate phone, approved, rejected)
 * and this month's targets. Names, phones and numbers are made up.
 */
import type { Db } from "./seed";
import { hashPassword } from "../src/lib/password";
import { addDay, istDay, istDayRange, istMonth, istMonthRange, pathMetres, weekday, type Ping } from "../src/lib/field-math";

type Ids = { salesUserId: string; salesAgentId: string; deliveryUserId: string; adminId: string; areas: string[]; shops: string[]; patelOrderId: string };

// Small deterministic random, so every reseed gives the same demo.
let seed = 42;
const rnd = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648);
const pick = <T>(xs: readonly T[]) => xs[Math.floor(rnd() * xs.length)];
const at = (day: string, minutesIst: number) => new Date(istDayRange(day).from.getTime() + minutesIst * 60_000);

type Pt = { lat: number; lng: number };
const DEPOT: Pt = { lat: 19.0728, lng: 72.8826 };

/** Positions every 5 minutes from start to end, walking through the waypoints. */
function walk(points: Pt[], start: Date, end: Date): Ping[] {
  const out: Ping[] = [];
  const steps = Math.max(1, Math.floor((end.getTime() - start.getTime()) / 300_000));
  for (let i = 0; i <= steps; i++) {
    const f = (i / steps) * (points.length - 1);
    const k = Math.min(points.length - 2, Math.floor(f));
    const t = f - k;
    const a = points[k];
    const b = points[k + 1];
    out.push({
      at: new Date(start.getTime() + i * 300_000),
      lat: a.lat + (b.lat - a.lat) * t + (rnd() - 0.5) * 0.0002,
      lng: a.lng + (b.lng - a.lng) * t + (rnd() - 0.5) * 0.0002,
      accuracy: Math.round(8 + rnd() * 22),
    });
  }
  return out;
}

const REASONS = ["stock_enough", "owner_away", "dues_pending", "next_visit", "price", "shop_closed"] as const;

export async function seedField(db: Db, ids: Ids) {
  const [andheri, bandra, dadar] = ids.areas;
  const pw = hashPassword("123456789");

  const supervisor = await db.user.create({ data: { name: "Field Supervisor", loginId: "supervisor", phone: "9000000001", passwordHash: pw, role: "SUPERVISOR" } });
  const ravi = await db.user.create({
    data: { name: "Ravi Sales", loginId: "ravi", phone: "9000000003", passwordHash: pw, role: "SALES_AGENT", supervisorId: supervisor.id, salesAgentProfile: { create: {} } },
    include: { salesAgentProfile: true },
  });
  await db.user.update({ where: { id: ids.salesUserId }, data: { phone: "9000000002", supervisorId: supervisor.id } });
  await db.user.update({ where: { id: ids.deliveryUserId }, data: { phone: "9000000004", supervisorId: supervisor.id } });
  // Sai Super Mart gets its map pin now (it had none for the delivery demo).
  await db.retailerProfile.update({ where: { id: ids.shops[2] }, data: { lat: 19.0178, lng: 72.8478 } });

  const shop = async (outletName: string, phone: string, areaId: string, pinCode: string, lat: number, lng: number, salesAgentId: string) =>
    (
      await db.user.create({
        data: {
          name: outletName,
          phone,
          role: "RETAILER",
          retailerProfile: { create: { outletName, shopNumber: String(1 + Math.floor(rnd() * 40)), complexName: "Main Road", pinCode, areaId, lat, lng, salesAgentId } },
        },
        include: { retailerProfile: true },
      })
    ).retailerProfile!.id;

  const mehta = await shop("Mehta Provision", "9820000001", andheri, "400058", 19.1172, 72.8512, ids.salesAgentId);
  const gupta = await shop("Gupta Kirana", "9820000002", andheri, "400053", 19.121, 72.842, ids.salesAgentId);
  const fernandes = await shop("Fernandes Store", "9820000003", bandra, "400050", 19.059, 72.836, ids.salesAgentId);
  const joshi = await shop("Joshi Traders", "9820000004", dadar, "400014", 19.02, 72.844, ids.salesAgentId);
  const kale = await shop("Kale General", "9820000005", dadar, "400028", 19.0165, 72.842, ids.salesAgentId);
  const shah = await shop("Shah Mart", "9820000006", andheri, "400069", 19.115, 72.855, ravi.salesAgentProfile!.id);
  const desai = await shop("Desai Stores", "9820000007", bandra, "400050", 19.061, 72.83, ravi.salesAgentProfile!.id);
  const [agarwal, patel, sai] = ids.shops;

  const pins = new Map<string, Pt>(
    (await db.retailerProfile.findMany({ select: { id: true, lat: true, lng: true } })).filter((r) => r.lat != null).map((r) => [r.id, { lat: r.lat!, lng: r.lng! }])
  );

  const beat = async (name: string, salesAgentId: string, areaId: string, weekdays: number[], shops: string[]) =>
    db.beat.create({ data: { name, salesAgentId, areaId, weekdays, shops: { create: shops.map((retailerId, seq) => ({ retailerId, seq })) } } });
  const beatA = await beat("Andheri West", ids.salesAgentId, andheri, [1, 3, 5], [agarwal, mehta, gupta]);
  const beatB = await beat("Bandra to Dadar", ids.salesAgentId, bandra, [2, 4, 6], [patel, fernandes, sai, joshi, kale]);
  const beatR = await beat("Andheri East and Bandra", ravi.salesAgentProfile!.id, andheri, [1, 2, 3, 4, 5, 6], [shah, desai]);
  const routeOf = (agentId: string, wd: number) =>
    agentId === ravi.salesAgentProfile!.id ? [shah, desai] : [1, 3, 5].includes(wd) ? [agarwal, mehta, gupta] : wd === 0 ? [] : [patel, fernandes, sai, joshi, kale];

  const now = new Date();
  const today = istDay(now);
  const nowMin = Math.floor((now.getTime() - istDayRange(today).from.getTime()) / 60_000);
  const deliveryLeaveDay = weekday(addDay(today, -4)) === 0 ? addDay(today, -5) : addDay(today, -4);

  await db.leaveRequest.create({
    data: { userId: ids.deliveryUserId, fromDate: deliveryLeaveDay, toDate: deliveryLeaveDay, days: 1, type: "sick", reason: "Fever", status: "APPROVED", decidedById: supervisor.id, decidedAt: at(addDay(deliveryLeaveDay, -1), 600) },
  });
  await db.leaveRequest.create({ data: { userId: ravi.id, fromDate: addDay(today, 7), toDate: addDay(today, 8), days: 2, type: "casual", reason: "Family function" } });

  const people = [
    { userId: ids.salesUserId, agentId: ids.salesAgentId as string | null, track: true },
    { userId: ravi.id, agentId: ravi.salesAgentProfile!.id as string | null, track: true },
    { userId: ids.deliveryUserId, agentId: null, track: true },
    { userId: supervisor.id, agentId: null, track: true },
  ];
  // They "joined" on the first seeded day, so the calendar marks no absences before it.
  await db.user.updateMany({ where: { id: { in: people.map((p) => p.userId) } }, data: { createdAt: at(addDay(today, -13), 8 * 60) } });

  for (let back = 13; back >= 0; back--) {
    const day = addDay(today, -back);
    const wd = weekday(day);
    if (wd === 0) continue;
    for (const p of people) {
      const isToday = day === today;
      if (p.userId === ids.deliveryUserId && day === deliveryLeaveDay) continue;
      if (isToday && p.userId === ravi.id) continue; // not checked in today: shows as an exception
      const inMin = 9 * 60 + Math.floor(rnd() * 50); // 09:00–09:50 IST, after 09:30 is late
      if (isToday && nowMin < inMin + 30) continue;
      const outMin = isToday ? null : 18 * 60 + Math.floor(rnd() * 60);
      const checkInAt = at(day, inMin);
      const end = outMin === null ? new Date(now.getTime() - 60_000) : at(day, outMin);
      const route = p.agentId ? routeOf(p.agentId, wd) : [];
      const waypoints = [DEPOT, ...route.map((r) => pins.get(r)!).filter(Boolean), DEPOT];
      if (p.userId === ids.deliveryUserId) waypoints.splice(1, 0, { lat: 19.0544, lng: 72.8402 }, { lat: 19.1197, lng: 72.8468 });
      if (p.userId === supervisor.id) waypoints.splice(1, 0, { lat: 19.0598, lng: 72.8365 }, { lat: 19.0215, lng: 72.8432 });
      // Today the walk follows the whole day's plan, cut at "now", so people are mid-route.
      let pings = p.track ? walk(waypoints, checkInAt, isToday ? at(day, 18 * 60 + 30) : end).filter((x) => x.at <= end) : [];
      if (p.userId === ids.deliveryUserId && back === 2) pings = pings.filter((x) => x.at.getTime() < checkInAt.getTime() + 3 * 3_600_000 || x.at.getTime() > checkInAt.getTime() + 5 * 3_600_000); // phone off for 2 hours
      if (pings.length) await db.locationPing.createMany({ data: pings.map((x) => ({ userId: p.userId, at: x.at, lat: x.lat, lng: x.lng, accuracy: x.accuracy, battery: Math.max(15, 100 - Math.round(((x.at.getTime() - checkInAt.getTime()) / 3_600_000) * 7)), source: "app" })) });
      // A driver is tracked only while the duty switch is on: their duty shift matches the day.
      if (p.userId === ids.deliveryUserId)
        await db.dutyShift.create({ data: { userId: p.userId, startAt: checkInAt, startLat: DEPOT.lat, startLng: DEPOT.lng, ...(outMin === null ? {} : { endAt: end, endLat: DEPOT.lat, endLng: DEPOT.lng }) } });
      await db.attendance.create({
        data: {
          userId: p.userId,
          date: day,
          checkInAt,
          checkInLat: DEPOT.lat + (rnd() - 0.5) * 0.001,
          checkInLng: DEPOT.lng + (rnd() - 0.5) * 0.001,
          checkInAccuracy: 12,
          late: inMin > 9 * 60 + 30,
          ...(outMin === null
            ? {}
            : { checkOutAt: end, checkOutLat: DEPOT.lat, checkOutLng: DEPOT.lng, checkOutAccuracy: 15, minutes: outMin - inMin, distanceM: pathMetres(pings) }),
        },
      });

      // Visits along the route: one shop is skipped now and then; today only the first two so far.
      if (p.agentId) {
        const span = (outMin ?? nowMin) - inMin;
        const stops = isToday ? route.slice(0, Math.max(0, Math.min(2, Math.floor(span / 90)))) : route;
        for (let i = 0; i < stops.length; i++) {
          if (!isToday && rnd() < 0.15) continue;
          const vin = inMin + Math.round(((i + 1) / (route.length + 1)) * span);
          const pin = pins.get(stops[i]);
          const far = rnd() < 0.06;
          // Only real orders make an ORDER visit: today's Patel Kirana visit carries Patel's open order;
          // other demo visits end with a no-order reason.
          const orderId = isToday && stops[i] === patel ? ids.patelOrderId : null;
          const ordered = !!orderId;
          await db.visit.create({
            data: {
              salesAgentId: p.agentId,
              retailerId: stops[i],
              checkInAt: at(day, vin),
              checkOutAt: at(day, vin + 8 + Math.floor(rnd() * 15)),
              checkInLat: pin ? pin.lat + (far ? 0.004 : 0.0002) : null,
              checkInLng: pin ? pin.lng : null,
              checkInAccuracy: 15,
              distanceM: pin ? (far ? 440 : Math.round(5 + rnd() * 40)) : null,
              outcome: ordered ? "ORDER" : "NO_ORDER",
              noOrderReason: ordered ? null : pick(REASONS),
              orderId,
              notes: null,
            },
          });
        }
      }
    }
  }

  // Dated plans: tomorrow the other beat; the day after, training (no beat).
  const tomorrow = weekday(addDay(today, 1)) === 0 ? addDay(today, 2) : addDay(today, 1);
  await db.beatPlan.create({ data: { salesAgentId: ids.salesAgentId, date: tomorrow, beatId: [1, 3, 5].includes(weekday(tomorrow)) ? beatB.id : beatA.id, note: "Swap: festival stock push", createdById: supervisor.id } });
  await db.beatPlan.create({ data: { salesAgentId: ids.salesAgentId, date: addDay(tomorrow, 1), beatId: null, note: "Training at the office", createdById: supervisor.id } });
  void beatR;

  // Shops added from the field.
  const month = istMonth(now);
  const monthStart = istMonthRange(month).from;
  const decided = new Date(Math.max(monthStart.getTime() + 3_600_000, now.getTime() - 2 * 86_400_000));
  await db.storeLead.create({
    data: { outletName: "Kale General", ownerName: "Suresh Kale", phone: "9820000005", fssai: "11521999000123", shopNumber: "7", complexName: "Main Road", pinCode: "400028", areaId: dadar, lat: 19.0165, lng: 72.842, accuracy: 12, status: "APPROVED", createdById: ids.salesUserId, salesAgentId: ids.salesAgentId, decidedById: ids.adminId, decidedAt: decided, retailerId: kale, createdAt: new Date(decided.getTime() - 3_600_000) },
  });
  await db.storeLead.create({
    data: { outletName: "Om Sai Kirana", ownerName: "Prakash Yadav", phone: "9820000101", fssai: "11521999000456", shopNumber: "B-3", complexName: "Nehru Nagar Market", pinCode: "400024", areaId: dadar, lat: 19.0232, lng: 72.8501, accuracy: 9, note: "Wants weekly delivery", createdById: ids.salesUserId, salesAgentId: ids.salesAgentId },
  });
  await db.storeLead.create({
    data: { outletName: "New Bharat Stores", ownerName: "Imran Shaikh", phone: "9123456780", shopNumber: "22", complexName: "Hill Road", pinCode: "400050", areaId: bandra, lat: 19.0551, lng: 72.8399, accuracy: 20, note: "Owner says it is a new branch", createdById: ravi.id, salesAgentId: ravi.salesAgentProfile!.id },
  });
  await db.storeLead.create({
    data: { outletName: "Corner Pan Shop", ownerName: "Dilip More", phone: "9820000102", shopNumber: "1", complexName: "Station Road", pinCode: "400014", areaId: dadar, status: "REJECTED", createdById: ravi.id, decidedById: supervisor.id, decidedAt: decided, decisionNote: "Too small for our range", createdAt: new Date(decided.getTime() - 5 * 3_600_000) },
  });

  // This month's targets (incentives in paise).
  const sunrise = await db.brand.findFirst({ where: { name: "Sunrise" }, select: { id: true } });
  await db.target.createMany({
    data: [
      { userId: ids.salesUserId, period: month, metric: "VALUE", goal: 5_000_000, incentive: 200_000, note: "₹50,000 of orders" },
      { userId: ids.salesUserId, period: month, metric: "VOLUME", goal: 200, brandId: sunrise?.id ?? null, incentive: 50_000, note: "Sunrise packs" },
      { userId: ids.salesUserId, period: month, metric: "NEW_OUTLETS", goal: 5, incentive: 100_000 },
      { userId: ids.salesUserId, period: month, metric: "COLLECTION", goal: 3_000_000, incentive: 100_000 },
      { userId: ravi.id, period: month, metric: "VALUE", goal: 4_000_000, incentive: 150_000 },
      { userId: ravi.id, period: month, metric: "NEW_OUTLETS", goal: 3, incentive: 60_000 },
      { userId: ids.deliveryUserId, period: month, metric: "COLLECTION", goal: 2_500_000, incentive: 80_000, minPct: 90 },
    ],
  });
}
