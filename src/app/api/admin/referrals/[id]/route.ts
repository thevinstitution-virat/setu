import { engageWrite } from "@/lib/engage-api";
import { MoneyError } from "@/lib/money-error";

/** Body: { note } → cancel a pending referral (it will never pay). */
export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return engageWrite(
    req,
    "referral.cancel",
    "promotions.manage",
    async (ctx, b) => {
      const note = typeof b.note === "string" ? b.note.trim().slice(0, 200) : "";
      if (!note) throw new MoneyError("Say why it is cancelled");
      const r = await ctx.tx.referral.updateMany({ where: { id, status: "PENDING" }, data: { status: "LAPSED", note: `Cancelled: ${note}` } });
      if (!r.count) throw new MoneyError("Only a pending referral can be cancelled", 409);
      return { id };
    },
    { entity: "Referral", entityId: id }
  );
}
