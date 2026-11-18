import { NextResponse } from "next/server";
import { guard } from "@/lib/guard";
import { audit, requestIp } from "@/lib/audit";
import { emit } from "@/lib/jobs";
import { keyBelongsTo } from "@/lib/storage";

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await guard("delivery.work");
  if (!auth.ok) return auth.res;
  const { session, db } = auth;
  const { id } = await params;
  const agent = await db.deliveryAgentProfile.findUnique({ where: { userId: session.userId } });
  if (!agent) return NextResponse.json({ error: "Profile not found" }, { status: 404 });

  const delivery = await db.delivery.findUnique({ where: { orderId: id } });
  if (!delivery || delivery.deliveryAgentId !== agent.id) {
    return NextResponse.json({ error: "This order is not assigned to you" }, { status: 403 });
  }

  const body = await req.json().catch(() => null);
  const { lat, lng } = body ?? {};
  const keyOrNull = (v: unknown) => (typeof v === "string" && keyBelongsTo(v, auth.tenant.id) ? v : null);
  const podPhotoUrl = keyOrNull(body?.podPhotoKey);
  const podSignatureData = keyOrNull(body?.podSignatureKey);
  const paymentMethod = ["CASH", "ONLINE", "CREDIT"].includes(body?.paymentMethod) ? body.paymentMethod : "CASH";
  const order0 = await db.order.findUnique({ where: { id } });
  if (!order0 || order0.status === "DELIVERED" || order0.status === "CANCELLED") {
    return NextResponse.json({ error: "This order can no longer be delivered" }, { status: 400 });
  }
  // Cash due is the order total, decided on the server — never trusted from the phone.
  const codAmount = paymentMethod === "CASH" ? order0.totalAmount : 0;

  await db.delivery.update({
    where: { orderId: id },
    data: {
      deliveredAt: new Date(),
      podPhotoUrl,
      podSignatureData,
      paymentMethod,
      paymentStatus: "COLLECTED",
      codAmount,
      lat,
      lng,
    },
  });

  const order = await db.order.update({
    where: { id },
    data: {
      status: "DELIVERED",
      statusEvents: {
        create: { status: "DELIVERED", actorId: session.userId, note: "Delivered with proof of delivery" },
      },
    },
  });

  await audit(db, { actorId: session.userId, action: "order.deliver", entity: "Order", entityId: id, before: { status: order0.status }, after: { status: "DELIVERED", paymentMethod, codAmount, lat, lng }, ip: requestIp(req) });
  await emit("order.delivered", { tenantId: auth.tenant.id, orderId: id, paymentMethod, codAmount });

  return NextResponse.json({ order });
}
