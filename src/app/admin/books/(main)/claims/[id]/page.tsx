import Link from "next/link";
import Icon from "@/components/Icon";
import { booksPage } from "@/lib/books-page";
import { claimDetail, claimOptions, periodText } from "@/lib/claims";
import { CLAIM_STATUS_LABEL, CLAIM_TYPE_LABEL, SETTLE_KIND_LABEL } from "@/lib/claim-labels";
import { ErrorCard } from "@/components/reports/Kit";
import { showDay } from "@/components/books/fmt";
import { formatINR } from "@/lib/money";
import SharePdf from "@/components/reports/SharePdf";
import { ClaimActions, UndoSettlement } from "@/components/books/ClaimActions";

const ymd = (d: Date | null) => (d ? d.toISOString().slice(0, 10) : null);

/** One claim: what we claimed, what came in against it (credit notes, money), what was written off, and the letter. */
export default async function ClaimPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const r = await booksPage(async (ctx) => ({ claim: await claimDetail(ctx, id), banks: (await claimOptions(ctx)).banks }));
  if (!r.ok) return <ErrorCard message={r.error} />;
  const { claim: c, banks } = r.data;
  const cancelled = !!c.cancelledAt;
  const live = c.settlements.filter((s) => !s.reversedAt);
  const period = periodText({ type: c.type, periodFrom: ymd(c.periodFrom), periodTo: ymd(c.periodTo) });
  const letterText = `Claim ${c.number} on ${c.supplier.name}: ${CLAIM_TYPE_LABEL[c.type]}${period ? `, ${period.toLowerCase()}` : ""}, ${formatINR(c.amount)}${c.open && c.open < c.amount ? ` (${formatINR(c.open)} still to come)` : ""}. Please settle by credit note or payment quoting ${c.number}.`;

  return (
    <div className="space-y-4">
      <Link href="/admin/books/claims" className="inline-flex items-center gap-1 text-sm font-bold text-[var(--ink-2)]">
        <Icon name="arrow" className="h-4 w-4 rotate-180" /> Claims
      </Link>

      <section className="card p-4 sm:p-5 space-y-3">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="page-kick">Claim · {CLAIM_TYPE_LABEL[c.type]}</p>
            <h2 className="font-heading text-2xl font-bold text-[var(--ink)]">
              {c.number} <span className="chip !text-xs align-middle">{cancelled ? "Cancelled" : CLAIM_STATUS_LABEL[c.status]}</span>
            </h2>
            <p className="text-sm text-[var(--ink-2)] mt-1">
              <Link href={`/admin/books/suppliers/${c.supplier.id}`} className="font-semibold text-[var(--accent-text)]">
                {c.supplier.name}
              </Link>{" "}
              · raised {showDay(ymd(c.date)!)}
            </p>
            {(period || c.reference) && <p className="text-xs text-[var(--muted)] mt-0.5">{[period, c.reference].filter(Boolean).join(" · ")}</p>}
          </div>
          <div className="text-right">
            <p className="font-heading text-2xl font-bold tabular-nums">{formatINR(c.amount)}</p>
            {!cancelled && c.open > 0 && c.open < c.amount && <p className="text-sm text-[var(--accent-text)] tabular-nums">{formatINR(c.open)} still open</p>}
          </div>
        </div>
        <dl className="grid gap-x-6 gap-y-1 text-sm sm:grid-cols-3">
          <div className="flex justify-between gap-3">
            <dt className="text-[var(--muted)]">Received</dt>
            <dd className="tabular-nums">{formatINR(c.settled)}</dd>
          </div>
          <div className="flex justify-between gap-3">
            <dt className="text-[var(--muted)]">Written off</dt>
            <dd className="tabular-nums">{formatINR(c.writtenOff)}</dd>
          </div>
          <div className="flex justify-between gap-3">
            <dt className="text-[var(--muted)]">Open</dt>
            <dd className="tabular-nums font-semibold">{formatINR(c.open)}</dd>
          </div>
        </dl>
        {c.closeReason && <p className="text-sm text-[var(--muted)]">Written off: {c.closeReason}</p>}
        {c.note && <p className="text-sm text-[var(--muted)]">Note: {c.note}</p>}
        {cancelled && <p className="text-sm text-[var(--risk-text)]">Cancelled: {c.cancelReason}</p>}
        <SharePdf url={`/api/admin/books/claims/${c.id}`} file={`claim-${c.number}`} summary={letterText} />
        {!cancelled && r.me.canClaim && (
          <div className="flex flex-wrap gap-2 pt-1 border-t border-[var(--line)]">
            {c.open > 0 && r.me.canPurchase && (
              <Link className="btn btn-outline btn-xs mt-3" href={`/admin/books/purchases/new?type=CREDIT_NOTE&supplier=${c.supplier.id}&claim=${c.id}`}>
                <Icon name="receipt" className="h-3.5 w-3.5" /> Their credit note
              </Link>
            )}
            <div className="mt-3">
              <ClaimActions id={c.id} open={c.open} raisedOn={ymd(c.date)!} banks={banks} canCancel={!live.length} />
            </div>
          </div>
        )}
      </section>

      <section className="card p-0 overflow-hidden">
        <h3 className="font-heading font-bold text-[var(--ink)] px-4 pt-4">What we claimed</h3>
        <ul className="divide-y divide-[var(--line)] mt-2">
          {c.lines.map((l) => (
            <li key={l.id} className="flex items-start justify-between gap-3 px-4 py-2.5 text-sm">
              <span className="min-w-0">
                <span className="font-semibold">{l.description}</span>
                <span className="block text-xs text-[var(--muted)]">
                  {l.quantity.toLocaleString("en-IN")} × {formatINR(l.rate)}
                  {l.evidence ? ` · ${l.evidence}` : ""}
                </span>
              </span>
              <span className="tabular-nums font-semibold shrink-0">{formatINR(l.amount)}</span>
            </li>
          ))}
        </ul>
      </section>

      <section className="card p-0 overflow-hidden">
        <h3 className="font-heading font-bold text-[var(--ink)] px-4 pt-4">Against this claim</h3>
        {c.settlements.length ? (
          <ul className="divide-y divide-[var(--line)] mt-2">
            {c.settlements.map((s) => (
              <li key={s.id} className={`px-4 py-2.5 text-sm ${s.reversedAt ? "opacity-50" : ""}`}>
                <div className="flex items-start justify-between gap-3">
                  <span className="min-w-0">
                    <span className="font-semibold">{SETTLE_KIND_LABEL[s.kind]}</span>
                    {s.reversedAt && <span className="chip !text-[10px] ml-1">Undone</span>}
                    <span className="block text-xs text-[var(--muted)]">
                      {showDay(ymd(s.date)!)}
                      {s.creditNote ? (
                        <>
                          {" · "}
                          <Link href={`/admin/books/purchases/${s.creditNote.id}`} className="underline">
                            {s.creditNote.supplierRef} ({s.creditNote.number})
                          </Link>
                        </>
                      ) : null}
                      {s.kind === "RECEIPT" ? ` · ${s.cash ? "Office cash" : (s.bankAccount?.name ?? "Bank")}` : ""}
                      {s.reference && !s.creditNote ? ` · ${s.reference}` : ""}
                      {s.note ? ` · ${s.note}` : ""}
                    </span>
                  </span>
                  <span className="tabular-nums font-semibold shrink-0">{formatINR(s.amount)}</span>
                </div>
                {!s.reversedAt && s.kind !== "CREDIT_NOTE" && !cancelled && r.me.canClaim && (
                  <div className="mt-1.5">
                    <UndoSettlement claimId={c.id} settlementId={s.id} />
                  </div>
                )}
              </li>
            ))}
          </ul>
        ) : (
          <p className="p-4 text-sm text-[var(--muted)]">Nothing yet. Send them the claim letter, then enter their credit note or the money when it comes.</p>
        )}
      </section>
    </div>
  );
}
