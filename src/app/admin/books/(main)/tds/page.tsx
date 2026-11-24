import type { ReactNode } from "react";
import Link from "next/link";
import Icon from "@/components/Icon";
import { booksPage, readSearch } from "@/lib/books-page";
import { fyStart, isDay, todayIst } from "@/lib/books";
import { fyLabel, fyOf, quarterLabel, quarterOf, return26q, TDS_SOURCE_LABEL, tdsBanks, tdsOverview, tdsReceived, tdsRegister, tdsSections } from "@/lib/tds";
import { rateLabel } from "@/lib/tds-math";
import { STATUS_LABEL } from "@/lib/tds-export";
import { ErrorCard, Kpi } from "@/components/reports/Kit";
import { showDay } from "@/components/books/fmt";
import { formatINR } from "@/lib/money";
import SharePdf from "@/components/reports/SharePdf";
import { CancelWithReason, CertificateEdit, ChallanForm, SectionEditor, ShopTdsForm } from "@/components/books/TdsForms";

type SP = Record<string, string | string[] | undefined>;
const VIEWS = [
  { key: "pay", label: "Paid and due" },
  { key: "register", label: "Register" },
  { key: "26q", label: "Quarterly return" },
  { key: "received", label: "Kept back from us" },
  { key: "sections", label: "Sections" },
] as const;
type View = (typeof VIEWS)[number]["key"];
const amt = (p: number) => (p ? formatINR(p) : "–");
const plural = (n: number, w: string) => `${n} ${w}${n === 1 ? "" : "s"}`;
const STATUS_CHIP: Record<keyof typeof STATUS_LABEL, string> = { PAID: "chip chip-mint", PAID_LATE: "chip", DUE: "chip", LATE: "chip bg-[#fde4e1] text-[#a8281e]", OVER: "chip" };

