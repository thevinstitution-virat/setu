import { NextResponse } from "next/server";
import { guard } from "@/lib/guard";
import { withTenantTx } from "@/lib/db";
import { countRetailers, entitlements } from "@/lib/plans";
import { audit, requestIp } from "@/lib/audit";
import { emit } from "@/lib/jobs";
import { MoneyError, openingBalance, openingBills, type OpeningBill } from "@/lib/ledger";
import { can } from "@/lib/permissions";
import type { Role } from "@/generated/prisma/client";
import { importPurchases, importSupplierBills, importSuppliers } from "@/lib/books-import";
import { invoiceSettings } from "@/lib/invoice-settings";
import {
  BOOKS_IMPORTS,
  IMPORT_TYPES,
  MAX_ROWS,
  parseSheet,
  shopKey,
  templateCsv,
  validateBalances,
  validateBills,
  validateBillShares,
  type BillRow,
  type BillShareRow,
  validatePrices,
  validateProducts,
  type PriceRow,
  validateRetailers,
  type BalanceRow,
  type ImportType,
  type ProductRow,
  type RetailerRow,
  type RowError,
  validatePurchases,
  validateSupplierBills,
  validateSuppliers,
  type PurchaseImportBill,
  type SupplierBillImportRow,
  type SupplierImportRow,
} from "@/lib/importers";
import { applyBillShares } from "@/lib/bill-shares";
import { tidyProductRows, type TidyChange, type TidyDuplicate } from "@/lib/catalogue-rules";

const MAX_BYTES = 5 * 1024 * 1024;

type Tx = Parameters<Parameters<typeof withTenantTx>[1]>[0];
type Summary = { created: number; updated: number; newRegions: number; newAreas: number; errors: RowError[] };

/** Thrown at the end of a preview so the whole transaction rolls back. */
class Rollback extends Error {
  constructor(public summary: Summary) {
    super("preview");
  }
}

async function importRetailers(tx: Tx, rows: RetailerRow[], tenantId: string, defaultPin: string): Promise<Summary> {
  const s: Summary = { created: 0, updated: 0, newRegions: 0, newAreas: 0, errors: [] };
  // Shops without a phone are found by outlet name + area.
  const byName = new Map<string, { userId: string }[]>();
  for (const p of await tx.retailerProfile.findMany({ select: { userId: true, outletName: true, area: { select: { name: true } } } })) {
    const k = shopKey(p.outletName, p.area.name);
    byName.set(k, [...(byName.get(k) ?? []), { userId: p.userId }]);
  }

  const regions = new Map(
    (await tx.region.findMany({ include: { areas: true } })).map((r) => [
      r.name.toLowerCase(),
      { id: r.id, areas: new Map(r.areas.map((a) => [a.name.toLowerCase(), a.id])) },
    ])
  );
  const agents = new Map(
    (
      await tx.user.findMany({
        where: { role: "SALES_AGENT", active: true },
        select: { loginId: true, salesAgentProfile: { select: { id: true } } },
      })
    )
      .filter((u) => u.loginId && u.salesAgentProfile)
      .map((u) => [u.loginId!.toLowerCase(), u.salesAgentProfile!.id])
  );
  const existing = new Map(
    (
      await tx.user.findMany({
        where: { phone: { in: rows.map((r) => r.phone).filter((p): p is string => !!p) } },
        select: { id: true, phone: true, role: true, retailerProfile: { select: { id: true } } },
      })
    ).map((u) => [u.phone!, u])
  );

  for (const r of rows) {
    const pinCode = r.pinCode || defaultPin;
    if (!pinCode) {
      s.errors.push({ row: r.row, message: "No pin_code, and the business has no PIN code in Settings → GST & invoices to use instead" });
      continue;
    }
    let salesAgentId: string | null | undefined = undefined;
    if (r.salesAgent) {
      salesAgentId = agents.get(r.salesAgent.toLowerCase());
      if (!salesAgentId) {
        s.errors.push({ row: r.row, message: `No active sales agent with login "${r.salesAgent}"` });
        continue;
      }
    }
    let found: { id: string; role: string; retailerProfile: { id: string } | null } | undefined;
    if (r.phone) {
      found = existing.get(r.phone);
      if (found && (found.role !== "RETAILER" || !found.retailerProfile)) {
        s.errors.push({ row: r.row, message: `Phone ${r.phone} belongs to a staff account` });
        continue;
      }
    } else {
      const same = byName.get(shopKey(r.outletName, r.area)) ?? [];
      if (same.length > 1) {
        s.errors.push({ row: r.row, message: `${same.length} shops are already called ${r.outletName} in ${r.area}; give this row a phone` });
        continue;
      }
      if (same.length === 1) found = { id: same[0].userId, role: "RETAILER", retailerProfile: { id: "" } };
    }

    let region = regions.get(r.region.toLowerCase());
    if (!region) {
      const created = await tx.region.create({ data: { name: r.region } });
      region = { id: created.id, areas: new Map() };
      regions.set(r.region.toLowerCase(), region);
      s.newRegions++;
    }
    let areaId = region.areas.get(r.area.toLowerCase());
    if (!areaId) {
      areaId = (await tx.area.create({ data: { name: r.area, regionId: region.id } })).id;
      region.areas.set(r.area.toLowerCase(), areaId);
      s.newAreas++;
    }

    const profile = {
      outletName: r.outletName,
      shopNumber: r.shopNumber,
      complexName: r.complexName,
      pinCode,
      areaId,
      ...(salesAgentId !== undefined ? { salesAgentId } : {}),
      ...(r.contactName ? { contactName: r.contactName } : {}),
      ...(r.altPhone ? { altPhone: r.altPhone } : {}),
    };
    if (found) {
      await tx.user.update({
        where: { id: found.id },
        data: { name: r.outletName, retailerProfile: { update: profile } },
      });
      s.updated++;
    } else {
      const user = await tx.user.create({
        data: { name: r.outletName, phone: r.phone, role: "RETAILER", retailerProfile: { create: profile } },
        select: { id: true },
      });
      if (!r.phone) byName.set(shopKey(r.outletName, r.area), [{ userId: user.id }]);
      s.created++;
    }
  }
  // The plan's shop limit, counted with the new shops inside this transaction.
  const limit = (await entitlements(tenantId)).limits.retailers;
  if (limit !== undefined && s.created) {
    const n = await countRetailers(tx);
    if (n > limit) s.errors.push({ row: 0, message: `Your plan allows ${limit} shops; this file would make ${n}. Move to a bigger plan under Billing, or import fewer.` });
  }
  return s;
}

