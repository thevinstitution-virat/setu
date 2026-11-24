import type { ReactNode } from "react";
import Link from "next/link";
import Icon from "@/components/Icon";
import { booksPage, readSearch } from "@/lib/books-page";
import { fyStart, isDay, todayIst } from "@/lib/books";
import { gstMonth, gstSettlements, INWARD_LABEL, itcRegister, match2b, type MatchRow } from "@/lib/gst-returns";
import { workingLines } from "@/lib/gst-returns-export";
import { headsTotal, isPeriod, periodLabel, periodOf, shiftPeriod, usedTotal } from "@/lib/gst-math";
import { ErrorCard, Kpi } from "@/components/reports/Kit";
import { showDay } from "@/components/books/fmt";
import { formatINR } from "@/lib/money";
import SharePdf from "@/components/reports/SharePdf";
import GstSettleForm from "@/components/books/GstSettleForm";
import { CancelGst, Upload2b } from "@/components/books/GstActions";

type SP = Record<string, string | string[] | undefined>;
const VIEWS = [
  { key: "3b", label: "GSTR-3B and payment" },
  { key: "itc", label: "Input credit" },
  { key: "2b", label: "GSTR-2B match" },
] as const;
type View = (typeof VIEWS)[number]["key"];
const amt = (p: number) => (p ? (p < 0 ? `(${formatINR(-p)})` : formatINR(p)) : "–");
const docs = (n: number) => `${n} document${n === 1 ? "" : "s"}`;
const short = (p: string) => new Date(`${p}-01T00:00:00Z`).toLocaleDateString("en-IN", { month: "short", year: "numeric", timeZone: "UTC" });

/** GST: the month's GSTR-3B working with its set-off and payment, the input credit register, and the GSTR-2B match. */
export default async function GstPage({ searchParams }: { searchParams: Promise<SP> }) {
  const sp = readSearch(await searchParams);
  const today = todayIst();
  const vq = sp.get("view");
  const view: View = vq === "itc" || vq === "2b" ? vq : "3b";
  const lastMonth = shiftPeriod(periodOf(today), -1);
  const period = isPeriod(sp.get("period")) && sp.get("period")! <= periodOf(today) ? sp.get("period")! : lastMonth;
  const to = isDay(sp.get("to")) ? sp.get("to")! : today;
  const from = isDay(sp.get("from")) && sp.get("from")! <= to ? sp.get("from")! : fyStart(to);
  const r = await booksPage(async (ctx) => {
    if (view === "itc") return { kind: "itc" as const, reg: await itcRegister(ctx, from, to) };
    if (view === "2b") return { kind: "2b" as const, m: await match2b(ctx, period) };
    return { kind: "3b" as const, m: await gstMonth(ctx, period), list: await gstSettlements(ctx, 13) };
  });
  const href = (v: View, extra: Record<string, string> = {}) => `/admin/books/gst?${new URLSearchParams({ view: v, ...(v === "itc" ? { from, to } : { period }), ...extra })}`;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <nav className="flex gap-1.5 overflow-x-auto pb-1" aria-label="GST">
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
        <Link href="/admin/invoices" className="btn btn-outline btn-sm">
          <Icon name="file" className="h-4 w-4" /> GSTR-1 file
        </Link>
      </div>

      {view === "itc" ? (
        <form method="get" className="card p-4 flex flex-wrap items-end gap-3">
          <input type="hidden" name="view" value="itc" />
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
      ) : (
        <div className="card p-3 flex items-center justify-between gap-2">
          <Link href={href(view, { period: shiftPeriod(period, -1) })} className="btn btn-quiet btn-sm" aria-label="Month before">
            ‹ {short(shiftPeriod(period, -1))}
          </Link>
          <form method="get" className="flex items-center gap-2">
            <input type="hidden" name="view" value={view} />
            <input type="month" name="period" defaultValue={period} max={periodOf(today)} className="input !py-1.5 w-[9.5rem]" aria-label="Month" />
            <button className="btn btn-mor btn-sm">Show</button>
          </form>
          {period < periodOf(today) ? (
            <Link href={href(view, { period: shiftPeriod(period, 1) })} className="btn btn-quiet btn-sm" aria-label="Month after">
              {short(shiftPeriod(period, 1))} ›
            </Link>
          ) : (
            <span className="w-16" />
          )}
        </div>
      )}

      {!r.ok ? (
        <ErrorCard message={r.error} />
      ) : r.data.kind === "3b" ? (
        <ThreeB m={r.data.m} list={r.data.list} canPost={r.me.canPost} />
      ) : r.data.kind === "itc" ? (
        <Itc reg={r.data.reg} />
      ) : (
        <Match m={r.data.m} canPost={r.me.canPost} />
      )}
    </div>
  );
}