/** TDS: what we kept back and paid (challans), the register, the quarterly return working, TDS kept back from us, and the sections. */
export default async function TdsPage({ searchParams }: { searchParams: Promise<SP> }) {
  const sp = readSearch(await searchParams);
  const today = todayIst();
  const vq = sp.get("view");
  const view: View = VIEWS.some((v) => v.key === vq) ? (vq as View) : "pay";
  const thisFy = fyOf(today);
  const fy = Number(sp.get("fy")) >= 2000 && Number(sp.get("fy")) <= thisFy ? Number(sp.get("fy")) : thisFy;
  const lastQ = quarterOf(today) === 1 ? { fy: thisFy - 1, q: 4 } : { fy: thisFy, q: quarterOf(today) - 1 };
  const q = [1, 2, 3, 4].includes(Number(sp.get("q"))) ? Number(sp.get("q")) : sp.get("fy") ? 1 : lastQ.q;
  const qfy = sp.get("fy") ? fy : lastQ.fy;
  const to = isDay(sp.get("to")) ? sp.get("to")! : today;
  const from = isDay(sp.get("from")) && sp.get("from")! <= to ? sp.get("from")! : fyStart(to);
  const r = await booksPage(async (ctx) => {
    if (view === "register") return { kind: "register" as const, reg: await tdsRegister(ctx, from, to) };
    if (view === "26q") return { kind: "26q" as const, q: await return26q(ctx, qfy, q) };
    if (view === "received") {
      const shops = await ctx.tx.retailerProfile.findMany({ select: { id: true, outletName: true }, orderBy: { outletName: "asc" }, take: 3000 });
      return { kind: "received" as const, rec: await tdsReceived(ctx, from, to), shops: shops.map((s) => ({ id: s.id, name: s.outletName })) };
    }
    if (view === "sections") return { kind: "sections" as const, list: await tdsSections(ctx, true) };
    const o = await tdsOverview(ctx);
    const year = fy === o.fy ? o.year : (await import("@/lib/tds")).tdsYear(ctx, fy);
    return { kind: "pay" as const, o, year: await year, banks: await tdsBanks(ctx), sections: (await tdsSections(ctx)).map((s) => ({ code: s.code, name: s.name })) };
  });
  const href = (v: View, extra: Record<string, string> = {}) => `/admin/books/tds?${new URLSearchParams({ view: v, ...extra })}`;

  return (
    <div className="space-y-4">
      <nav className="flex gap-1.5 overflow-x-auto pb-1" aria-label="TDS">
        {VIEWS.map((x) => (
          <Link
            key={x.key}
            href={href(x.key)}
            aria-current={x.key === view ? "page" : undefined}
            className={`shrink-0 rounded-full px-3 py-1 text-sm font-semibold ${x.key === view ? "bg-ink text-white" : "bg-black/5 text-foreground/70"}`}
          >
            {x.label}
          </Link>
        ))}
      </nav>

      {(view === "register" || view === "received") && (
        <form method="get" className="card p-4 flex flex-wrap items-end gap-3">
          <input type="hidden" name="view" value={view} />
          <label className="text-xs text-[var(--muted)]">
            From
            <input type="date" name="from" defaultValue={from} max={today} className="input !py-1.5 mt-1 block" />
          </label>
          <label className="text-xs text-[var(--muted)]">
            To
            <input type="date" name="to" defaultValue={to} max={today} className="input !py-1.5 mt-1 block" />
          </label>
          <button className="btn btn-mor btn-sm">Show</button>
        </form>
      )}
      {view === "pay" && (
        <div className="card p-3 flex flex-wrap items-center justify-between gap-2">
          <Link href={href("pay", { fy: String(fy - 1) })} className="btn btn-quiet btn-sm">
            ‹ FY {fyLabel(fy - 1)}
          </Link>
          <span className="font-semibold text-[var(--ink)]">FY {fyLabel(fy)}</span>
          {fy < thisFy ? (
            <Link href={href("pay", { fy: String(fy + 1) })} className="btn btn-quiet btn-sm">
              FY {fyLabel(fy + 1)} ›
            </Link>
          ) : (
            <span className="w-16" />
          )}
        </div>
      )}
      {view === "26q" && (
        <form method="get" className="card p-3 flex flex-wrap items-end gap-2">
          <input type="hidden" name="view" value="26q" />
          <label className="text-xs text-[var(--muted)]">
            Year
            <select name="fy" defaultValue={String(qfy)} className="input !py-1.5 mt-1 block">
              {Array.from({ length: 6 }, (_, i) => thisFy - i).map((y) => (
                <option key={y} value={y}>
                  FY {fyLabel(y)}
                </option>
              ))}
            </select>
          </label>
          <label className="text-xs text-[var(--muted)]">
            Quarter
            <select name="q" defaultValue={String(q)} className="input !py-1.5 mt-1 block">
              {[1, 2, 3, 4].map((x) => (
                <option key={x} value={x}>
                  Q{x} ({["Apr–Jun", "Jul–Sep", "Oct–Dec", "Jan–Mar"][x - 1]})
                </option>
              ))}
            </select>
          </label>
          <button className="btn btn-mor btn-sm">Show</button>
        </form>
      )}

      {!r.ok ? (
        <ErrorCard message={r.error} />
      ) : r.data.kind === "pay" ? (
        <Pay o={r.data.o} year={r.data.year} banks={r.data.banks} sections={r.data.sections} canPost={r.me.canPost} />
      ) : r.data.kind === "register" ? (
        <Register reg={r.data.reg} />
      ) : r.data.kind === "26q" ? (
        <Quarter q={r.data.q} />
      ) : r.data.kind === "received" ? (
        <Received rec={r.data.rec} shops={r.data.shops} canPost={r.me.canPost} />
      ) : (
        <Sections list={r.data.list} canPost={r.me.canPost} />
      )}
    </div>
  );
}