async function importProducts(tx: Tx, rows: ProductRow[]): Promise<Summary> {
  const s: Summary = { created: 0, updated: 0, newRegions: 0, newAreas: 0, errors: [] };
  const existing = new Map(
    (await tx.product.findMany({ select: { id: true, sku: true } })).map((p) => [p.sku.toUpperCase(), p.id])
  );
  // Categories, brands and HSN rates by name / code; new names are created.
  const cats = new Map((await tx.category.findMany({ select: { id: true, name: true } })).map((c) => [c.name.toLowerCase(), c.id]));
  const brands = new Map((await tx.brand.findMany({ select: { id: true, name: true } })).map((c) => [c.name.toLowerCase(), c.id]));
  const companies = new Map((await tx.supplier.findMany({ select: { id: true, name: true } })).map((c) => [c.name.toLowerCase(), c.id]));
  const hsn = new Map((await tx.hsnCode.findMany({ select: { code: true, gstRate: true } })).map((h) => [h.code, h.gstRate]));
  const idFor = async (map: Map<string, string>, name: string, create: (name: string) => Promise<{ id: string }>) => {
    let id = map.get(name.toLowerCase());
    if (!id) {
      id = (await create(name)).id;
      map.set(name.toLowerCase(), id);
    }
    return id;
  };
  for (const p of rows) {
    const data = {
      name: p.name,
      categoryId: await idFor(cats, p.category, (name) => tx.category.create({ data: { name } })),
      brandId: p.brand ? await idFor(brands, p.brand, (name) => tx.brand.create({ data: { name } })) : null,
      // A blank company leaves the product's company as it is.
      ...(p.company ? { supplierId: await idFor(companies, p.company, (name) => tx.supplier.create({ data: { name } })) } : {}),
      hsnCode: p.hsnCode,
      nameHi: p.nameHi,
      caseUnit: p.caseUnit,
      caseSize: p.caseSize,
      moq: p.moq,
      unit: p.unit,
      price: p.price,
      mrp: p.mrp,
      // The HSN table decides the rate when the code is known.
      gstRate: (p.hsnCode ? hsn.get(p.hsnCode) : undefined) ?? p.gstRate,
      specialOffer: p.specialOffer,
      active: true,
    };
    const id = existing.get(p.sku.toUpperCase());
    if (id) {
      await tx.product.update({ where: { id }, data });
      s.updated++;
    } else {
      await tx.product.create({ data: { ...data, sku: p.sku } });
      s.created++;
    }
  }
  return s;
}

