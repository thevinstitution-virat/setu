import { NextResponse } from "next/server";
import { guard } from "@/lib/guard";
import { audit, requestIp } from "@/lib/audit";
import { bad, optText, text } from "@/lib/catalogue-api";

export async function GET() {
  const auth = await guard("pricing.manage");
  if (!auth.ok) return auth.res;
  const lists = await auth.db.priceList.findMany({
    orderBy: { name: "asc" },
    include: { _count: { select: { items: true, retailers: true } } },
  });
  return NextResponse.json({ lists });
}

/** { name, description?, copyFrom?: priceListId } */
export async function POST(req: Request) {
  const auth = await guard("pricing.manage");
  if (!auth.ok) return auth.res;
  const { db, session } = auth;
  const b = (await req.json().catch(() => null)) ?? {};
  const name = text(b.name, 60);
  if (!name) return bad("Name is required");
  if (await db.priceList.findFirst({ where: { name: { equals: name, mode: "insensitive" } } })) return bad("That price list already exists", 409);
  let copy: { productId: string; price: number }[] = [];
  if (typeof b.copyFrom === "string" && b.copyFrom) {
    const src = await db.priceList.findUnique({ where: { id: b.copyFrom }, include: { items: { select: { productId: true, price: true } } } });
    if (!src) return bad("Unknown price list to copy");
    copy = src.items;
  }
  const list = await db.priceList.create({
    data: { name, description: optText(b.description, 200), items: { create: copy } },
  });
  await audit(db, { actorId: session.userId, action: "pricelist.create", entity: "PriceList", entityId: list.id, after: { ...list, copied: copy.length }, ip: requestIp(req) });
  return NextResponse.json({ list });
}
