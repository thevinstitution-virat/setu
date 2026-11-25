/**
 * Claims on companies (A4) against the real database: raising (Dr claims
 * receivable, Cr claims income), settling by the company's credit note, by
 * money into a bank, writing off the rest (written off / rejected), undoing,
 * cancelling, the claim basis from our own records (schemes on invoices,
 * damaged stock, stock on the day of a rate cut), the reports, the letter and
 * the books check.
 *
 * Runs in the demo tenant with a fresh company and products; they are hidden after.
 */
import "dotenv/config";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/prisma";
import { tenantDb } from "@/lib/db";
import { balanceOf, MoneyError, withMoney, type Ctx } from "@/lib/ledger";
import { checkBooks, createBank, ensureBooks, todayIst } from "@/lib/books";
import { cancelPurchase, recordPurchase } from "@/lib/purchases";
import {
  cancelClaim,
  claimBasis,
  claimDetail,
  claimsByType,
  claimsList,
  openClaimsFor,
  pendingClaims,
  raiseClaim,
  receiveOnClaim,
  reverseSettlement,
  settlementsIn,
  writeOffClaim,
  type ClaimInput,
} from "@/lib/claims";
import { claimStatus } from "@/lib/claim-labels";
import { byTypeSheet, claimsSummary, letterCsv, letterSheet, pendingCsv, pendingSheet, settledSheet } from "@/lib/claims-export";
import { adjustStock, damageStock, defaultWarehouse } from "@/lib/stock";
import { renderSheetPdf } from "@/lib/dues-export";
import { can } from "@/lib/permissions";

let T = "";
let adminId = "";
let originalSettings: unknown = null;
let bank2 = "";
const run = Date.now().toString().slice(-6);
const today = todayIst();
const daysAgo = (n: number) => new Date(Date.now() - n * 86_400_000 + 5.5 * 3_600_000).toISOString().slice(0, 10);
const as = <R>(fn: (ctx: Ctx) => Promise<R>) => withMoney(T, adminId, fn);
const code = async (p: Promise<unknown>) =>
  p.then(
    () => 0,
    (e) => (e instanceof MoneyError ? e.status : -1),
  );
const ids = { co: "", other: "", service: "", cat: "", p1: "", p2: "", retailer: "" };
const due = async (supplierId: string) => as((ctx) => balanceOf(ctx, { type: "CLAIMS_RECEIVABLE", supplierId }));
const income = async () => as((ctx) => balanceOf(ctx, { type: "CLAIM_INCOME" }));
const owed = async (supplierId: string) => -(await as((ctx) => balanceOf(ctx, { type: "PAYABLE", supplierId })));
const raise = (over: Partial<ClaimInput> = {}) =>
  as((ctx) =>
    raiseClaim(ctx, { supplierId: ids.co, type: "SCHEME", date: today, periodFrom: daysAgo(30), periodTo: daysAgo(1), lines: [{ description: "Diwali scheme", quantity: 10, rate: 10_000 }], ...over }),
  );
const fresh = (id: string) => tenantDb(T).claim.findUniqueOrThrow({ where: { id } });
const creditNote = (claimId: string | null, amount: number, supplierId = ids.co) =>
  as((ctx) =>
    recordPurchase(ctx, {
      type: "CREDIT_NOTE",
      supplierId,
      supplierRef: `CN-${run}-${Math.random().toString(36).slice(2, 7)}`,
      date: today,
      lines: [{ target: "CLAIM", claimId, description: "Against claim", quantity: 1, rate: amount, gstRate: 0 }],
    }),
  );

beforeAll(async () => {
  const demo = await prisma.tenant.findUniqueOrThrow({ where: { slug: "demo" }, select: { id: true, settings: true, stateCode: true } });
  T = demo.id;
  originalSettings = demo.settings;
  const db = tenantDb(T);
  adminId = (await db.user.findFirstOrThrow({ where: { role: "ADMIN" } })).id;
  await prisma.tenant.update({ where: { id: T }, data: { booksLockedUntil: null } });
  await as((ctx) => ensureBooks(ctx));
  bank2 = (await as((ctx) => createBank(ctx, { name: `Test claims bank ${run}` }))).id;
  const st = demo.stateCode ?? "27";
  ids.co = (await db.supplier.create({ data: { name: `Test claim company ${run}`, stateCode: st } })).id;
  ids.other = (await db.supplier.create({ data: { name: `Test claim other ${run}`, stateCode: st } })).id;
  ids.service = (await db.supplier.create({ data: { name: `Test claim transporter ${run}`, kind: "SERVICES", stateCode: st } })).id;
  ids.cat = (await db.category.create({ data: { name: `Claims cat ${run}` } })).id;
  const mk = (sku: string, lastCost: number | null) =>
    db.product.create({ data: { name: `Test claim ${sku} ${run}`, sku: `CLM-${sku}-${run}`, categoryId: ids.cat, unit: "pc", price: 15000, mrp: 20000, gstRate: 0, supplierId: ids.co, lastCost } });
  ids.p1 = (await mk("A", 8_000)).id;
  ids.p2 = (await mk("B", null)).id;
  ids.retailer = (await db.retailerProfile.findFirstOrThrow({ select: { id: true } })).id;
  const s = (demo.settings ?? {}) as Record<string, unknown>;
  await prisma.tenant.update({ where: { id: T }, data: { settings: { ...s, inventory: { ...((s.inventory as object) ?? {}), enabled: true } } as object } });
});