async function importPrices(tx: Tx, rows: PriceRow[]): Promise<Summary> {
  const s: Summary = { created: 0, updated: 0, newRegions: 0, newAreas: 0, errors: [] };
  const products = new Map((await tx.product.findMany({ select: { id: true, sku: true } })).map((p) => [p.sku.toUpperCase(), p.id]));
  const lists = new Map((await tx.priceList.findMany({ select: { id: true, name: true } })).map((l) => [l.name.toLowerCase(), l.id]));
  const phones = [...new Set(rows.map((r) => r.phone).filter((x): x is string => !!x))];
  const retailers = new Map(
    (await tx.user.findMany({ where: { phone: { in: phones }, role: "RETAILER" }, select: { phone: true, retailerProfile: { select: { id: true } } } }))
      .filter((u) => u.retailerProfile)
      .map((u) => [u.phone!, u.retailerProfile!.id])
  );
  for (const r of rows) {
    const productId = products.get(r.sku.toUpperCase());
    if (!productId) {
      s.errors.push({ row: r.row, message: `No product with SKU ${r.sku}` });
      continue;
    }
    if (r.priceList) {
      let listId = lists.get(r.priceList.toLowerCase());
      if (!listId) {
        listId = (await tx.priceList.create({ data: { name: r.priceList } })).id;
        lists.set(r.priceList.toLowerCase(), listId);
      }
      const key = { priceListId_productId: { priceListId: listId, productId } };
      const had = await tx.priceListItem.findUnique({ where: key });
      await tx.priceListItem.upsert({ where: key, create: { priceListId: listId, productId, price: r.price }, update: { price: r.price } });
      if (had) s.updated++;
      else s.created++;
    } else {
      const retailerId = retailers.get(r.phone!);
      if (!retailerId) {
        s.errors.push({ row: r.row, message: `No retailer with phone ${r.phone}` });
        continue;
      }
      const key = { retailerId_productId: { retailerId, productId } };
      const had = await tx.retailerPrice.findUnique({ where: key });
      await tx.retailerPrice.upsert({ where: key, create: { retailerId, productId, price: r.price }, update: { price: r.price } });
      if (had) s.updated++;
      else s.created++;
    }
  }
  return s;
}

async function importBalances(tx: Tx, rows: BalanceRow[], tenantId: string, actorId: string): Promise<Summary> {
  const s: Summary = { created: 0, updated: 0, newRegions: 0, newAreas: 0, errors: [] };
  const retailers = new Map(
    (
      await tx.user.findMany({
        where: { phone: { in: rows.map((r) => r.phone) }, role: "RETAILER" },
        select: { phone: true, retailerProfile: { select: { id: true } } },
      })
    )
      .filter((u) => u.retailerProfile)
      .map((u) => [u.phone!, u.retailerProfile!.id])
  );
  const ctx = { tx, tenantId, actorId };
  for (const r of rows) {
    const retailerId = retailers.get(r.phone);
    if (!retailerId) {
      s.errors.push({ row: r.row, message: `No retailer with phone ${r.phone} (import retailers first)` });
      continue;
    }
    try {
      await openingBalance(ctx, retailerId, r.amount, r.asOf, r.note || "Opening balance");
      s.created++;
    } catch (e) {
      // openingBalance checks before it writes, so a refused row leaves nothing behind.
      if (!(e instanceof MoneyError)) throw e;
      s.errors.push({ row: r.row, message: e.message });
    }
  }
  return s;
}

/**
 * Open bills from the old book: the shop by phone, else by party name (+ area
 * when names repeat); the salesman by name or login. All of a shop's rows go
 * in together (openingBills), once per shop.
 */
