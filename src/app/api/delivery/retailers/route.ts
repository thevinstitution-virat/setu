import { NextResponse } from "next/server";
import { guard } from "@/lib/guard";

/**
 * Shops a driver can make a spot sale to: active retailers matching ?q=
 * (shop name, owner, area or PIN code), 20 at a time. Only what the sale
 * screen needs (no balances or contact numbers).
 */
export async function GET(req: Request) {
  const auth = await guard("stock.spot_sell");
  if (!auth.ok) return auth.res;
  const q = (new URL(req.url).searchParams.get("q") ?? "").trim().slice(0, 60);
  const retailers = await auth.db.retailerProfile.findMany({
    where: {
      user: { active: true },
      ...(q
        ? {
            OR: [
              { outletName: { contains: q, mode: "insensitive" } },
              { user: { name: { contains: q, mode: "insensitive" } } },
              { pinCode: { startsWith: q } },
              { area: { name: { contains: q, mode: "insensitive" } } },
            ],
          }
        : {}),
    },
    orderBy: { outletName: "asc" },
    take: 20,
    select: { id: true, outletName: true, pinCode: true, area: { select: { name: true } }, user: { select: { name: true } } },
  });
  return NextResponse.json({ retailers: retailers.map((r) => ({ id: r.id, outletName: r.outletName, ownerName: r.user.name, area: r.area.name, pinCode: r.pinCode })) });
}