type Month = Awaited<ReturnType<typeof gstMonth>>;

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

function ThreeB({ m, list, canPost }: { m: Month; list: Awaited<ReturnType<typeof gstSettlements>>; canPost: boolean }) {
  const w = m.working;
  const s = m.setOff;
  const tax = headsTotal(s.liab) + headsTotal(s.rcm);
  const api = `/api/admin/books/gst?view=3b&period=${w.period}`;
  const notes = [...w.warnings];
  if (m.settled?.changed)
    notes.unshift(
      "Documents of this month were entered, changed or cancelled after it was settled: the figures below are as settled. Cancel the settlement and settle again if the return is revised.",
    );
  return (
    <>
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <Kpi label="Tax payable" value={formatINR(tax)} sub={headsTotal(s.rcm) ? `incl. ${formatINR(headsTotal(s.rcm))} reverse charge` : "Output tax less credit notes"} />
        <Kpi label="Input credit of the month" value={formatINR(headsTotal(w.itc.net))} sub={`Brought forward ${formatINR(headsTotal(m.opening))}`} />
        <Kpi label="Paid from credit" value={formatINR(usedTotal(s.use))} sub={`Carried forward ${formatINR(headsTotal(s.close))}`} />
        <Kpi label={m.settled ? "Paid in cash" : "Cash to pay"} value={formatINR(headsTotal(s.cash))} sub={m.settled ? `On ${showDay(m.settled.paidOn)}` : "From a bank, by challan"} />
      </div>

      <section className="card p-4 sm:p-5 space-y-3">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div>
            <p className="page-kick">
              {showDay(w.from)} to {showDay(w.to)}
            </p>
            <h2 className="font-heading text-xl font-bold text-[var(--ink)]">{w.label}</h2>
          </div>
          {m.settled ? <span className="chip chip-mint">Settled</span> : <span className="chip">Not settled</span>}
        </div>
        {m.settled ? (
          <>
            <p className="text-sm text-[var(--ink-2)]">
              Paid {showDay(m.settled.paidOn)}
              {m.settled.bank ? ` from ${m.settled.bank}` : ""}
              {m.settled.challan ? `, challan ${m.settled.challan}` : ""}
              {m.settled.arn ? `, ARN ${m.settled.arn}` : ""}.
            </p>
            {canPost && <CancelGst id={m.settled.id} label={w.label} />}
          </>
        ) : m.blocked ? (
          <p className="text-sm text-[#7a4b00]">{m.blocked}</p>
        ) : !m.over ? (
          <p className="text-sm text-[var(--muted)]">The month is not over yet: these are the figures so far. Settle it once the return is filed (by the 20th of next month).</p>
        ) : canPost ? (
          <GstSettleForm
            period={w.period}
            label={w.label}
            from={w.from}
            liab={w.liab}
            rcm={w.rcm}
            itc={w.itc.net}
            opening={m.opening}
            askOpening={m.openingFrom !== "previous"}
            inputAtStart={m.inputAtStart}
            banks={m.banks}
          />
        ) : (
          <p className="text-sm text-[var(--muted)]">The accountant or the owner settles the month.</p>
        )}
      </section>

      <Notes items={notes} />
      <div className="flex justify-end">
        <SharePdf
          url={api}
          file={`gstr-3b-working-${w.period}`}
          summary={`GSTR-3B ${w.label}: tax ${formatINR(tax)}, from credit ${formatINR(usedTotal(s.use))}, in cash ${formatINR(headsTotal(s.cash))}.`}
        />
      </div>

      <section className="card p-0 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[34rem] text-sm tabular-nums">
            <thead className="text-xs text-[var(--muted)]">
              <tr>
                <th className="text-left font-medium px-4 py-2"></th>
                <th className="text-right font-medium px-2 py-2">Taxable</th>
                <th className="text-right font-medium px-2 py-2">IGST</th>
                <th className="text-right font-medium px-2 py-2">CGST</th>
                <th className="text-right font-medium px-4 py-2">SGST</th>
              </tr>
            </thead>
            <tbody>
              {workingLines(m).map((l, i) =>
                l.kind === "group" ? (
                  <tr key={i} className="border-t border-[var(--line)] bg-black/[0.03]">
                    <td colSpan={5} className="px-4 py-2 text-xs font-bold text-[var(--ink-2)]">
                      {l.label}
                    </td>
                  </tr>
                ) : (
                  <tr key={i} className={`border-t border-[var(--line)] ${l.kind === "row" ? "" : "font-semibold"} ${l.kind === "total" ? "bg-[#fff4e0]/60" : ""}`}>
                    <td className="px-4 py-1.5 whitespace-pre-wrap text-[var(--ink-2)]">{l.label}</td>
                    <td className="px-2 py-1.5 text-right whitespace-nowrap">{l.taxable === null ? "" : amt(l.taxable)}</td>
                    <td className="px-2 py-1.5 text-right whitespace-nowrap">{amt(l.h.igst)}</td>
                    <td className="px-2 py-1.5 text-right whitespace-nowrap">{amt(l.h.cgst)}</td>
                    <td className="px-4 py-1.5 text-right whitespace-nowrap">{amt(l.h.sgst)}</td>
                  </tr>
                ),
              )}
            </tbody>
          </table>
        </div>
      </section>
      <p className="text-xs text-[var(--muted)]">
        From {w.counts.invoices} invoices and {w.counts.notes} notes issued; {w.counts.bills} purchase bills ({w.counts.rcmBills} reverse charge), {w.counts.purchaseNotes} purchase notes and{" "}
        {w.counts.vouchers} expense vouchers with GST. Input credit is set off in the legal order: IGST first (IGST, then CGST and SGST), then CGST (CGST, then IGST) and SGST (SGST, then IGST);
        reverse charge is paid in cash.
      </p>

      {list.length > 0 && (
        <section className="card p-0 overflow-hidden">
          <h3 className="px-4 py-3 font-heading font-bold text-[var(--ink)]">Settled months</h3>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[30rem] text-sm tabular-nums">
              <thead className="text-xs text-[var(--muted)]">
                <tr className="border-t border-[var(--line)]">
                  <th className="text-left font-medium px-4 py-2">Month</th>
                  <th className="text-right font-medium px-2 py-2">Tax</th>
                  <th className="text-right font-medium px-2 py-2">From credit</th>
                  <th className="text-right font-medium px-2 py-2">Cash</th>
                  <th className="text-left font-medium px-4 py-2">Paid</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[var(--line)]">
                {list.map((x) => (
                  <tr key={x.id}>
                    <td className="px-4 py-2 whitespace-nowrap">
                      <Link href={`/admin/books/gst?view=3b&period=${x.period}`} className="hover:underline">
                        {x.label}
                      </Link>
                    </td>
                    <td className="px-2 py-2 text-right whitespace-nowrap">{formatINR(x.liab)}</td>
                    <td className="px-2 py-2 text-right whitespace-nowrap">{formatINR(x.used)}</td>
                    <td className="px-2 py-2 text-right whitespace-nowrap">{formatINR(x.cash)}</td>
                    <td className="px-4 py-2 whitespace-nowrap text-[var(--ink-2)]">
                      {showDay(x.paidOn)}
                      {x.challan ? ` · ${x.challan}` : ""}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}
    </>
  );
}

type Reg = Awaited<ReturnType<typeof itcRegister>>;

function Itc({ reg }: { reg: Reg }) {
  const t = reg.totals;
  const api = `/api/admin/books/gst?view=itc&from=${reg.from}&to=${reg.to}`;
  const SHOW = 200;
  return (
    <>
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <Kpi label="Input credit" value={formatINR(t.igst + t.cgst + t.sgst)} sub={docs(reg.docs.length)} />
        <Kpi label="IGST" value={formatINR(t.igst)} />
        <Kpi label="CGST + SGST" value={formatINR(t.cgst + t.sgst)} />
        <Kpi label="Not claimable" value={formatINR(t.ineligible)} sub="Tax on lines marked no credit" />
      </div>
      <div className="flex justify-end">
        <SharePdf url={api} file={`input-credit-${reg.from}-to-${reg.to}`} summary={`Input credit ${showDay(reg.from)} to ${showDay(reg.to)}: ${formatINR(t.igst + t.cgst + t.sgst)}.`} />
      </div>
      <div className="grid gap-4 lg:grid-cols-2">
        <Table
          title="By month"
          head={["Month", "Taxable", "IGST", "CGST", "SGST"]}
          rows={reg.byMonth.map((m) => [
            <Link key="m" href={`/admin/books/gst?view=3b&period=${m.period}`} className="hover:underline">
              {m.label}
            </Link>,
            amt(m.taxable),
            amt(m.igst),
            amt(m.cgst),
            amt(m.sgst),
          ])}
        />
        <Table
          title="By GST rate"
          head={["Rate", "Taxable", "IGST", "CGST", "SGST"]}
          rows={reg.byRate.map((x) => [x.rate === null ? "Vouchers" : `${x.rate}%`, amt(x.taxable), amt(x.igst), amt(x.cgst), amt(x.sgst)])}
        />
      </div>
      <Table
        title="By supplier"
        head={["Supplier", "Taxable", "IGST", "CGST", "SGST"]}
        rows={reg.bySupplier.slice(0, 30).map((x) => [
          <span key="s">
            {x.party || "–"}
            <span className="block text-xs text-[var(--muted)]">
              {x.gstin ?? "No GSTIN"} · {docs(x.docs)}
            </span>
          </span>,
          amt(x.taxable),
          amt(x.igst),
          amt(x.cgst),
          amt(x.sgst),
        ])}
      />
      <Table
        title={`Documents${reg.docs.length > SHOW ? ` (first ${SHOW}; all in the PDF and CSV)` : ""}`}
        head={["Document", "Taxable", "IGST", "CGST", "SGST"]}
        rows={reg.docs.slice(0, SHOW).map((d) => [
          <Link key="d" href={d.href} className="hover:underline">
            {d.party || "–"}
            <span className="block text-xs text-[var(--muted)]">
              {showDay(d.date)} · {INWARD_LABEL[d.src]} {d.ref || d.number}
              {d.rcm ? " · reverse charge" : ""}
              {d.ineligible ? ` · ${formatINR(d.ineligible)} not claimable` : ""}
            </span>
          </Link>,
          amt(d.taxable),
          amt(d.igst),
          amt(d.cgst),
          amt(d.sgst),
        ])}
      />
    </>
  );
}

function Table({ title, head, rows }: { title: string; head: string[]; rows: ReactNode[][] }) {
  return (
    <section className="card p-0 overflow-hidden">
      {title && <h3 className="px-4 py-3 font-heading font-bold text-[var(--ink)]">{title}</h3>}
      {rows.length ? (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[30rem] text-sm tabular-nums">
            <thead className="text-xs text-[var(--muted)]">
              <tr className="border-t border-[var(--line)]">
                {head.map((h, i) => (
                  <th key={h} className={`font-medium py-2 ${i ? "text-right px-2" : "text-left px-4"} ${i === head.length - 1 ? "pr-4" : ""}`}>
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
        <p className="px-4 pb-4 text-sm text-[var(--muted)]">Nothing in this period.</p>
      )}
    </section>
  );
}

type M2b = Awaited<ReturnType<typeof match2b>>;

function Match({ m, canPost }: { m: M2b; canPost: boolean }) {
  const row = (x: MatchRow, extra?: string) => {
    const o = x.ours;
    const t = x.theirs;
    return [
      <span key="w">
        {o ? (
          <Link href={o.href} className="hover:underline">
            {o.party}
          </Link>
        ) : (
          (t?.name ?? "–")
        )}
        <span className="block text-xs text-[var(--muted)]">
          {o?.gstin || t?.gstin} · {o?.ref ?? t?.number}
          {o ? ` · ${showDay(o.date)}` : t?.date ? ` · ${showDay(t.date)}` : ""}
          {extra ? ` · ${extra}` : ""}
        </span>
      </span>,
      o ? amt(o.tax) : "",
      t ? amt(t.tax) : "",
      o ? amt(o.itc) : "",
    ];
  };
  return (
    <>
      <section className="card p-4 sm:p-5 space-y-3">
        <div>
          <h2 className="font-heading text-lg font-bold text-[var(--ink)]">GSTR-2B for {m.label}</h2>
          <p className="text-sm text-[var(--ink-2)]">
            {m.upload
              ? `${m.upload.fileName}: ${docs(m.upload.rows)}, uploaded ${new Date(m.upload.at).toLocaleString("en-IN", { timeZone: "Asia/Kolkata", dateStyle: "medium", timeStyle: "short" })}.`
              : "Not uploaded yet. Download it from the GST portal (Returns → GSTR-2B → Download JSON or Excel) and upload it here."}
          </p>
        </div>
        {canPost && <Upload2b period={m.period} label={short(m.period)} has={!!m.upload} />}
        {m.uploads.length > 0 && <p className="text-xs text-[var(--muted)]">Uploaded months: {m.uploads.map((u) => short(u.period)).join(", ")}. A bill shown in any of them counts as found.</p>}
      </section>
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <Kpi label="Matched credit" value={formatINR(m.totals.matchedItc)} sub={docs(m.matched.length)} />
        <Kpi label="Amounts differ" value={formatINR(m.totals.differentItc)} sub={docs(m.different.length)} />
        <Kpi label="Credit at risk" value={formatINR(m.totals.atRisk)} sub={`${m.missing.length} of our bill${m.missing.length === 1 ? "" : "s"} not in 2B`} />
        <Kpi label="In 2B, not in our books" value={formatINR(m.totals.notInBooksTax)} sub={docs(m.notInBooks.length)} />
      </div>
      {m.upload && (
        <div className="flex justify-end">
          <a className="btn btn-outline btn-sm" href={`/api/admin/books/gst?view=2b&period=${m.period}&format=csv`}>
            <Icon name="download" className="h-4 w-4" /> CSV
          </a>
        </div>
      )}
      {m.noCredit.length > 0 && <Notes items={[`The portal marks ${docs(m.noCredit.length)} we matched as credit not available: check them before claiming.`]} />}
      <Table
        title="Amounts differ"
        head={["Supplier · their number", "Tax (ours)", "Tax (2B)", "Credit"]}
        rows={m.different.map((x) => row(x, `taxable differs by ${formatINR(Math.abs(x.diff?.taxable ?? 0))}`))}
      />
      <Table
        title={`Our bills not in any 2B (from ${showDay(m.windowFrom)})`}
        head={["Supplier · their number", "Tax (ours)", "Tax (2B)", "Credit"]}
        rows={m.missing.map((x) => row(x, x.noGstin ? "supplier has no GSTIN" : x.earlier ? "earlier month" : x.ours.rcm ? "reverse charge" : undefined))}
      />
      <Table
        title="In 2B, not in our books"
        head={["Supplier · their number", "Tax (ours)", "Tax (2B)", "Credit"]}
        rows={m.notInBooks.map((x) => row(x, x.theirs && !x.theirs.itcAvailable ? "credit not available" : undefined))}
      />
      <details className="card p-0 overflow-hidden">
        <summary className="px-4 py-3 font-heading font-bold text-[var(--ink)] cursor-pointer">Matched ({m.matched.length})</summary>
        <Table title="" head={["Supplier · their number", "Tax (ours)", "Tax (2B)", "Credit"]} rows={m.matched.map((x) => row(x))} />
      </details>
      <p className="text-xs text-[var(--muted)]">
        Matched on the supplier&apos;s GSTIN and their bill or note number (spaces, signs and leading zeros ignored), nearest date first; amounts within ₹1 count as the same. Our bills before{" "}
        {periodLabel(periodOf(m.windowFrom))} are not checked.
      </p>
    </>
  );
}