function Notes({ items }: { items: string[] }) {
  if (!items.length) return null;
  return (
    <div className="space-y-1.5">
      {items.map((w) => (
        <p key={w} className="text-sm rounded-lg bg-[#fff4e0] text-[#7a4b00] px-3 py-2">
          <Icon name="alert" className="h-4 w-4 inline -mt-0.5 mr-1" />
          {w}
        </p>
      ))}
    </div>
  );
}

function Table({ title, head, rows, empty = "Nothing in this period." }: { title: string; head: string[]; rows: ReactNode[][]; empty?: string }) {
  return (
    <section className="card p-0 overflow-hidden">
      {title && <h3 className="px-4 py-3 font-heading font-bold text-[var(--ink)]">{title}</h3>}
      {rows.length ? (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[30rem] text-sm tabular-nums">
            <thead className="text-xs text-[var(--muted)]">
              <tr className="border-t border-[var(--line)]">
                {head.map((h, i) => (
                  <th key={`${h}${i}`} className={`font-medium py-2 ${i ? "text-right px-2" : "text-left px-4"} ${i === head.length - 1 ? "pr-4" : ""}`}>
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-[var(--line)]">
              {rows.map((r, i) => (
                <tr key={i}>
                  {r.map((c, j) => (
                    <td key={j} className={`py-2 ${j ? "text-right px-2 whitespace-nowrap" : "px-4"} ${j === r.length - 1 ? "pr-4" : ""}`}>
                      {c}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <p className="px-4 pb-4 text-sm text-[var(--muted)]">{empty}</p>
      )}
    </section>
  );
}

type Overview = Awaited<ReturnType<typeof tdsOverview>>;

function Pay({ o, year, banks, sections, canPost }: { o: Overview; year: Overview["year"]; banks: Awaited<ReturnType<typeof tdsBanks>>; sections: { code: string; name: string }[]; canPost: boolean }) {
  const owing = year.groups.filter((g) => g.unpaid > 0).map((g) => ({ period: g.period, label: g.label, section: g.section, unpaid: g.unpaid, interestDue: g.interestDue }));
  const late = year.groups.filter((g) => g.status === "LATE");
  const notes: string[] = [];
  if (late.length) notes.push(`${plural(late.length, "month")} of TDS ${late.length === 1 ? "is" : "are"} past the due date and not paid: interest runs at 1.5% a month until paid.`);
  const api = `/api/admin/books/tds?view=year&fy=${year.fy}`;
  return (
    <>
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <Kpi label="Kept back this year" value={formatINR(year.totals.deducted)} sub={`FY ${year.label}`} />
        <Kpi label="Paid by challan" value={formatINR(year.totals.paid)} sub={plural(year.challans.filter((c) => !c.cancelledAt).length, "challan")} />
        <Kpi label="Still to pay" value={formatINR(year.totals.unpaid)} sub={year.totals.interestDue ? `+ about ${formatINR(year.totals.interestDue)} interest` : "No interest due"} />
        <Kpi label="TDS payable in the books" value={formatINR(o.payable)} sub={`Kept back from us: ${formatINR(o.receivable)}`} />
      </div>
      <p className="text-sm text-[var(--ink-2)]">
        {o.lastQuarter.due < o.today ? `The return for ${o.lastQuarter.label} was due ${showDay(o.lastQuarter.due)}: file it if it isn't done. ` : `Next return: ${o.lastQuarter.label}, due ${showDay(o.lastQuarter.due)}. `}
        <Link href={`/admin/books/tds?view=26q&fy=${o.lastQuarter.fy}&q=${o.lastQuarter.q}`} className="underline">
          See the working
        </Link>
        {o.lastQuarter.due < o.today && (
          <span className="block">
            Next: {o.thisQuarter.label}, due {showDay(o.thisQuarter.due)}.
          </span>
        )}
      </p>
      <Notes items={notes} />
      <div className="flex justify-end">
        <SharePdf url={api} file={`tds-paid-and-due-${year.label}`} summary={`TDS FY ${year.label}: kept back ${formatINR(year.totals.deducted)}, paid ${formatINR(year.totals.paid)}, to pay ${formatINR(year.totals.unpaid)}.`} />
      </div>
      <Table
        title="By month and section"
        empty="No TDS kept back this year."
        head={["Month", "Due by", "Kept back", "Paid", "Not paid", "Interest", ""]}
        rows={year.groups.map((g) => [
          <span key="m">
            {g.label} · {g.section}
            <span className="block text-xs text-[var(--muted)]">{plural(g.docs, "deduction")}</span>
          </span>,
          showDay(g.due),
          amt(g.deducted),
          amt(g.paid),
          amt(g.unpaid),
          g.interest ? `${formatINR(g.interest)}${g.interestPaid ? ` (paid ${formatINR(g.interestPaid)})` : ""}` : "–",
          <span key="s" className={STATUS_CHIP[g.status]}>
            {STATUS_LABEL[g.status]}
          </span>,
        ])}
      />
      {canPost && (
        <section className="card p-4 sm:p-5 space-y-3">
          <h3 className="font-heading font-bold text-[var(--ink)]">Enter a challan paid</h3>
          <ChallanForm owing={owing} sections={sections} banks={banks} />
        </section>
      )}
      <Table
        title="Challans"
        empty="No challans this year."
        head={["Challan", "Tax", "Interest + fee", ""]}
        rows={year.challans.map((c) => [
          <span key="c" className={c.cancelledAt ? "line-through text-[var(--muted)]" : ""}>
            {c.number} · {c.section} for {c.periodLabel}
            <span className="block text-xs text-[var(--muted)]">
              Paid {showDay(c.paidOn)} · BSR {c.bsrCode} · serial {c.serial}
              {c.bank ? ` · ${c.bank}` : ""}
              {c.cancelledAt ? ` · cancelled: ${c.cancelReason}` : ""}
            </span>
          </span>,
          amt(c.tax),
          amt(c.interest + c.lateFee),
          canPost && !c.cancelledAt ? <CancelWithReason key="x" url="/api/admin/books/tds/challan" id={c.id} label="Cancel" what="the challan" /> : "",
        ])}
      />
      <p className="text-xs text-[var(--muted)]">
        TDS kept back in a month is due by the 7th of the next month (March&apos;s by 30 April). Interest is 1.5% a month, or part of a month, from the day it was kept back until paid; the app works
        it out, the challan says what was paid. TDS is kept back on a supplier&apos;s bill (open the bill), when paying a supplier, or on a payment voucher.
      </p>
    </>
  );
}

type Reg = Awaited<ReturnType<typeof tdsRegister>>;

function Register({ reg }: { reg: Reg }) {
  const api = `/api/admin/books/tds?view=register&from=${reg.from}&to=${reg.to}`;
  const SHOW = 300;
  return (
    <>
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <Kpi label="TDS kept back" value={formatINR(reg.totals.tds)} sub={plural(reg.rows.length, "deduction")} />
        <Kpi label="On payments of" value={formatINR(reg.totals.base)} />
        <Kpi label="Parties" value={String(reg.byParty.length)} />
        <Kpi label="Without PAN" value={String(reg.totals.noPan)} sub={reg.totals.noPan ? "Add the PAN before the return" : "All have a PAN"} />
      </div>
      <div className="flex justify-end">
        <SharePdf url={api} file={`tds-register-${reg.from}-to-${reg.to}`} summary={`TDS kept back ${showDay(reg.from)} to ${showDay(reg.to)}: ${formatINR(reg.totals.tds)}.`} />
      </div>
      <div className="grid gap-4 lg:grid-cols-2">
        <Table title="By section" head={["Section", "Paid", "TDS"]} rows={reg.bySection.map((s) => [s.section, amt(s.base), amt(s.tds)])} />
        <Table title="By quarter" head={["Quarter", "Paid", "TDS"]} rows={reg.byQuarter.map((x) => [x.label, amt(x.base), amt(x.tds)])} />
      </div>
      <Table
        title="By party"
        head={["Party", "Paid", "TDS"]}
        rows={reg.byParty.slice(0, 50).map((p) => [
          <span key="p">
            {p.party}
            <span className="block text-xs text-[var(--muted)]">
              {p.pan ?? "No PAN"} · {plural(p.docs, "deduction")}
            </span>
          </span>,
          amt(p.base),
          amt(p.tds),
        ])}
      />
      <Table
        title={`Deductions${reg.rows.length > SHOW ? ` (first ${SHOW}; all in the PDF and CSV)` : ""}`}
        head={["Deduction", "Paid", "TDS"]}
        rows={reg.rows.slice(0, SHOW).map((d) => [
          <Link key="d" href={d.href} className="hover:underline">
            {d.party}
            <span className="block text-xs text-[var(--muted)]">
              {showDay(d.date)} · {TDS_SOURCE_LABEL[d.source]} {d.number} · {d.section} at {rateLabel(d.rate)}
              {d.pan ? "" : " · no PAN"}
            </span>
          </Link>,
          amt(d.base),
          amt(d.tds),
        ])}
      />
    </>
  );
}

type Q = Awaited<ReturnType<typeof return26q>>;

function Quarter({ q }: { q: Q }) {
  const api = `/api/admin/books/tds?view=26q&fy=${q.fy}&q=${q.q}`;
  return (
    <>
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <Kpi label="TDS kept back" value={formatINR(q.totals.tds)} sub={plural(q.rows.length, "deduction")} />
        <Kpi label="Paid by challan" value={formatINR(q.totals.paid)} sub={plural(q.challans.length, "challan")} />
        <Kpi label="On payments of" value={formatINR(q.totals.base)} />
        <Kpi label="Return due" value={showDay(q.due)} sub={quarterLabel(q.fy, q.q)} />
      </div>
      <Notes items={q.warnings} />
      <div className="flex justify-end">
        <SharePdf url={api} file={`tds-26q-${q.fy}-q${q.q}`} summary={`TDS return working ${q.label}: ${plural(q.rows.length, "deduction")}, TDS ${formatINR(q.totals.tds)}.`} />
      </div>
      <Table
        title="Challans"
        empty="No challans for this quarter's months."
        head={["Challan", "Tax", "Matched"]}
        rows={q.challans.map((c) => [
          <span key="c">
            {c.number} · {c.section}
            <span className="block text-xs text-[var(--muted)]">
              BSR {c.bsrCode} · {showDay(c.paidOn)} · serial {c.serial}
            </span>
          </span>,
          amt(c.tax),
          amt(c.used),
        ])}
      />
      <Table
        title="Deductee details"
        empty="No TDS kept back this quarter."
        head={["Deductee", "Paid", "TDS"]}
        rows={q.rows.map((r) => [
          <Link key="d" href={r.href} className="hover:underline">
            {r.party} · {r.pan ?? <span className="text-[#a8281e]">no PAN</span>}
            <span className="block text-xs text-[var(--muted)]">
              {showDay(r.date)} · {r.section} at {rateLabel(r.rate)} · {r.challan ? `challan ${r.challan.bsrCode}/${r.challan.serial} of ${showDay(r.challan.paidOn)}` : "not paid yet"}
            </span>
          </Link>,
          amt(r.base),
          amt(r.tds),
        ])}
      />
      <p className="text-xs text-[var(--muted)]">
        A working for the quarterly TDS return (26Q): the CSV has the deductee details in the order the return utility asks for them. Each deduction is matched to the challans of its month and
        section, oldest first.
      </p>
    </>
  );
}

type Rec = Awaited<ReturnType<typeof tdsReceived>>;

function Received({ rec, shops, canPost }: { rec: Rec; shops: { id: string; name: string }[]; canPost: boolean }) {
  const api = `/api/admin/books/tds?view=received&from=${rec.from}&to=${rec.to}`;
  return (
    <>
      <div className="grid grid-cols-2 lg:grid-cols-3 gap-3">
        <Kpi label="Kept back from us" value={formatINR(rec.totals.tds)} sub={plural(rec.rows.length, "entry")} />
        <Kpi label="Customers" value={String(rec.byParty.length)} />
        <Kpi label="Certificates to get" value={String(rec.totals.pending)} sub="Form 16A from the shop" />
      </div>
      {canPost && (
        <section className="card p-4 sm:p-5 space-y-3">
          <h3 className="font-heading font-bold text-[var(--ink)]">A shop kept back TDS</h3>
          <ShopTdsForm shops={shops} />
        </section>
      )}
      <div className="flex justify-end">
        <SharePdf url={api} file={`tds-by-customers-${rec.from}-to-${rec.to}`} summary={`TDS kept back by customers ${showDay(rec.from)} to ${showDay(rec.to)}: ${formatINR(rec.totals.tds)}.`} />
      </div>
      <Table
        title="By customer"
        head={["Customer", "Entries", "TDS"]}
        rows={rec.byParty.map((p) => [
          <span key="p">
            {p.party}
            <span className="block text-xs text-[var(--muted)]">
              {p.pan ?? "No PAN"}
              {p.pending ? ` · ${plural(p.pending, "certificate")} to get` : ""}
            </span>
          </span>,
          String(p.docs),
          amt(p.tds),
        ])}
      />
      <Table
        title="Entries"
        head={["Entry", "TDS"]}
        rows={rec.rows.map((x) => [
          <span key="e">
            <Link href={x.href} className="hover:underline">
              {x.party}
            </Link>
            <span className="block text-xs text-[var(--muted)]">
              {showDay(x.date)} · {x.number} · {x.section} ·{" "}
              {x.source === "SHOP" && canPost ? <CertificateEdit id={x.id} current={x.certificate} /> : x.certificate ? `certificate ${x.certificate}` : "no certificate"}
            </span>
          </span>,
          amt(x.tds),
        ])}
      />
      <p className="text-xs text-[var(--muted)]">
        TDS a shop or customer kept back settles their bills like a payment, and is claimed in our income tax return. Check it against Form 26AS before the return. A receipt voucher can also record TDS
        kept back by other payers.
      </p>
    </>
  );
}

function Sections({ list, canPost }: { list: Awaited<ReturnType<typeof tdsSections>>; canPost: boolean }) {
  return (
    <>
      <p className="text-sm text-[var(--ink-2)]">
        The rates and limits the app uses to work out TDS. Starter rates are for FY 2025-26: ask the CA to check them, and change them here when the law changes.
      </p>
      {canPost && <SectionEditor s={null} />}
      <Table
        title="Sections"
        head={["Section", "Individual", "Others", "No PAN", "Limits", ""]}
        rows={list.map((s) => [
          <span key="s" className={s.active ? "" : "text-[var(--muted)]"}>
            <span className="font-semibold">{s.code}</span> · {s.name}
            {!s.active && " (not in use)"}
            {s.note && <span className="block text-xs text-[var(--muted)] whitespace-normal">{s.note}</span>}
          </span>,
          rateLabel(s.rateInd),
          rateLabel(s.rateOther),
          rateLabel(s.rateNoPan),
          <span key="l" className="text-xs">
            {s.single !== null ? `${formatINR(s.single, { whole: true })} at a time` : ""}
            {s.single !== null && s.yearly !== null ? " · " : ""}
            {s.yearly !== null ? `${formatINR(s.yearly, { whole: true })} a year${s.overOnly ? " (above only)" : ""}` : ""}
            {s.single === null && s.yearly === null ? "None" : ""}
          </span>,
          canPost ? <SectionEditor key="e" s={s} /> : "",
        ])}
      />
    </>
  );
}