afterAll(async () => {
  await prisma.tenant.update({ where: { id: T }, data: { settings: originalSettings as object, booksLockedUntil: null } });
  const db = tenantDb(T);
  await db.supplier.updateMany({ where: { id: { in: [ids.co, ids.other, ids.service] } }, data: { active: false } });
  await db.product.updateMany({ where: { id: { in: [ids.p1, ids.p2] } }, data: { active: false } });
  await db.bankAccount.updateMany({ where: { id: bank2 }, data: { active: false } });
});

describe("raising a claim", () => {
  it("lets the accountant manage claims, not the sales agent", () => {
    expect(can("ACCOUNTANT", "claims.manage")).toBe(true);
    expect(can("SALES_AGENT", "claims.manage")).toBe(false);
  });

  it("works out the status from what came in and what was given up", () => {
    expect(claimStatus(100, 0, 0)).toBe("RAISED");
    expect(claimStatus(100, 40, 0)).toBe("PART_SETTLED");
    expect(claimStatus(100, 100, 0)).toBe("SETTLED");
    expect(claimStatus(100, 0, 100)).toBe("REJECTED");
    expect(claimStatus(100, 60, 40)).toBe("WRITTEN_OFF");
    expect(claimStatus(100, 30, 30)).toBe("PART_SETTLED");
  });

  it("posts Dr claims receivable, Cr claims income, numbered CL<fy>", async () => {
    const due0 = await due(ids.co);
    const inc0 = await income();
    const c = await raise({
      lines: [
        { description: "Free goods", quantity: 12, rate: 8_000 },
        { productId: ids.p1, description: "", quantity: 1, rate: 4_000, evidence: "INV-1, INV-2" },
      ],
    });
    expect(c.number).toMatch(/^CL\d{4}-\d{5}$/);
    expect(c.amount).toBe(100_000);
    expect(c.status).toBe("RAISED");
    expect((await due(ids.co)) - due0).toBe(100_000);
    expect((await income()) - inc0).toBe(-100_000);
    const d = await as((ctx) => claimDetail(ctx, c.id));
    expect(d.lines.map((l) => l.description)).toEqual(["Free goods", `Test claim A ${run}`]);
    expect(d.lines[1].evidence).toBe("INV-1, INV-2");
    expect(d.open).toBe(100_000);
  });

  it("refuses a service supplier, a future date, a rate cut with no day, and empty lines", async () => {
    expect(await code(raise({ supplierId: ids.service }))).toBe(400);
    expect(await code(raise({ date: "2999-01-01" }))).toBe(400);
    expect(await code(raise({ type: "RATE_DIFF", periodFrom: null }))).toBe(400);
    expect(await code(raise({ lines: [] }))).toBe(400);
    expect(await code(raise({ lines: [{ description: "x", quantity: 0, rate: 100 }] }))).toBe(400);
    expect(await code(raise({ periodFrom: daysAgo(1), periodTo: daysAgo(3) }))).toBe(400);
  });
});

