import { NextResponse } from "next/server";
import { guard } from "@/lib/guard";
import { withTenantTx } from "@/lib/db";
import { audit, requestIp } from "@/lib/audit";
import { emit } from "@/lib/jobs";
import {
  MAX_ROWS,
  parseSheet,
  templateCsv,
  validateProducts,
  validateRetailers,
  type ImportType,
  type ProductRow,
  type RetailerRow,
  type RowError,
} from "@/lib/importers";

const MAX_BYTES = 5 * 1024 * 1024;

type Tx = Parameters<Parameters<typeof withTenantTx>[1]>[0];
type Summary = { created: number; updated: number; newRegions: number; newAreas: number; errors: RowError[] };

/** Thrown at the end of a preview so the whole transaction rolls back. */
class Rollback extends Error {
  constructor(public summary: Summary) {
    super("preview");
  }
}

async function importRetailers(tx: Tx, rows: RetailerRow[]): Promise<Summary> {
  const s: Summary = { created: 0, updated: 0, newRegions: 0, newAreas: 0, errors: [] };

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
        where: { phone: { in: rows.map((r) => r.phone) } },
        select: { id: true, phone: true, role: true, retailerProfile: { select: { id: true } } },
      })
    ).map((u) => [u.phone!, u])
  );

  for (const r of rows) {
    let salesAgentId: string | null | undefined = undefined;
    if (r.salesAgent) {
      salesAgentId = agents.get(r.salesAgent.toLowerCase());
      if (!salesAgentId) {
        s.errors.push({ row: r.row, message: `No active sales agent with login "${r.salesAgent}"` });
        continue;
      }
    }
    const found = existing.get(r.phone);
    if (found && (found.role !== "RETAILER" || !found.retailerProfile)) {
      s.errors.push({ row: r.row, message: `Phone ${r.phone} belongs to a staff account` });
      continue;
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
      pinCode: r.pinCode,
      areaId,
      ...(salesAgentId !== undefined ? { salesAgentId } : {}),
    };
    if (found) {
      await tx.user.update({
        where: { id: found.id },
        data: { name: r.outletName, retailerProfile: { update: profile } },
      });
      s.updated++;
    } else {
      await tx.user.create({
        data: { name: r.outletName, phone: r.phone, role: "RETAILER", retailerProfile: { create: profile } },
      });
      s.created++;
    }
  }
  return s;
}

async function importProducts(tx: Tx, rows: ProductRow[]): Promise<Summary> {
  const s: Summary = { created: 0, updated: 0, newRegions: 0, newAreas: 0, errors: [] };
  const existing = new Map(
    (await tx.product.findMany({ select: { id: true, sku: true } })).map((p) => [p.sku.toUpperCase(), p.id])
  );
  for (const p of rows) {
    const data = {
      name: p.name,
      category: p.category,
      unit: p.unit,
      price: p.price,
      mrp: p.mrp,
      gstRate: p.gstRate,
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

export async function GET(req: Request) {
  const auth = await guard("import.run");
  if (!auth.ok) return auth.res;
  const type = new URL(req.url).searchParams.get("type") as ImportType;
  if (type !== "retailers" && type !== "products") {
    return NextResponse.json({ error: "type must be retailers or products" }, { status: 400 });
  }
  return new NextResponse("﻿" + templateCsv(type), {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="setu-${type}-template.csv"`,
    },
  });
}

/** multipart: file, type (retailers|products), mode (preview|commit) */
export async function POST(req: Request) {
  const auth = await guard("import.run");
  if (!auth.ok) return auth.res;
  const { session, tenant, db } = auth;

  const form = await req.formData().catch(() => null);
  const file = form?.get("file");
  const type = String(form?.get("type") ?? "") as ImportType;
  const mode = String(form?.get("mode") ?? "preview");
  if (!(file instanceof File)) return NextResponse.json({ error: "Attach a CSV or Excel file" }, { status: 400 });
  if (type !== "retailers" && type !== "products") {
    return NextResponse.json({ error: "Choose retailers or products" }, { status: 400 });
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

  const checked = type === "retailers" ? validateRetailers(rows) : validateProducts(rows);

  // Preview runs the exact same writes inside a transaction and rolls it back,
  // so what it reports is exactly what commit will do.
  let summary: Summary;
  try {
    summary = await withTenantTx(
      tenant.id,
      async (tx) => {
        const s =
          type === "retailers"
            ? await importRetailers(tx, checked.valid as RetailerRow[])
            : await importProducts(tx, checked.valid as ProductRow[]);
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
    after: { file: file.name, rows: rows.length, created: summary.created, updated: summary.updated },
    ip: requestIp(req),
  });
  await emit("import.completed", { tenantId: tenant.id, type, created: summary.created, updated: summary.updated });

  return NextResponse.json({ mode: "commit", rows: rows.length, committed: true, ...summary, errorCount: 0 });
}
