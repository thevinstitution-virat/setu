import Link from "next/link";
import { getSession } from "@/lib/auth";
import { getDb } from "@/lib/tenant";
import { istDayStart } from "@/lib/gst";
import InvoiceList, { dueByNumber } from "@/components/InvoiceList";
import type { Prisma } from "@/generated/prisma/client";

const PER_PAGE = 50;
const MONTH = /^\d{4}-(0[1-9]|1[0-2])$/;

/** "2026-11" for now in India, and the five months before it. */
function recentMonths() {
  const now = new Date(Date.now() + 5.5 * 3_600_000);
  const out: { key: string; label: string }[] = [];
  for (let i = 0; i < 6; i++) {
    const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - i, 1));
    out.push({
      key: d.toISOString().slice(0, 7),
      label: d.toLocaleDateString("en-IN", { month: "short", year: i === 0 || d.getUTCMonth() === 11 ? "numeric" : undefined, timeZone: "UTC" }),
    });
  }
  return out;
}

export default async function RetailerInvoices({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const db = await getDb();
  const session = await getSession();
  const sp = await searchParams;
  const month = typeof sp.month === "string" && MONTH.test(sp.month) ? sp.month : null;
  const page = Math.max(1, Math.min(1000, Number(sp.page) || 1));
  const profile = await db.retailerProfile.findUnique({ where: { userId: session!.userId }, select: { id: true } });

  const where: Prisma.InvoiceWhereInput = { retailerId: profile?.id ?? "-" };
  if (month) {
    const [y, m] = month.split("-").map(Number);
    const next = new Date(Date.UTC(y, m, 1)).toISOString().slice(0, 10);
    where.date = { gte: istDayStart(`${month}-01`), lt: istDayStart(next) };
  }

  const [rows, count] = await Promise.all([
    db.invoice.findMany({
      where,
      orderBy: [{ date: "desc" }, { number: "desc" }],
      skip: (page - 1) * PER_PAGE,
      take: PER_PAGE,
      select: {
        id: true,
        type: true,
        number: true,
        date: true,
        total: true,
        order: { select: { orderNumber: true } },
        original: { select: { number: true } },
      },
    }),
    db.invoice.count({ where }),
  ]);
  const due = await dueByNumber(db, rows.map((r) => r.number));
  const pages = Math.max(1, Math.ceil(count / PER_PAGE));
  const href = (m: string | null, p = 1) => {
    const q = new URLSearchParams();
    if (m) q.set("month", m);
    if (p > 1) q.set("page", String(p));
    const s = q.toString();
    return `/retailer/invoices${s ? `?${s}` : ""}`;
  };
  const chip = (on: boolean) =>
    `shrink-0 rounded-full px-3 py-1.5 text-sm font-semibold whitespace-nowrap ${on ? "bg-gradient-to-br from-mor to-[#0c3634] text-white" : "bg-black/5 text-[var(--ink-2)]"}`;

  return (
    <div className="space-y-4">
      <div>
        <p className="page-kick">Money</p>
        <h1 className="page-title">My invoices</h1>
        <p className="page-sub">Your GST invoices, and credit or debit notes that change them.</p>
      </div>

      <nav className="flex gap-2 overflow-x-auto pb-1 -mx-4 px-4 [scrollbar-width:none]" aria-label="Month">
        <Link href={href(null)} className={chip(!month)} aria-current={!month ? "page" : undefined}>
          All
        </Link>
        {recentMonths().map((m) => (
          <Link key={m.key} href={href(m.key)} className={chip(month === m.key)} aria-current={month === m.key ? "page" : undefined}>
            {m.label}
          </Link>
        ))}
      </nav>

      <InvoiceList
        rows={rows.map((r) => ({ ...r, due: due.get(r.number) ?? null }))}
        hrefBase="/retailer/invoices"
        empty={month ? "No invoices in this month." : "No invoices yet. You get one when an order is sent out."}
      />

      {pages > 1 && (
        <div className="flex items-center justify-between gap-2 text-sm">
          {page > 1 ? (
            <Link className="btn btn-outline btn-sm" href={href(month, page - 1)}>
              Newer
            </Link>
          ) : (
            <span />
          )}
          <span className="text-[var(--muted)]">
            Page {page} of {pages}
          </span>
          {page < pages ? (
            <Link className="btn btn-outline btn-sm" href={href(month, page + 1)}>
              Older
            </Link>
          ) : (
            <span />
          )}
        </div>
      )}

      <p className="text-xs text-[var(--muted)]">
        What you owe in total is in your <Link href="/retailer/khata" className="font-semibold text-[var(--kesar-text)]">khata</Link>.
      </p>
    </div>
  );
}
