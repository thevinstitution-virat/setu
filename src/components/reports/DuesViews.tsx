import Link from "next/link";
import { formatINR } from "@/lib/money";
import { COLLECTION_METHODS, METHOD_LABEL, UNSPLIT, count, historyText, shortDate, type AgentBlock, type CollectionRow, type CompanyBlock, type DueBill, type PartyBlock, type Totals } from "@/lib/dues-reports";
import { Empty } from "@/components/reports/Kit";

/** The outstanding / collection reports on screen (server-safe: no hooks). */

const inr = (p: number) => formatINR(p);
const plain = (p: number) => formatINR(p, { symbol: false });
const khata = (id: string) => `/admin/khata/${id}`;
const num = "text-right tabular-nums whitespace-nowrap";
const th = "px-3 py-2 font-semibold whitespace-nowrap";
const td = "px-3 py-2";

function Late({ days }: { days: number }) {
  if (!days) return <span className="text-[var(--muted)]">–</span>;
  return <span className={days > 30 ? "font-semibold text-[#a8281e]" : days > 15 ? "text-[var(--kesar-text)]" : ""}>{days}</span>;
}

export function BillsTable({ bills, totals }: { bills: DueBill[]; totals: Totals }) {
  if (!bills.length) return <Empty>No open bills for these filters.</Empty>;
  return (
    <div className="card overflow-x-auto">
      <table className="w-full text-sm min-w-[920px]">
        <thead>
          <tr className="text-xs text-[var(--muted)] border-b border-[var(--line)] text-left">
            <th className={th}>Bill no.</th>
            <th className={th}>Date</th>
            <th className={th}>Party</th>
            <th className={th}>Area</th>
            <th className={th}>Salesman</th>
            <th className={`${th} text-right`}>Bill value</th>
            <th className={`${th} text-right`}>Received</th>
            <th className={`${th} text-right`}>Balance</th>
            <th className={th}>Due</th>
            <th className={`${th} text-right`}>Days over</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-[var(--line)]">
          {bills.map((b) => (
            <tr key={b.id} className="hover:bg-black/[0.02]">
              <td className={`${td} font-medium text-[var(--ink)] whitespace-nowrap`}>{b.number}</td>
              <td className={`${td} whitespace-nowrap`}>{shortDate(b.date)}</td>
              <td className={td}>
                <Link href={khata(b.shop.id)} className="hover:text-[var(--kesar-text)]">
                  {b.shop.outletName}
                </Link>
              </td>
              <td className={td}>{b.shop.area}</td>
              <td className={td}>{b.salesman?.name ?? <span className="text-[var(--muted)]">–</span>}</td>
              <td className={`${td} ${num}`}>{plain(b.amount)}</td>
              <td className={`${td} ${num}`}>{b.received ? plain(b.received) : "–"}</td>
              <td className={`${td} ${num} font-semibold text-[var(--ink)]`}>{plain(b.balance)}</td>
              <td className={`${td} whitespace-nowrap`}>{shortDate(b.dueDate)}</td>
              <td className={`${td} ${num}`}>
                <Late days={b.overdueDays} />
              </td>
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr className="border-t-2 border-[var(--ink)] font-semibold text-[var(--ink)]">
            <td className={td} colSpan={5}>
              {count(bills.length, "bill")}
            </td>
            <td className={`${td} ${num}`}>{plain(totals.amount)}</td>
            <td className={`${td} ${num}`}>{plain(totals.received)}</td>
            <td className={`${td} ${num}`}>{plain(totals.balance)}</td>
            <td className={td} colSpan={2} />
          </tr>
        </tfoot>
      </table>
    </div>
  );
}

function Party({ p, showLate }: { p: PartyBlock; showLate?: boolean }) {
  const s = p.shop;
  const phones = [s.phone, s.altPhone].filter(Boolean).join(" / ");
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <div>
          <Link href={khata(s.id)} className="font-heading font-bold text-[var(--ink)] hover:text-[var(--kesar-text)]">
            {s.outletName}
          </Link>
          <span className="text-sm text-[var(--muted)]"> · {s.area}</span>
        </div>
        <p className="text-sm tabular-nums">
          <span className="font-bold text-[var(--ink)]">{inr(p.totals.balance)}</span>
          {p.advance > 0 && <span className="ml-2 text-[var(--muted)]">(advance −{plain(p.advance)})</span>}
        </p>
      </div>
      <p className="text-xs text-[var(--muted)]">
        {[s.address, phones && `Ph ${phones}`, s.contactName && `Contact: ${s.contactName}`].filter(Boolean).join(" · ")}
        {" · "}
        {p.lastReceipt ? (
          <>
            Last receipt <b className="text-[var(--ink)]">{inr(p.lastReceipt.amount)}</b> on {shortDate(p.lastReceipt.date)} ({count(p.lastReceipt.daysAgo, "day")} ago)
          </>
        ) : (
          "No receipt yet"
        )}
      </p>
      <div className="overflow-x-auto -mx-4">
        <table className="w-full text-sm min-w-[640px]">
          <thead>
            <tr className="text-xs text-[var(--muted)] border-b border-[var(--line)] text-left">
              <th className={th}>Bill no.</th>
              <th className={th}>Date</th>
              <th className={`${th} text-right`}>Bill value</th>
              <th className={`${th} text-right`}>Received</th>
              <th className={`${th} text-right`}>Balance</th>
              <th className={`${th} text-right`}>{showLate ? "Days over" : "Days"}</th>
              {!showLate && <th className={th}>Collections on this bill</th>}
            </tr>
          </thead>
          <tbody className="divide-y divide-[var(--line)]">
            {p.bills.map((b) => (
              <tr key={b.id}>
                <td className={`${td} font-medium text-[var(--ink)] whitespace-nowrap`}>{b.number}</td>
                <td className={`${td} whitespace-nowrap`}>{shortDate(b.date)}</td>
                <td className={`${td} ${num}`}>{plain(b.amount)}</td>
                <td className={`${td} ${num}`}>{b.received ? plain(b.received) : "–"}</td>
                <td className={`${td} ${num} font-semibold text-[var(--ink)]`}>{plain(b.balance)}</td>
                <td className={`${td} ${num}`}>{showLate ? <Late days={b.overdueDays} /> : b.age}</td>
                {!showLate && <td className={`${td} text-xs text-[var(--muted)]`}>{historyText(b.collections, plain) || "–"}</td>}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export function PartyBlocks({ parties }: { parties: PartyBlock[] }) {
  if (!parties.length) return <Empty>No open bills for these filters.</Empty>;
  return (
    <div className="space-y-3">
      {parties.map((p) => (
        <section key={p.shop.id} className="card p-4">
          <Party p={p} />
        </section>
      ))}
    </div>
  );
}

export function AgentBlocks({ agents }: { agents: AgentBlock[] }) {
  if (!agents.length) return <Empty>No open bills for these filters.</Empty>;
  return (
    <div className="space-y-4">
      {agents.map((a) => (
        <section key={a.salesman?.id ?? "none"} className="card p-4 space-y-4">
          <div className="flex flex-wrap items-baseline justify-between gap-2 border-b border-[var(--line)] pb-2">
            <h2 className="font-heading text-lg font-bold text-[var(--ink)]">{a.salesman?.name ?? "No salesman"}</h2>
            <p className="text-sm tabular-nums">
              {count(a.parties.length, "party", "parties")} · <span className="font-bold text-[var(--ink)]">{inr(a.totals.balance)}</span>
              {a.advance > 0 && <span className="ml-2 text-[var(--muted)]">(advance −{plain(a.advance)})</span>}
            </p>
          </div>
          {a.parties.map((p) => (
            <Party key={p.shop.id} p={p} showLate />
          ))}
        </section>
      ))}
    </div>
  );
}

export function CompanyBlocks({ companies, totals }: { companies: CompanyBlock[]; totals: Totals }) {
  if (!companies.length) return <Empty>No open bills for these filters.</Empty>;
  return (
    <div className="space-y-4">
      <section className="card overflow-x-auto">
        <table className="w-full text-sm min-w-[560px]">
          <thead>
            <tr className="text-xs text-[var(--muted)] border-b border-[var(--line)] text-left">
              <th className={th}>Company</th>
              <th className={`${th} text-right`}>Bills</th>
              <th className={`${th} text-right`}>Parties</th>
              <th className={`${th} text-right`}>Share billed</th>
              <th className={`${th} text-right`}>Balance</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-[var(--line)]">
            {companies.map((c) => (
              <tr key={c.key}>
                <td className={td}>
                  <a href={`#co-${c.key}`} className="font-medium text-[var(--ink)] hover:text-[var(--kesar-text)]">
                    {c.company}
                  </a>
                </td>
                <td className={`${td} ${num}`}>{c.rows.length}</td>
                <td className={`${td} ${num}`}>{c.parties}</td>
                <td className={`${td} ${num}`}>{plain(c.totals.amount)}</td>
                <td className={`${td} ${num} font-semibold text-[var(--ink)]`}>{plain(c.totals.balance)}</td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr className="border-t-2 border-[var(--ink)] font-semibold text-[var(--ink)]">
              <td className={td}>{count(companies.filter((c) => c.companyId).length, "company", "companies")}</td>
              <td className={td} colSpan={2} />
              <td className={`${td} ${num}`}>{plain(totals.amount)}</td>
              <td className={`${td} ${num}`}>{plain(totals.balance)}</td>
            </tr>
          </tfoot>
        </table>
      </section>
      {companies.map((c) => (
        <section key={c.key} id={`co-${c.key}`} className="card p-4 space-y-3 scroll-mt-20">
          <div className="flex flex-wrap items-baseline justify-between gap-2 border-b border-[var(--line)] pb-2">
            <h2 className="font-heading text-lg font-bold text-[var(--ink)]">{c.company}</h2>
            <p className="text-sm tabular-nums">
              {count(c.rows.length, "bill")} · {count(c.parties, "party", "parties")} · <span className="font-bold text-[var(--ink)]">{inr(c.totals.balance)}</span>
            </p>
          </div>
          {c.key === UNSPLIT && <p className="text-xs text-[var(--muted)]">Bills from the old book with no company split yet. Import it under Import → Company split of open bills.</p>}
          <div className="overflow-x-auto -mx-4">
            <table className="w-full text-sm min-w-[820px]">
              <thead>
                <tr className="text-xs text-[var(--muted)] border-b border-[var(--line)] text-left">
                  <th className={th}>Bill no.</th>
                  <th className={th}>Date</th>
                  <th className={th}>Party</th>
                  <th className={th}>Area</th>
                  <th className={`${th} text-right`}>Bill value</th>
                  <th className={`${th} text-right`}>Company share</th>
                  <th className={`${th} text-right`}>Received</th>
                  <th className={`${th} text-right`}>Balance</th>
                  <th className={`${th} text-right`}>Days over</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[var(--line)]">
                {c.rows.map(({ bill: b, share: x }) => (
                  <tr key={b.id}>
                    <td className={`${td} font-medium text-[var(--ink)] whitespace-nowrap`}>{b.number}</td>
                    <td className={`${td} whitespace-nowrap`}>{shortDate(b.date)}</td>
                    <td className={td}>
                      <Link href={khata(b.shop.id)} className="hover:text-[var(--kesar-text)]">
                        {b.shop.outletName}
                      </Link>
                    </td>
                    <td className={td}>{b.shop.area}</td>
                    <td className={`${td} ${num} text-[var(--muted)]`}>{plain(b.amount)}</td>
                    <td className={`${td} ${num}`}>{plain(x.amount)}</td>
                    <td className={`${td} ${num}`}>{x.received ? plain(x.received) : "–"}</td>
                    <td className={`${td} ${num} font-semibold text-[var(--ink)]`}>{plain(x.balance)}</td>
                    <td className={`${td} ${num}`}>
                      <Late days={b.overdueDays} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      ))}
    </div>
  );
}

export function CollectionsTable({ rows, totals }: { rows: CollectionRow[]; totals: { total: number; count: number; byMethod: Record<(typeof COLLECTION_METHODS)[number], number> } }) {
  if (!rows.length) return <Empty>No money received in these days for these filters.</Empty>;
  return (
    <div className="card overflow-x-auto">
      <table className="w-full text-sm min-w-[880px]">
        <thead>
          <tr className="text-xs text-[var(--muted)] border-b border-[var(--line)] text-left">
            <th className={th}>Party</th>
            <th className={th}>Area</th>
            <th className={th}>Collected by</th>
            {COLLECTION_METHODS.map((m) => (
              <th key={m} className={`${th} text-right`}>
                {METHOD_LABEL[m]}
              </th>
            ))}
            <th className={`${th} text-right`}>Total</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-[var(--line)]">
          {rows.map((r) => (
            <tr key={r.shop.id} className="hover:bg-black/[0.02]">
              <td className={td}>
                <Link href={khata(r.shop.id)} className="font-medium text-[var(--ink)] hover:text-[var(--kesar-text)]">
                  {r.shop.outletName}
                </Link>
              </td>
              <td className={td}>{r.shop.area}</td>
              <td className={`${td} text-xs`}>{r.collectors.join(", ") || "–"}</td>
              {COLLECTION_METHODS.map((m) => (
                <td key={m} className={`${td} ${num}`}>
                  {r.byMethod[m] ? plain(r.byMethod[m]) : <span className="text-[var(--muted)]">–</span>}
                </td>
              ))}
              <td className={`${td} ${num} font-semibold text-[var(--ink)]`}>{plain(r.total)}</td>
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr className="border-t-2 border-[var(--ink)] font-semibold text-[var(--ink)]">
            <td className={td} colSpan={2}>
              {count(rows.length, "party", "parties")}
            </td>
            <td className={`${td} text-xs`}>{count(totals.count, "receipt")}</td>
            {COLLECTION_METHODS.map((m) => (
              <td key={m} className={`${td} ${num}`}>
                {plain(totals.byMethod[m])}
              </td>
            ))}
            <td className={`${td} ${num}`}>{plain(totals.total)}</td>
          </tr>
        </tfoot>
      </table>
    </div>
  );
}
