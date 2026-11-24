/**
 * Outstanding and collection reports against the real database: as-on dates,
 * part payments from the old book, oldest-first collections, salesman (bill's
 * own, else the shop's agent), area / beat / beat-day filters, and the PDF,
 * CSV and WhatsApp exports.
 *
 * Everything lives in a fresh area of the demo tenant, so the area filter
 * keeps other tests' data out.
 */
import "dotenv/config";
import { writeFile } from "node:fs/promises";
import path from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/prisma";
import { tenantDb } from "@/lib/db";
import { openingBills, recordPayment, withMoney } from "@/lib/ledger";
import { loadDues, parseDuesFilters } from "@/lib/dues-reports";
import { csvFor, renderSheetPdf, sheetFor, summaryText } from "@/lib/dues-export";

let T = "";
let adminId = "";
let adminName = "";
let areaId = "";
let agent = { userId: "", profileId: "", name: "" };
let shopA = "";
let shopB = "";
let beatId = "";
const run = Date.now().toString().slice(-6);
const d = (s: string) => new Date(`${s}T06:00:00Z`);
const q = (o: Record<string, string>) => new URLSearchParams({ areaId, ...o });

async function shop(name: string, salesAgentId: string | null) {
  const u = await tenantDb(T).user.create({
    data: {
      name,
      phone: null,
      role: "RETAILER",
      retailerProfile: { create: { outletName: name, shopNumber: "12", complexName: "Station Road", pinCode: "221001", areaId, salesAgentId, paymentMode: "POSTPAID", creditDays: 7, contactName: "Nazia", altPhone: "0547222222" } },
    },
    include: { retailerProfile: true },
  });
  return u.retailerProfile!.id;
}

beforeAll(async () => {
  T = (await prisma.tenant.findUniqueOrThrow({ where: { slug: "demo" } })).id;
  const db = tenantDb(T);
  const admin = await db.user.findFirstOrThrow({ where: { role: "ADMIN" } });
  adminId = admin.id;
  adminName = admin.name;
  const region = (await db.area.findFirstOrThrow()).regionId;
  areaId = (await db.area.create({ data: { name: `Dues test ${run}`, regionId: region } })).id;
  const u = await db.user.create({ data: { name: `AAA Dues agent ${run}`, phone: null, role: "SALES_AGENT", salesAgentProfile: { create: {} } }, include: { salesAgentProfile: true } });
  agent = { userId: u.id, profileId: u.salesAgentProfile!.id, name: u.name };

  shopA = await shop(`Dues shop A ${run}`, agent.profileId);
  shopB = await shop(`Dues shop B ${run}`, null);
  beatId = (await db.beat.create({ data: { name: `Dues beat ${run}`, salesAgentId: agent.profileId, areaId, weekdays: [1], active: true } })).id;
  await db.beatRetailer.create({ data: { beatId, retailerId: shopA } });

  // A: two bills from the old book (the first part paid there), then cash and UPI.
  await withMoney(T, adminId, (ctx) =>
    openingBills(ctx, shopA, [
      { number: `DA${run}1`, date: d("2026-11-01"), dueDate: null, amount: 100000, paid: 40000, salesmanId: null },
      { number: `DA${run}2`, date: d("2026-11-10"), dueDate: null, amount: 50000, paid: 0, salesmanId: null },
    ])
  );
  await withMoney(T, adminId, (ctx) => recordPayment(ctx, { retailerId: shopA, amount: 30000, method: "CASH", occurredAt: d("2026-11-20"), collectorId: agent.userId }));
  await withMoney(T, adminId, (ctx) => recordPayment(ctx, { retailerId: shopA, amount: 60000, method: "UPI", reference: `UTRDUES${run}`, occurredAt: d("2026-11-22"), atOffice: true }));
  // B: one bill whose salesman is named on the bill (no agent on the shop).
  await withMoney(T, adminId, (ctx) => openingBills(ctx, shopB, [{ number: `DB${run}1`, date: d("2026-11-05"), dueDate: null, amount: 20000, paid: 0, salesmanId: adminId }]));
});