describe("settling a claim", () => {
  it("part-settles by the company's credit note: Dr supplier, Cr claims receivable", async () => {
    const c = await raise({ lines: [{ description: "Damages", quantity: 1, rate: 50_000 }] });
    const due0 = await due(ids.co);
    const owed0 = await owed(ids.co);
    const inc0 = await income();
    const note = await creditNote(c.id, 20_000);
    expect(await due(ids.co)).toBe(due0 - 20_000);
    expect(await owed(ids.co)).toBe(owed0 - 20_000);
    expect(await income()).toBe(inc0); // claim income was booked when raised
    const f = await fresh(c.id);
    expect(f).toMatchObject({ settled: 20_000, writtenOff: 0, status: "PART_SETTLED" });
    expect(note.lines[0].claimId).toBe(c.id);
    // More than is open, or someone else's claim, is refused.
    expect(await code(creditNote(c.id, 30_001))).toBe(400);
    expect(await code(creditNote(c.id, 1_000, ids.other))).toBe(400);
    // Open claims list for the credit note form.
    expect((await as((ctx) => openClaimsFor(ctx, ids.co))).find((x) => x.id === c.id)?.open).toBe(30_000);
    // A claim line with no claim still goes to claims income (scheme money we never claimed).
    const inc1 = await income();
    await creditNote(null, 5_000);
    expect(await income()).toBe(inc1 - 5_000);

    // Money in to the second bank, then the rest written off.
    const bank0 = await as((ctx) => balanceOf(ctx, { type: "BANK", bankAccountId: bank2 }));
    await as((ctx) => receiveOnClaim(ctx, c.id, { date: today, amount: 25_000, bankAccountId: bank2, reference: "NEFT 991" }));
    expect((await as((ctx) => balanceOf(ctx, { type: "BANK", bankAccountId: bank2 }))) - bank0).toBe(25_000);
    expect(await code(as((ctx) => receiveOnClaim(ctx, c.id, { date: today, amount: 5_001, bankAccountId: bank2 })))).toBe(400);
    const inc2 = await income();
    const w = await as((ctx) => writeOffClaim(ctx, c.id, { date: today, reason: "Company paid short" }));
    expect(w).toMatchObject({ settled: 45_000, writtenOff: 5_000, status: "WRITTEN_OFF", closeReason: "Company paid short" });
    expect(await income()).toBe(inc2 + 5_000);
    expect(await due(ids.co)).toBe(due0 - 50_000);
    expect(await code(as((ctx) => writeOffClaim(ctx, c.id, { date: today, reason: "again" })))).toBe(409);

    // Cancelling the credit note opens that part again.
    await as((ctx) => cancelPurchase(ctx, note.id, "Entered twice"));
    expect(await fresh(c.id)).toMatchObject({ settled: 25_000, writtenOff: 5_000, status: "PART_SETTLED" });
    expect(await due(ids.co)).toBe(due0 - 30_000);
    const d = await as((ctx) => claimDetail(ctx, c.id));
    expect(d.settlements.filter((s) => s.reversedAt).map((s) => s.kind)).toEqual(["CREDIT_NOTE"]);
  });

  it("rejects a whole claim, and undoes it", async () => {
    const c = await raise();
    const w = await as((ctx) => writeOffClaim(ctx, c.id, { date: today, reason: "Scheme not approved" }));
    expect(w.status).toBe("REJECTED");
    const st = await tenantDb(T).claimSettlement.findFirstOrThrow({ where: { claimId: c.id, kind: "WRITE_OFF" } });
    const back = await as((ctx) => reverseSettlement(ctx, st.id, "Company agreed after all"));
    expect(back).toMatchObject({ status: "RAISED", writtenOff: 0, closeReason: null });
    expect(await code(as((ctx) => reverseSettlement(ctx, st.id, "twice")))).toBe(409);
  });

  it("cancels a claim raised by mistake, only while nothing is against it", async () => {
    const c = await raise();
    await as((ctx) => receiveOnClaim(ctx, c.id, { date: today, amount: 1_000, cash: true }));
    expect(await code(as((ctx) => cancelClaim(ctx, c.id, "Wrong company")))).toBe(409);
    const st = await tenantDb(T).claimSettlement.findFirstOrThrow({ where: { claimId: c.id } });
    await as((ctx) => reverseSettlement(ctx, st.id, "Not ours"));
    const due0 = await due(ids.co);
    await as((ctx) => cancelClaim(ctx, c.id, "Wrong company"));
    expect(await due(ids.co)).toBe(due0 - c.amount);
    expect((await fresh(c.id)).cancelledAt).not.toBeNull();
    expect(await code(as((ctx) => receiveOnClaim(ctx, c.id, { date: today, amount: 100, cash: true })))).toBe(409);
    expect((await as((ctx) => claimsList(ctx, { status: "open", supplierId: ids.co }))).some((x) => x.id === c.id)).toBe(false);
  });
});

