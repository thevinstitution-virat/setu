import Link from "next/link";
import Icon from "@/components/Icon";
import { booksPage, readSearch } from "@/lib/books-page";
import { isDay, readPeriod, todayIst } from "@/lib/books";
import { claimsByType, claimsList, pendingClaims, periodText, settlementsIn } from "@/lib/claims";
import { CLAIM_AGE_LABEL, CLAIM_STATUS_LABEL, CLAIM_TYPE_LABEL, CLAIM_TYPES, SETTLE_KIND_LABEL, isClaimType } from "@/lib/claim-labels";
import { claimsSummary } from "@/lib/claims-export";
import { Empty, ErrorCard, Kpi } from "@/components/reports/Kit";
import { showDay } from "@/components/books/fmt";
import { formatINR } from "@/lib/money";
import SharePdf from "@/components/reports/SharePdf";
import type { ClaimStatus } from "@/generated/prisma/client";

type SP = Record<string, string | string[] | undefined>;
const VIEWS = [
  { key: "list", label: "Claims" },
  { key: "pending", label: "Pending by company" },
  { key: "settled", label: "Settled" },
  { key: "types", label: "Claimed vs received" },
] as const;
type View = (typeof VIEWS)[number]["key"];
const SHOW = [
  { key: "open", label: "Open" },
  { key: "closed", label: "Closed" },
  { key: "all", label: "All" },
] as const;

const STATUS_TONE: Record<ClaimStatus, string> = {
  RAISED: "bg-[var(--accent-tint)] text-[var(--accent-text)]",
  PART_SETTLED: "bg-[var(--accent-tint)] text-[var(--accent-text)]",
  SETTLED: "bg-emerald-50 text-emerald-800",
  REJECTED: "bg-red-50 text-[var(--risk-text)]",
  WRITTEN_OFF: "bg-black/5 text-foreground/70",
};

