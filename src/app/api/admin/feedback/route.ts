import { engageRead, qp } from "@/lib/engage-api";
import { feedbackSummary } from "@/lib/tickets";

const DAY = 24 * 3600_000;

/** GET ?days=30 → delivery ratings: average, stars, tags, per driver (lowest first) and the latest ratings. */
export async function GET(req: Request) {
  const days = Math.min(365, Math.max(1, Number(qp(req).get("days")) || 30));
  return engageRead("tickets.manage", async (ctx) => {
    const to = new Date();
    return { days, ...(await feedbackSummary(ctx.tx, new Date(to.getTime() - days * DAY), new Date(to.getTime() + 1000))) };
  });
}