describe("claim basis from our own records", () => {
  it("adds up free goods (at cost) and scheme discounts billed, less returns", async () => {
    const db = tenantDb(T);
    const day = "2001-05-10";
    const inv = (
      type: "TAX_INVOICE" | "CREDIT_NOTE",
      n: string,
      lines: { productId: string; quantity: number; freeQty: number; discount: number }[],
      noteKind: string | null = null,
      originalId: string | null = null,
    ) =>
      db.invoice.create({
        data: {
          type,
          number: `TCL${run}-${n}`,
          fy: "0102",
          date: new Date(`${day}T06:00:00Z`),
          retailerId: ids.retailer,
          noteKind,
          originalId,
          seller: {},
          buyer: {},
          b2b: false,
          placeOfSupply: "27",
          interState: false,
          taxable: 0,
          cgst: 0,
          sgst: 0,
          igst: 0,
          total: 0,
          lines: {
            create: lines.map((l, i) => ({
              tenantId: T,
              sl: i + 1,
              productId: l.productId,
              description: "x",
              unit: "PCS",
              quantity: l.quantity,
              freeQty: l.freeQty,
              rate: 15000,
              gross: l.discount,
              discount: l.discount,
              taxable: 0,
              gstRate: 0,
              cgst: 0,
              sgst: 0,
              igst: 0,
              total: 0,
            })),
          },
        },
      });
    const first = await inv("TAX_INVOICE", "1", [
      { productId: ids.p1, quantity: 24, freeQty: 0, discount: 3_600 },
      { productId: ids.p1, quantity: 2, freeQty: 2, discount: 0 },
    ]);
    await inv("TAX_INVOICE", "2", [{ productId: ids.p1, quantity: 12, freeQty: 0, discount: 1_800 }]);
    await inv("CREDIT_NOTE", "3", [{ productId: ids.p1, quantity: 6, freeQty: 0, discount: 900 }], "return", first.id);
    await inv("CREDIT_NOTE", "4", [{ productId: ids.p1, quantity: 6, freeQty: 0, discount: 500 }], "value", first.id);
    const b = await as((ctx) => claimBasis(ctx, { supplierId: ids.co, type: "SCHEME", from: day, to: day }));
    const free = b.lines.find((l) => l.description.includes("free goods"))!;
    expect(free).toMatchObject({ productId: ids.p1, quantity: 2, rate: 8_000 });
    const disc = b.lines.find((l) => l.description.includes("scheme discount"))!;
    expect(disc).toMatchObject({ quantity: 1, rate: 3_600 + 1_800 - 900 });
    expect(disc.description).toContain("30 units");
    expect(disc.evidence).toContain(`TCL${run}-1`);
    expect(b.overlaps).toEqual([]);
    expect(await code(as((ctx) => claimBasis(ctx, { supplierId: ids.service, type: "SCHEME", from: day, to: day })))).toBe(400);
  });

  it("finds goods of theirs that went bad with us, at cost, and lists products with no cost", async () => {
    const wh = await as((ctx) => defaultWarehouse(ctx));
    await as((ctx) => adjustStock(ctx, { locationId: wh.id, productId: ids.p1, delta: 50, reason: "opening", unitCost: 7_500 }));
    await as((ctx) => adjustStock(ctx, { locationId: wh.id, productId: ids.p2, delta: 10, reason: "opening" }));
    await as((ctx) => damageStock(ctx, { locationId: wh.id, productId: ids.p1, qty: 4, reason: "damaged" }));
    await as((ctx) => damageStock(ctx, { locationId: wh.id, productId: ids.p1, qty: 1, reason: "expired" }));
    await as((ctx) => damageStock(ctx, { locationId: wh.id, productId: ids.p2, qty: 2, reason: "leaking" }));
    const b = await as((ctx) => claimBasis(ctx, { supplierId: ids.co, type: "DAMAGE", from: today, to: today }));
    expect(b.lines.find((l) => l.description.includes("A") && l.description.includes("damaged in our stock"))).toMatchObject({ quantity: 4, rate: 7_500 });
    expect(b.lines.find((l) => l.description.includes("expired in our stock"))).toMatchObject({ quantity: 1, rate: 7_500 });
    // No cost known for B: it is listed for the accountant, and gets no line.
    expect(b.noCost).toEqual([`Test claim B ${run}`]);
    expect(b.lines.some((l) => l.productId === ids.p2)).toBe(false);
  });

  it("gives our stock at the end of the rate-cut day", async () => {
    const now = await as((ctx) => claimBasis(ctx, { supplierId: ids.co, type: "RATE_DIFF", from: today }));
    expect(now.lines).toEqual([]);
    expect(now.stock.find((s) => s.productId === ids.p1)).toMatchObject({ qty: 45, cost: 8_000 });
    expect(now.stock.find((s) => s.productId === ids.p2)).toMatchObject({ qty: 8 });
    // Yesterday none of it had come in yet.
    const before = await as((ctx) => claimBasis(ctx, { supplierId: ids.co, type: "RATE_DIFF", from: daysAgo(1) }));
    expect(before.stock.filter((s) => s.productId === ids.p1 || s.productId === ids.p2)).toEqual([]);
    const c = await raise({ type: "RATE_DIFF", periodFrom: today, periodTo: daysAgo(20), lines: [{ productId: ids.p1, description: "Rate cut ₹80 → ₹75", quantity: 45, rate: 500 }] });
    expect(c).toMatchObject({ amount: 22_500 });
    expect(c.periodTo?.toISOString().slice(0, 10)).toBe(today); // a rate cut covers its one day
    const again = await as((ctx) => claimBasis(ctx, { supplierId: ids.co, type: "RATE_DIFF", from: today }));
    expect(again.overlaps.map((o) => o.number)).toEqual([c.number]);
  });
});