/** Claims on companies: the list, what is pending by company and age, what came in, and claimed vs received by type. */
export default async function ClaimsPage({ searchParams }: { searchParams: Promise<SP> }) {
  const sp = readSearch(await searchParams);
  const view: View = VIEWS.find((x) => x.key === sp.get("view"))?.key ?? "list";
  const show = SHOW.find((x) => x.key === sp.get("show"))?.key ?? "open";
  const supplier = sp.get("supplier") || null;
  const t = sp.get("type");
  const type = isClaimType(t) ? t : null;
  const asOn = isDay(sp.get("asOn")) ? sp.get("asOn")! : todayIst();
  const period = readPeriod(sp);
  const r = await booksPage(async (ctx) => {
    const companies = await ctx.tx.supplier.findMany({ where: { kind: "GOODS" }, orderBy: { name: "asc" }, select: { id: true, name: true } });
    const f = { supplierId: supplier };
    if (view === "pending") return { companies, pending: await pendingClaims(ctx, asOn, f) };
    if (view === "settled") return { companies, settled: "error" in period ? null : await settlementsIn(ctx, period.from, period.to, f) };
    if (view === "types") return { companies, types: "error" in period ? null : await claimsByType(ctx, period.from, period.to, f) };
    const claims = await claimsList(ctx, { status: show === "all" ? null : show, supplierId: supplier, type });
    return { companies, claims };
  });
  if (!r.ok) return <ErrorCard message={r.error} />;
  const d = r.data;
  const from = "error" in period ? "" : period.from;
  const to = "error" in period ? "" : period.to;
  const report = view === "list" ? null : view;
  const q = new URLSearchParams({ ...(report ? { report } : {}), ...(view === "pending" ? { asOn } : { from, to }), ...(supplier ? { supplier } : {}) });
  const file = view === "pending" ? `claims-pending-${asOn}` : `claims-${view}-${from}-to-${to}`;
  const summary = report ? claimsSummary(report, { pending: d.pending, settled: d.settled ?? undefined, types: d.types ?? undefined }) : "";
  const link = (over: Record<string, string | null>) => {
    const p = new URLSearchParams({ ...(view !== "list" ? { view } : {}), ...(supplier ? { supplier } : {}), ...(type ? { type } : {}), ...(show !== "open" ? { show } : {}) });
    for (const [k, v] of Object.entries(over)) {
      if (v === null) p.delete(k);
      else p.set(k, v);
    }
    return `/admin/books/claims${p.toString() ? `?${p}` : ""}`;
  };
  const pill = (on: boolean) =>
    `shrink-0 rounded-full px-3 py-1 text-xs font-semibold border ${on ? "border-[var(--kesar)] bg-[var(--accent-tint)] text-[var(--accent-text)]" : "border-[var(--line)] bg-white/60 text-foreground/70 hover:bg-white"}`;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 className="font-heading text-xl font-bold text-[var(--ink)]">Claims on companies</h2>
          <p className="text-sm text-[var(--muted)]">Schemes, damages and rate differences the companies owe us.</p>
        </div>
        {r.me.canClaim && (
          <Link className="btn btn-mor btn-sm" href={`/admin/books/claims/new${supplier ? `?supplier=${supplier}` : ""}`}>
            <Icon name="plus" className="h-4 w-4" /> Raise a claim
          </Link>
        )}
      </div>

      <div className="card p-3 space-y-3">
        <nav className="flex gap-1.5 overflow-x-auto" aria-label="Claims view">
          {VIEWS.map((x) => (
            <Link key={x.key} href={link({ view: x.key === "list" ? null : x.key, show: null, type: null })} aria-current={x.key === view ? "page" : undefined} className={pill(x.key === view)}>
              {x.label}
            </Link>
          ))}
        </nav>
        <form method="get" className="flex flex-wrap items-end gap-2">
          {view !== "list" && <input type="hidden" name="view" value={view} />}
          {view === "list" && show !== "open" && <input type="hidden" name="show" value={show} />}
          <label className="text-xs text-[var(--muted)] min-w-0 w-full sm:w-auto sm:flex-1 sm:basis-56">
            Company
            <select name="supplier" defaultValue={supplier ?? ""} className="input !py-1.5 !text-sm mt-1 block w-full">
              <option value="">All companies</option>
              {d.companies.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
          </label>
          {view === "list" && (
            <label className="text-xs text-[var(--muted)]">
              For
              <select name="type" defaultValue={type ?? ""} className="input !py-1.5 !text-sm mt-1 block">
                <option value="">Everything</option>
                {CLAIM_TYPES.map((x) => (
                  <option key={x} value={x}>
                    {CLAIM_TYPE_LABEL[x]}
                  </option>
                ))}
              </select>
            </label>
          )}
          {view === "pending" && (
            <label className="text-xs text-[var(--muted)]">
              As on
              <input type="date" name="asOn" defaultValue={asOn} max={todayIst()} className="input !py-1.5 !text-sm mt-1 block" />
            </label>
          )}
          {(view === "settled" || view === "types") && (
            <>
              <label className="text-xs text-[var(--muted)]">
                From
                <input type="date" name="from" defaultValue={from} className="input !py-1.5 !text-sm mt-1 block" />
              </label>
              <label className="text-xs text-[var(--muted)]">
                To
                <input type="date" name="to" defaultValue={to} className="input !py-1.5 !text-sm mt-1 block" />
              </label>
            </>
          )}
          <button className="btn btn-mor btn-sm">Show</button>
        </form>
        {view === "list" && (
          <div className="flex gap-1.5" role="group" aria-label="Which claims">
            {SHOW.map((x) => (
              <Link key={x.key} href={link({ show: x.key === "open" ? null : x.key })} aria-current={x.key === show ? "true" : undefined} className={pill(x.key === show)}>
                {x.label}
              </Link>
            ))}
          </div>
        )}
        {report && <SharePdf url={`/api/admin/books/claims/reports?${q}`} file={file} summary={summary} />}
      </div>

      {d.claims && (
        <>
          <div className="grid grid-cols-2 lg:grid-cols-3 gap-3">
            <Kpi label="Claimed" value={formatINR(d.claims.reduce((a, c) => a + (c.cancelled ? 0 : c.amount), 0))} sub={`${d.claims.filter((c) => !c.cancelled).length} claims`} />
            <Kpi label="Received" value={formatINR(d.claims.reduce((a, c) => a + (c.cancelled ? 0 : c.settled), 0))} />
            <Kpi label="Still open" value={formatINR(d.claims.reduce((a, c) => a + c.open, 0))} />
          </div>
          {d.claims.length ? (
            <section className="card p-0 overflow-hidden">
              <ul className="divide-y divide-[var(--line)]">
                {d.claims.map((c) => (
                  <li key={c.id} className={c.cancelled ? "opacity-50" : ""}>
                    <Link href={`/admin/books/claims/${c.id}`} className="flex items-start justify-between gap-3 px-4 py-3 hover:bg-black/[0.02]">
                      <span className="min-w-0">
                        <span className="font-semibold">{c.number}</span>{" "}
                        <span className={`chip !text-[10px] ${c.cancelled ? "" : STATUS_TONE[c.status]}`}>{c.cancelled ? "Cancelled" : CLAIM_STATUS_LABEL[c.status]}</span>
                        <span className="block text-sm text-[var(--ink-2)] truncate">{c.company}</span>
                        <span className="block text-xs text-[var(--muted)]">
                          {CLAIM_TYPE_LABEL[c.type]} · {[periodText(c) || `raised ${showDay(c.date)}`, c.reference].filter(Boolean).join(" · ")}
                        </span>
                      </span>
                      <span className="text-right shrink-0">
                        <span className="block tabular-nums font-semibold">{formatINR(c.amount)}</span>
                        {c.open > 0 && c.open < c.amount && <span className="block text-xs tabular-nums text-[var(--accent-text)]">{formatINR(c.open)} open</span>}
                        {c.open > 0 && <span className="block text-xs text-[var(--muted)]">{c.age} days</span>}
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
            </section>
          ) : (
            <Empty>{show === "open" ? "No open claims." : "No claims here yet."}</Empty>
          )}
        </>
      )}

      {d.pending && (
        <>
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            <Kpi label="Pending" value={formatINR(d.pending.totals.open)} sub={`${d.pending.totals.claims} claims, as on ${showDay(asOn)}`} />
            <Kpi label={CLAIM_AGE_LABEL.d30} value={formatINR(d.pending.totals.d30)} />
            <Kpi label="31–90 days" value={formatINR(d.pending.totals.d60 + d.pending.totals.d90)} />
            <Kpi label={CLAIM_AGE_LABEL.older} value={formatINR(d.pending.totals.older)} />
          </div>
          {d.pending.companies.length ? (
            <section className="card p-0 overflow-x-auto">
              <table className="w-full text-sm" style={{ minWidth: 640 }}>
                <thead>
                  <tr className="text-xs text-[var(--muted)] border-b border-[var(--line)]">
                    <th className="px-4 py-2 text-left font-semibold">Company</th>
                    {(["d30", "d60", "d90", "older"] as const).map((k) => (
                      <th key={k} className="px-3 py-2 text-right font-semibold">
                        {CLAIM_AGE_LABEL[k]}
                      </th>
                    ))}
                    <th className="px-4 py-2 text-right font-semibold">Pending</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[var(--line)]">
                  {d.pending.companies.map((c) => (
                    <tr key={c.supplierId}>
                      <td className="px-4 py-2">
                        <Link href={link({ view: null, supplier: c.supplierId })} className="font-semibold hover:text-[var(--accent-text)]">
                          {c.company}
                        </Link>
                        <span className="block text-xs text-[var(--muted)]">
                          {c.claims} claim{c.claims === 1 ? "" : "s"}
                        </span>
                      </td>
                      {(["d30", "d60", "d90", "older"] as const).map((k) => (
                        <td key={k} className={`px-3 py-2 text-right tabular-nums ${k !== "d30" && c[k] ? "text-[var(--risk-text)]" : ""}`}>
                          {c[k] ? formatINR(c[k]) : ""}
                        </td>
                      ))}
                      <td className="px-4 py-2 text-right tabular-nums font-semibold">{formatINR(c.open)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </section>
          ) : (
            <Empty>Nothing was pending with any company on this day.</Empty>
          )}
        </>
      )}

      {(view === "settled" || view === "types") && "error" in period && <ErrorCard message={period.error} />}
      {d.settled && (
        <>
          <div className="grid grid-cols-3 gap-3">
            <Kpi label="By credit note" value={formatINR(d.settled.totals.creditNotes)} sub={`${showDay(d.settled.from)} to ${showDay(d.settled.to)}`} />
            <Kpi label="Money received" value={formatINR(d.settled.totals.received)} />
            <Kpi label="Written off" value={formatINR(d.settled.totals.writtenOff)} />
          </div>
          {d.settled.rows.length ? (
            <section className="card p-0 overflow-hidden">
              <ul className="divide-y divide-[var(--line)]">
                {d.settled.rows.map((x) => (
                  <li key={x.id} className="flex items-start justify-between gap-3 px-4 py-2.5 text-sm">
                    <span className="min-w-0">
                      <Link href={`/admin/books/claims/${x.claimId}`} className="font-semibold text-[var(--accent-text)]">
                        {x.claim}
                      </Link>{" "}
                      <span className="text-[var(--ink-2)]">{x.company}</span>
                      <span className="block text-xs text-[var(--muted)]">
                        {showDay(x.date)} · {SETTLE_KIND_LABEL[x.kind]}
                        {x.how ? ` · ${x.how}` : ""}
                      </span>
                    </span>
                    <span className={`tabular-nums font-semibold shrink-0 ${x.kind === "WRITE_OFF" ? "text-[var(--muted)]" : ""}`}>{formatINR(x.amount)}</span>
                  </li>
                ))}
              </ul>
            </section>
          ) : (
            <Empty>Nothing came in or was written off in this period.</Empty>
          )}
        </>
      )}

      {d.types && (
        <>
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            <Kpi label="Claimed" value={formatINR(d.types.totals.claimed)} sub={`${d.types.totals.claims} claims raised`} />
            <Kpi label="Received" value={formatINR(d.types.totals.received)} sub={d.types.totals.claimed ? `${d.types.totals.pct}% of claimed` : undefined} />
            <Kpi label="Written off" value={formatINR(d.types.totals.writtenOff)} />
            <Kpi label="Still open" value={formatINR(d.types.totals.open)} />
          </div>
          <section className="card p-0 overflow-x-auto">
            <table className="w-full text-sm" style={{ minWidth: 560 }}>
              <thead>
                <tr className="text-xs text-[var(--muted)] border-b border-[var(--line)]">
                  <th className="px-4 py-2 text-left font-semibold">For</th>
                  <th className="px-3 py-2 text-right font-semibold">Claimed</th>
                  <th className="px-3 py-2 text-right font-semibold">Received</th>
                  <th className="px-3 py-2 text-right font-semibold">Written off</th>
                  <th className="px-3 py-2 text-right font-semibold">Open</th>
                  <th className="px-4 py-2 text-right font-semibold">Got</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[var(--line)]">
                {d.types.types.map((x) => (
                  <tr key={x.type}>
                    <td className="px-4 py-2">
                      <span className="font-semibold">{CLAIM_TYPE_LABEL[x.type]}</span>
                      <span className="block text-xs text-[var(--muted)]">
                        {x.claims} claim{x.claims === 1 ? "" : "s"}
                      </span>
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums">{x.claimed ? formatINR(x.claimed) : ""}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{x.received ? formatINR(x.received) : ""}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{x.writtenOff ? formatINR(x.writtenOff) : ""}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{x.open ? formatINR(x.open) : ""}</td>
                    <td className="px-4 py-2 text-right tabular-nums font-semibold">{x.claimed ? `${x.pct}%` : ""}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>
        </>
      )}
    </div>
  );
}
