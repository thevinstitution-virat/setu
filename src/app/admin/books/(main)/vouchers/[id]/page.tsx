import Link from "next/link";
import Icon from "@/components/Icon";
import { booksPage } from "@/lib/books-page";
import { voucherDetail } from "@/lib/vouchers";
import { ErrorCard } from "@/components/reports/Kit";
import { showDay } from "@/components/books/fmt";
import { formatINR } from "@/lib/money";
import { Thumb } from "@/components/admin/AdminKit";
import SharePdf from "@/components/reports/SharePdf";
import CancelVoucher from "@/components/books/CancelVoucher";
import { ledgerHref } from "@/lib/books";

/** Same as AdminKit's fileUrl, which is client-only and can't be called while rendering on the server. */
const fileUrl = (key: string) => `/api/files/${key.split("/").map(encodeURIComponent).join("/")}`;
const ROLE = { ACCOUNT: "", MONEY: "", GST: "GST input credit", TDS: "TDS" } as const;

/** One voucher: its lines as posted, how the money moved, slips, the bank line it was seen on, and cancel. */
export default async function VoucherPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const r = await booksPage((ctx) => voucherDetail(ctx, id));
  if (!r.ok) return <ErrorCard message={r.error} />;
  const v = r.data;
  const cancelled = !!v.cancelledAt;
  const debit = v.lines.reduce((a, l) => a + Math.max(0, l.amount), 0);
  const how = [
    v.methodLabel,
    v.staffName,
    v.bankAccount?.name,
    v.cheque ? `cheque ${v.cheque.number} (${v.cheque.status === "ISSUED" ? "not yet cleared" : v.cheque.status.toLowerCase()})` : null,
    v.reference,
  ]
    .filter(Boolean)
    .join(" · ");

  return (
    <div className="space-y-4">
      <Link href="/admin/books/vouchers" className="inline-flex items-center gap-1 text-sm font-bold text-[var(--ink-2)]">
        <Icon name="arrow" className="h-4 w-4 rotate-180" /> Vouchers
      </Link>

      <section className="card p-4 sm:p-5 space-y-3">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="page-kick">{v.typeLabel}</p>
            <h2 className="font-heading text-2xl font-bold text-[var(--ink)]">
              {v.number} {cancelled && <span className="chip !text-xs align-middle">Cancelled</span>}
            </h2>
            <p className="text-sm text-[var(--ink-2)] mt-1">
              {showDay(v.date)}
              {v.party ? ` · ${v.type === "RECEIPT" ? "from" : "to"} ${v.party}` : ""}
              {v.partyGstin ? ` · GSTIN ${v.partyGstin}` : ""}
            </p>
            {how && <p className="text-xs text-[var(--muted)] mt-0.5">{how}</p>}
          </div>
          <p className="font-heading text-2xl font-bold tabular-nums">{formatINR(v.amount)}</p>
        </div>
        {v.narration && <p className="text-sm text-[var(--ink-2)]">{v.narration}</p>}
        {cancelled && <p className="text-sm text-[var(--risk-text)]">Cancelled: {v.cancelReason}</p>}
        <p className="text-xs text-[var(--muted)]">
          Entered by {v.createdBy ?? "the system"} on {new Date(v.createdAt).toLocaleString("en-IN", { day: "numeric", month: "short", hour: "numeric", minute: "2-digit", timeZone: "Asia/Kolkata" })}
          {v.handoverId ? " · with a cash handover" : ""}
        </p>
        <SharePdf
          url={`/api/admin/books/vouchers/${v.id}`}
          file={`voucher-${v.number}`}
          summary={`${v.typeLabel} ${v.number}, ${showDay(v.date)}: ${formatINR(v.amount)}${v.party ? ` ${v.type === "RECEIPT" ? "from" : "to"} ${v.party}` : ""}.`}
        />
        {!cancelled && r.me.canPost && (
          <div className="pt-3 border-t border-[var(--line)]">
            <CancelVoucher id={v.id} number={v.number} />
          </div>
        )}
      </section>

      <section className="card p-0 overflow-hidden">
        <h3 className="font-heading font-bold text-[var(--ink)] px-4 pt-4">Entry</h3>
        <div className="grid grid-cols-[1fr_6rem_6rem] gap-x-3 px-4 pt-2 pb-1 text-xs font-semibold text-[var(--muted)] border-b border-[var(--line)]">
          <span>Account</span>
          <span className="text-right">Debit</span>
          <span className="text-right">Credit</span>
        </div>
        <ul className="divide-y divide-[var(--line)]">
          {v.lines.map((l) => (
            <li key={l.id} className="grid grid-cols-[1fr_6rem_6rem] gap-x-3 px-4 py-2.5 text-sm items-start">
              <span className="min-w-0">
                <Link href={ledgerHref(l.code)} className="font-semibold hover:text-[var(--accent-text)]">
                  {l.name}
                </Link>
                {(ROLE[l.role] || l.note) && <span className="block text-xs text-[var(--muted)]">{[ROLE[l.role], l.note].filter(Boolean).join(" · ")}</span>}
              </span>
              <span className="text-right tabular-nums">{l.amount > 0 ? formatINR(l.amount) : ""}</span>
              <span className="text-right tabular-nums">{l.amount < 0 ? formatINR(-l.amount) : ""}</span>
            </li>
          ))}
          <li className="grid grid-cols-[1fr_6rem_6rem] gap-x-3 px-4 py-2.5 text-sm font-semibold">
            <span>Total</span>
            <span className="text-right tabular-nums">{formatINR(debit)}</span>
            <span className="text-right tabular-nums">{formatINR(debit)}</span>
          </li>
        </ul>
      </section>

      {v.photos.length > 0 && (
        <section className="card p-4 space-y-2">
          <h3 className="font-heading font-bold text-[var(--ink)]">Bill / slip photos</h3>
          <div className="flex flex-wrap gap-2">
            {v.photos.map((k) => (
              <a key={k} href={fileUrl(k)} target="_blank" rel="noreferrer">
                <Thumb imageKey={k} className="h-24 w-24" alt="Slip" />
              </a>
            ))}
          </div>
        </section>
      )}

      {(v.type === "PAYMENT" || v.type === "RECEIPT" || v.type === "CONTRA") && (v.method === "BANK" || v.method === "CHEQUE" || v.bankAccount) && (
        <section className="card p-4 space-y-1">
          <h3 className="font-heading font-bold text-[var(--ink)]">In the bank statement</h3>
          {v.bankLines.length ? (
            v.bankLines.map((b) => (
              <p key={b.id} className="text-sm">
                {showDay(b.date)} · {b.bank ?? "Bank"} · {formatINR(b.amount)} <span className="text-[var(--muted)]">· {b.narration}</span>
              </p>
            ))
          ) : (
            <p className="text-sm text-[var(--muted)]">
              Not seen yet. Upload the statement under{" "}
              <Link href="/admin/bank" className="underline">
                Bank
              </Link>{" "}
              and it is matched.
            </p>
          )}
        </section>
      )}
    </div>
  );
}