describe("claims reports and the letter", () => {
  it("ages pending claims, lists settlements, and compares claimed with received", async () => {
    const old = await raise({ date: daysAgo(45), periodFrom: daysAgo(80), periodTo: daysAgo(50), lines: [{ description: "Old scheme", quantity: 1, rate: 70_000 }] });
    await as((ctx) => receiveOnClaim(ctx, old.id, { date: daysAgo(10), amount: 20_000, bankAccountId: bank2 }));
    const p = await as((ctx) => pendingClaims(ctx, today, { supplierId: ids.co }));
    const row = p.claims.find((c) => c.id === old.id)!;
    expect(row).toMatchObject({ open: 50_000, done: 20_000, age: 45, bucket: "d60" });
    expect(p.companies[0]).toMatchObject({ supplierId: ids.co });
    expect(p.totals.d60).toBeGreaterThanOrEqual(50_000);
    // As on a day before the money came, all of it was open.
    const p2 = await as((ctx) => pendingClaims(ctx, daysAgo(20), { supplierId: ids.co }));
    expect(p2.claims.find((c) => c.id === old.id)?.open).toBe(70_000);

    const s = await as((ctx) => settlementsIn(ctx, daysAgo(15), today, { supplierId: ids.co }));
    expect(s.rows.find((x) => x.claimId === old.id)).toMatchObject({ kind: "RECEIPT", amount: 20_000 });
    expect(s.totals.received).toBeGreaterThanOrEqual(20_000);

    const t = await as((ctx) => claimsByType(ctx, daysAgo(60), today, { supplierId: ids.co }));
    const scheme = t.types.find((x) => x.type === "SCHEME")!;
    expect(scheme.claimed).toBe(scheme.received + scheme.writtenOff + scheme.open);
    expect(t.types.find((x) => x.type === "RATE_DIFF")).toMatchObject({ claims: 1, claimed: 22_500 });

    // PDF, CSV and the WhatsApp line.
    const tenant = { name: "Test", address: null, gstin: null };
    expect((await renderSheetPdf(pendingSheet(p), tenant)).byteLength).toBeGreaterThan(1000);
    expect((await renderSheetPdf(settledSheet(s), tenant)).byteLength).toBeGreaterThan(1000);
    expect((await renderSheetPdf(byTypeSheet(t), tenant)).byteLength).toBeGreaterThan(1000);
    expect(pendingCsv(p)[0][0]).toBe("Claim");
    expect(claimsSummary("pending", { pending: p })).toContain("Claims pending");

    const d = await as((ctx) => claimDetail(ctx, old.id));
    const letter = letterSheet(d, { name: "Test Distributors" });
    expect(letter.rows.some((r) => r.kind === "note" && r.text.includes(`Test claim company ${run}`))).toBe(true);
    expect(letter.rows.some((r) => r.kind === "note" && r.text.includes("still to come"))).toBe(true);
    expect((await renderSheetPdf(letter, tenant)).byteLength).toBeGreaterThan(1000);
    expect(letterCsv(d).at(-1)?.[5]).toBe("700.00");
  });

  it("keeps the books clean: each company's claims receivable equals its open claims", async () => {
    const r = await as((ctx) => checkBooks(ctx));
    const bad = r.results.filter((x) => !x.ok);
    expect(bad).toEqual([]);
    expect(r.results.find((x) => x.key === "claims")?.ok).toBe(true);
  });
});
