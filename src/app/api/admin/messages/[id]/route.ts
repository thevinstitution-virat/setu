import { engageWrite } from "@/lib/engage-api";
import { MoneyError } from "@/lib/money-error";
import { kickMessages } from "@/lib/jobs";

/** POST → send a failed message again (from the start of its attempts). */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const res = await engageWrite(
    req,
    "message.retry",
    "messages.manage",
    async (ctx) => {
      const m = await ctx.tx.messageLog.findUnique({ where: { id }, select: { status: true } });
      if (!m) throw new MoneyError("Message not found", 404);
      if (m.status !== "FAILED") throw new MoneyError("Only a failed message can be sent again", 409);
      return ctx.tx.messageLog.update({ where: { id }, data: { status: "QUEUED", attempts: 0, error: null }, select: { id: true, tenantId: true } });
    },
    { entity: "MessageLog", entityId: id }
  );
  if (res.ok) {
    const data = (await res.clone().json()) as { result?: { tenantId?: string } };
    if (data.result?.tenantId) await kickMessages(data.result.tenantId);
  }
  return res;
}