describe("outstanding as on a day", () => {
  it("counts only bills dated by then and money received by then", async () => {
    const early = await loadDues(T, "bills", q({ asOn: "2026-11-05" }));
    if (early.view !== "bills") throw new Error("view");
    expect(early.bills.map((b) => [b.number, b.received, b.balance, b.age, b.overdueDays])).toEqual([
      [`DA${run}1`, 40000, 60000, 4, 0],
      [`DB${run}1`, 0, 20000, 0, 0],
    ]);

    const mid = await loadDues(T, "bills", q({ asOn: "2026-11-21" }));
    if (mid.view !== "bills") throw new Error("view");
    expect(mid.bills.map((b) => [b.number, b.received, b.balance, b.overdueDays])).toEqual([
      [`DA${run}1`, 70000, 30000, 13],
      [`DB${run}1`, 0, 20000, 9],
      [`DA${run}2`, 0, 50000, 4],
    ]);
    expect(mid.totals).toEqual({ amount: 170000, received: 70000, balance: 100000 });
    expect(mid.shops).toBe(2);
    // The old book's part payment and the cash on the 20th, oldest first.
    expect(mid.bills[0].collections.map((c) => [c.method, c.amount])).toEqual([
      ["EARLIER", 40000],
      ["CASH", 30000],
    ]);

    // After the UPI on the 22nd: the first bill is paid off, the second part paid.
    const late = await loadDues(T, "bills", q({ asOn: "2026-11-23" }));
    if (late.view !== "bills") throw new Error("view");
    expect(late.bills.map((b) => [b.number, b.received, b.balance])).toEqual([
      [`DB${run}1`, 0, 20000],
      [`DA${run}2`, 30000, 20000],
    ]);
  });

  it("names the bill's salesman, else the shop's agent, and filters by salesman", async () => {
    const r = await loadDues(T, "agents", q({ asOn: "2026-11-21" }));
    if (r.view !== "agents") throw new Error("view");
    const blocks = Object.fromEntries(r.agents.map((a) => [a.salesman?.id ?? "", a.parties.flatMap((p) => p.bills.map((b) => b.number))]));
    expect(blocks).toEqual({ [agent.userId]: [`DA${run}1`, `DA${run}2`], [adminId]: [`DB${run}1`] });
    expect(r.agents.find((a) => a.salesman?.id === adminId)!.salesman!.name).toBe(adminName);

    const only = await loadDues(T, "bills", q({ asOn: "2026-11-21", salesmanId: adminId }));
    if (only.view !== "bills") throw new Error("view");
    expect(only.bills.map((b) => b.number)).toEqual([`DB${run}1`]);
  });

  it("party-wise shows contact details and the last receipt as on the day", async () => {
    const r = await loadDues(T, "parties", q({ asOn: "2026-11-21" }));
    if (r.view !== "parties") throw new Error("view");
    const a = r.parties.find((p) => p.shop.id === shopA)!;
    expect(a.shop).toMatchObject({ contactName: "Nazia", altPhone: "0547222222", address: "12, Station Road" });
    expect(a.lastReceipt).toMatchObject({ amount: 30000, method: "CASH", daysAgo: 1 });
    expect(a.totals.balance).toBe(80000);
    expect(r.parties.find((p) => p.shop.id === shopB)!.lastReceipt).toBeNull();
  });

  it("filters by beat and by beat day", async () => {
    const byBeat = await loadDues(T, "bills", q({ asOn: "2026-11-21", beatId }));
    const monday = await loadDues(T, "bills", q({ asOn: "2026-11-21", weekday: "1" }));
    const tuesday = await loadDues(T, "bills", q({ asOn: "2026-11-21", weekday: "2" }));
    const shops = (x: typeof byBeat) => (x.view === "bills" ? [...new Set(x.bills.map((b) => b.shop.id))] : []);
    expect(shops(byBeat)).toEqual([shopA]);
    expect(shops(monday)).toEqual([shopA]);
    expect(shops(tuesday)).toEqual([]);
  });

  it("never looks past today and refuses a bad date", () => {
    expect(parseDuesFilters(new URLSearchParams({ asOn: "2999-01-01" }), d("2026-11-24")).asOn).toBe("2026-11-24");
    expect(() => parseDuesFilters(new URLSearchParams({ asOn: "24-11-2026" }))).toThrow(/Pick the date/);
    expect(parseDuesFilters(new URLSearchParams({ weekday: "9", areaId: "x';--" })).weekday).toBeUndefined();
  });
});

describe("collection summary", () => {
  it("adds up each party's receipts by method for the days asked", async () => {
    const r = await loadDues(T, "collections", q({ from: "2026-11-20", to: "2026-11-22" }));
    if (r.view !== "collections") throw new Error("view");
    expect(r.rows).toHaveLength(1);
    expect(r.rows[0]).toMatchObject({ count: 2, total: 90000, byMethod: { CASH: 30000, UPI: 60000, CHEQUE: 0, BANK: 0, ONLINE: 0 } });
    expect(r.rows[0].collectors).toContain(agent.name);
    const none = await loadDues(T, "collections", q({ from: "2026-11-21", to: "2026-11-21" }));
    expect(none.view === "collections" && none.rows).toEqual([]);
  });
});

describe("exports", () => {
  it("prints every view as an A4 PDF, a CSV and a WhatsApp summary", async () => {
    for (const view of ["bills", "parties", "agents", "collections"] as const) {
      const r = await loadDues(T, view, q(view === "collections" ? { from: "2026-11-20", to: "2026-11-22" } : { asOn: "2026-11-21" }));
      const pdf = await renderSheetPdf(sheetFor(r, "Area: test"), { name: "Shree Traders", address: "Station Road", gstin: null });
      expect(Buffer.from(pdf.slice(0, 5)).toString()).toBe("%PDF-");
      // DUES_PDF_OUT=<folder> keeps the PDFs to look at.
      if (process.env.DUES_PDF_OUT) await writeFile(path.join(process.env.DUES_PDF_OUT, `${view}.pdf`), pdf);
      const csv = csvFor(r);
      expect(csv.length).toBe(view === "collections" ? 2 : 4);
      expect(summaryText(r, "Shree Traders", "")).toMatch(view === "collections" ? /Collected ₹900\.00 from 1 party \(/ : /Outstanding ₹1,000\.00 on 3 bills/);
    }
  });
});
