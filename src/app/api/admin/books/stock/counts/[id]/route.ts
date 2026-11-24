import { NextResponse } from "next/server";
import { guard } from "@/lib/guard";
import { audit, requestIp } from "@/lib/audit";
import { moneyFail } from "@/lib/money-api";
import { withMoney, type Ctx } from "@/lib/ledger";
import { fileResponse } from "@/lib/books-export";
import { acceptCount, addCountLine, cancelCount, countDetail, fillBlankLines, removeCountLine, saveCountLines, type CountLineSave } from "@/lib/stock-counts";
import { countCsv, countSheet } from "@/lib/stock-counts-export";

type P = { params: Promise<{ id: string }> };

/** GET: the count with its lines. ?format=pdf|csv: the sheet to count on, or the result once accepted. */
export async function GET(req: Request, { params }: P) {
  const auth = await guard("accounts.view");
  if (!auth.ok) return auth.res;
  const { id } = await params;
  const format = new URL(req.url).searchParams.get("format");
  try {
    const count = await withMoney(auth.tenant.id, auth.session.userId, (ctx) => countDetail(ctx, id));
    if (format === "pdf" || format === "csv") return fileResponse(auth.db, auth.tenant.id, format, `stock-count-${count.number}`, countCsv(count), countSheet(count));
    return NextResponse.json({ count }, { headers: { "cache-control": "no-store" } });
  } catch (e) {
    return moneyFail(e);
  }
}

/**
 * POST { action }:
 *   save   { lines: [{ id, countedQty?, rate? (paise), value? (paise), note? }] }  (null clears)
 *   add    { productId, batch?, expiry?, countedQty?, rate? }
 *   remove { lineId }
 *   fill   { how: "book" | "zero" }   lines not counted yet
 *   accept                             it becomes the closing stock; a tracked count corrects the stock
 *   cancel { reason }
 */
export async function POST(req: Request, { params }: P) {
  const auth = await guard("accounts.post");
  if (!auth.ok) return auth.res;
  const { id } = await params;
  const b = ((await req.json().catch(() => null)) ?? {}) as Record<string, unknown>;
  const num = (v: unknown) => (v === undefined ? undefined : v === null || v === "" ? null : Number(v));
  const run = <T>(fn: (ctx: Ctx) => Promise<T>) => withMoney(auth.tenant.id, auth.session.userId, fn);
  try {
    switch (b.action) {
      case "save": {
        const raw = (Array.isArray(b.lines) ? b.lines : []) as Record<string, unknown>[];
        const lines: CountLineSave[] = raw.map((l) => ({
          id: String(l.id ?? ""),
          countedQty: num(l.countedQty),
          rate: num(l.rate),
          value: num(l.value),
          note: typeof l.note === "string" ? l.note : undefined,
        }));
        return NextResponse.json(await run((ctx) => saveCountLines(ctx, id, lines)));
      }
      case "add": {
        const line = await run((ctx) =>
          addCountLine(ctx, id, {
            productId: String(b.productId ?? ""),
            batch: typeof b.batch === "string" ? b.batch : null,
            expiry: typeof b.expiry === "string" && b.expiry ? b.expiry : null,
            countedQty: num(b.countedQty),
            rate: num(b.rate),
          }),
        );
        return NextResponse.json({ line: { id: line.id } }, { status: 201 });
      }
      case "remove":
        return NextResponse.json(await run((ctx) => removeCountLine(ctx, id, String(b.lineId ?? ""))));
      case "fill":
        return NextResponse.json(await run((ctx) => fillBlankLines(ctx, id, b.how === "book" ? "book" : "zero")));
      case "accept": {
        const c = await run((ctx) => acceptCount(ctx, id));
        await audit(auth.db, {
          actorId: auth.session.userId,
          action: "stockcount.accept",
          entity: "StockCount",
          entityId: id,
          after: { number: c.number, counted: Number(c.countedValue), shortage: Number(c.shortage), excess: Number(c.excess) },
          ip: requestIp(req),
        });
        return NextResponse.json({ ok: true });
      }
      case "cancel": {
        const c = await run((ctx) => cancelCount(ctx, id, String(b.reason ?? "")));
        await audit(auth.db, {
          actorId: auth.session.userId,
          action: "stockcount.cancel",
          entity: "StockCount",
          entityId: id,
          after: { number: c.number, reason: c.cancelReason },
          ip: requestIp(req),
        });
        return NextResponse.json({ ok: true });
      }
      default:
        return NextResponse.json({ error: "Action is save, add, remove, fill, accept or cancel" }, { status: 400 });
    }
  } catch (e) {
    return moneyFail(e);
  }
}