async function importBills(tx: Tx, rows: BillRow[], tenantId: string, actorId: string): Promise<Summary> {
  const s: Summary = { created: 0, updated: 0, newRegions: 0, newAreas: 0, errors: [] };
  const shops = await tx.retailerProfile.findMany({
    select: { id: true, outletName: true, area: { select: { name: true } }, user: { select: { phone: true } } },
  });
  const byPhone = new Map(shops.filter((p) => p.user.phone).map((p) => [p.user.phone!, p.id]));
  const norm = (v: string) => v.trim().replace(/\s+/g, " ").toLowerCase();
  const staff = await tx.user.findMany({
    where: { role: { in: ["SALES_AGENT", "SUPERVISOR", "ADMIN", "DELIVERY_AGENT"] } },
    select: { id: true, name: true, loginId: true },
  });
  const findShop = (r: BillRow): string | { error: string } => {
    if (r.phone) return byPhone.get(r.phone) ?? { error: `No shop with phone ${r.phone} (import shops first)` };
    let same = shops.filter((p) => norm(p.outletName) === norm(r.party));
    if (same.length > 1 && r.area) same = same.filter((p) => norm(p.area.name) === norm(r.area));
    if (!same.length) return { error: `No shop called ${r.party}${r.area ? ` in ${r.area}` : ""} (import shops first)` };
    if (same.length > 1) return { error: `${same.length} shops are called ${r.party}; add the area or phone` };
    return same[0].id;
  };
  const findSalesman = (name: string): string | null | { error: string } => {
    if (!name) return null;
    const hits = staff.filter((u) => norm(u.name) === norm(name) || (u.loginId && norm(u.loginId) === norm(name)));
    if (hits.length === 1) return hits[0].id;
    return { error: hits.length ? `${hits.length} staff are called ${name}` : `No staff member called ${name} (add them under Team first)` };
  };

  const byShop = new Map<string, { bills: OpeningBill[]; advance: number; rows: number[] }>();
  for (const r of rows) {
    const shopId = findShop(r);
    if (typeof shopId !== "string") {
      s.errors.push({ row: r.row, message: shopId.error });
      continue;
    }
    const salesmanId = findSalesman(r.salesman);
    if (salesmanId !== null && typeof salesmanId !== "string") {
      s.errors.push({ row: r.row, message: salesmanId.error });
      continue;
    }
    const g = byShop.get(shopId) ?? { bills: [], advance: 0, rows: [] };
    g.rows.push(r.row);
    if (r.number === null) g.advance += -r.amount;
    else g.bills.push({ number: r.number, date: r.date!, dueDate: r.dueDate, amount: r.amount, paid: r.paid, salesmanId });
    byShop.set(shopId, g);
  }
  const ctx = { tx, tenantId, actorId };
  for (const [shopId, g] of byShop) {
    try {
      await openingBills(ctx, shopId, g.bills, g.advance);
      s.created += g.bills.length + (g.advance > 0 ? 1 : 0);
    } catch (e) {
      // openingBills checks before it writes, so a refused shop leaves nothing behind.
      if (!(e instanceof MoneyError)) throw e;
      for (const row of g.rows) s.errors.push({ row, message: e.message });
    }
  }
  return s;
}

async function importBillShares(tx: Tx, rows: BillShareRow[]): Promise<Summary> {
  return { ...(await applyBillShares(tx, rows)), newRegions: 0, newAreas: 0 };
}

async function importBooks(tx: Tx, type: ImportType, valid: unknown[], tenantId: string, actorId: string): Promise<Summary> {
  const ctx = { tx, tenantId, actorId };
  const r =
    type === "suppliers"
      ? await importSuppliers(ctx, valid as SupplierImportRow[])
      : type === "supplier_bills"
        ? await importSupplierBills(ctx, valid as SupplierBillImportRow[])
        : await importPurchases(ctx, valid as PurchaseImportBill[]);
  return { ...r, newRegions: 0, newAreas: 0 };
}

/** The owner imports anything; whoever enters purchases may import the suppliers' and purchase sheets. */
const mayImport = (role: Role, type: ImportType) => can(role, "import.run") || (BOOKS_IMPORTS.includes(type) && can(role, "purchases.manage"));

export async function GET(req: Request) {
  const auth = await guard();
  if (!auth.ok) return auth.res;
  const type = new URL(req.url).searchParams.get("type") as ImportType;
  if (!IMPORT_TYPES.includes(type)) {
    return NextResponse.json({ error: `type must be one of ${IMPORT_TYPES.join(", ")}` }, { status: 400 });
  }
  if (!mayImport(auth.session.role, type)) return NextResponse.json({ error: "You don't have access to this" }, { status: 403 });
  return new NextResponse("﻿" + templateCsv(type), {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="setu-${type}-template.csv"`,
    },
  });
}

/** multipart: file, type (retailers|products), mode (preview|commit) */
export async function POST(req: Request) {
  const auth = await guard();
  if (!auth.ok) return auth.res;
  const { session, tenant, db } = auth;

  // Refuse a big body before reading it into memory.
  if (Number(req.headers.get("content-length") ?? 0) > MAX_BYTES + 64 * 1024) return NextResponse.json({ error: "File is larger than 5 MB" }, { status: 413 });
  const form = await req.formData().catch(() => null);
  const file = form?.get("file");
  const type = String(form?.get("type") ?? "") as ImportType;
  const mode = String(form?.get("mode") ?? "preview");
  if (!(file instanceof File)) return NextResponse.json({ error: "Attach a CSV or Excel file" }, { status: 400 });
  if (!IMPORT_TYPES.includes(type)) {
    return NextResponse.json({ error: `Choose one of ${IMPORT_TYPES.join(", ")}` }, { status: 400 });
  }
  if (!mayImport(session.role, type)) {
    return NextResponse.json({ error: BOOKS_IMPORTS.includes(type) ? "Only someone who enters purchases can import suppliers and their bills" : "You don't have access to this" }, { status: 403 });
  }
  if (!/\.(csv|xlsx)$/i.test(file.name)) {
    return NextResponse.json({ error: "Use a .csv or .xlsx file (old .xls: save as .xlsx first)" }, { status: 415 });
  }
  if (file.size > MAX_BYTES) return NextResponse.json({ error: "File is larger than 5 MB" }, { status: 413 });

  let rows;
  try {
    rows = await parseSheet(Buffer.from(await file.arrayBuffer()), file.name);
  } catch {
    return NextResponse.json({ error: "Could not read this file" }, { status: 400 });
  }
  if (!rows.length) return NextResponse.json({ error: "The file has no data rows" }, { status: 400 });
  if (rows.length > MAX_ROWS) {
    return NextResponse.json({ error: `At most ${MAX_ROWS} rows per file; split it` }, { status: 400 });
  }

  // A13: tidy a product sheet first (names, units, GST, categories) and flag likely duplicates.
  let tidy: { changes: TidyChange[]; changeCount: number; duplicates: TidyDuplicate[] } | null = null;
  if (type === "products" && String(form?.get("tidy") ?? "") === "1") {
    const existing = await withTenantTx(tenant.id, async (tx) => ({
      products: await tx.product.findMany({ select: { name: true, sku: true } }),
      categories: (await tx.category.findMany({ select: { name: true } })).map((c) => c.name),
    }));
    const t = tidyProductRows(rows, existing);
    rows = t.rows;
    tidy = { changes: t.changes.slice(0, 200), changeCount: t.changes.length, duplicates: t.duplicates.slice(0, 100) };
  }

  const checked =
    type === "retailers"
      ? validateRetailers(rows)
      : type === "products"
        ? validateProducts(rows)
        : type === "prices"
          ? validatePrices(rows)
          : type === "bills"
            ? validateBills(rows)
            : type === "bill_shares"
              ? validateBillShares(rows)
              : type === "suppliers"
                ? validateSuppliers(rows)
                : type === "supplier_bills"
                  ? validateSupplierBills(rows)
                  : type === "purchases"
                    ? validatePurchases(rows)
                    : validateBalances(rows);

  // Preview runs the exact same writes inside a transaction and rolls it back,
  // so what it reports is exactly what commit will do.
  let summary: Summary;
  try {
    summary = await withTenantTx(
      tenant.id,
      async (tx) => {
        const s =
          type === "retailers"
            ? await importRetailers(tx, checked.valid as RetailerRow[], tenant.id, invoiceSettings(tenant.settings).pinCode)
            : type === "products"
              ? await importProducts(tx, checked.valid as ProductRow[])
              : type === "prices"
                ? await importPrices(tx, checked.valid as PriceRow[])
                : type === "bills"
                  ? await importBills(tx, checked.valid as BillRow[], tenant.id, session.userId)
                  : type === "bill_shares"
                    ? await importBillShares(tx, checked.valid as BillShareRow[])
                    : BOOKS_IMPORTS.includes(type)
                      ? await importBooks(tx, type, checked.valid, tenant.id, session.userId)
                      : await importBalances(tx, checked.valid as BalanceRow[], tenant.id, session.userId);
        s.errors = [...checked.errors, ...s.errors].sort((a, b) => a.row - b.row);
        if (mode !== "commit" || s.errors.length) throw new Rollback(s);
        return s;
      },
      { timeout: 120_000 }
    );
  } catch (e) {
    if (e instanceof Rollback) {
      return NextResponse.json({
        mode: "preview",
        rows: rows.length,
        committed: false,
        tidy,
        ...e.summary,
        errors: e.summary.errors.slice(0, 200),
        errorCount: e.summary.errors.length,
      });
    }
    throw e;
  }

  await audit(db, {
    actorId: session.userId,
    action: `import.${type}`,
    entity: "Import",
    after: { file: file.name, rows: rows.length, created: summary.created, updated: summary.updated, tidied: tidy?.changeCount ?? 0 },
    ip: requestIp(req),
  });
  await emit("import.completed", { tenantId: tenant.id, type, created: summary.created, updated: summary.updated });

  return NextResponse.json({ mode: "commit", rows: rows.length, committed: true, tidy, ...summary, errorCount: 0 });
}
