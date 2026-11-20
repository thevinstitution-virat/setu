import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { cache } from "react";
import { getTenant } from "@/lib/tenant";
import { tenantDb } from "@/lib/db";
import { loadInvoiceDoc } from "@/lib/invoice";
import { openShareToken } from "@/lib/invoice-api";
import { formatINR } from "@/lib/money";
import Icon from "@/components/Icon";
import { InvoiceView, type InvoiceJson } from "@/components/invoice/InvoiceView";

/**
 * Shared invoice link (no sign-in): one document, read-only, with its PDF.
 * The token is HMAC-signed per business (lib/invoice-api), so a tampered or
 * foreign token is simply "not valid". Nothing else of the khata is shown.
 */

const load = cache(async (token: string) => {
  const tenant = await getTenant();
  if (!tenant) return null;
  const id = await openShareToken(tenantDb(tenant.id), tenant.id, token);
  if (!id) return null;
  const doc = await loadInvoiceDoc(tenantDb(tenant.id) as never, id);
  if (!doc) return null;
  // Only what the document shows: no internal ids, settings or e-invoice errors.
  const { settings: _s, tenantId: _t, entryId: _e, createdById: _c, signedQr: _q, einvAttempts: _a, shareVersion: _v, ...rest } = doc;
  void [_s, _t, _e, _c, _q, _a, _v];
  const json = JSON.parse(
    JSON.stringify({ ...rest, lines: rest.lines.map(({ tenantId: _lt, ...line }) => (void _lt, line)) })
  ) as InvoiceJson;
  if (json.einvStatus === "PENDING" || json.einvStatus === "FAILED") json.einvStatus = "NOT_REQUIRED";
  json.einvError = null;
  return json;
});

export async function generateMetadata({ params }: { params: Promise<{ token: string }> }): Promise<Metadata> {
  const { token } = await params;
  const doc = await load(token);
  return {
    title: doc ? `${doc.title} ${doc.number} · ${doc.seller.tradeName}` : "Link not valid",
    description: doc ? `${doc.title} from ${doc.seller.tradeName}` : undefined,
    robots: { index: false, follow: false },
  };
}

const longDate = (s: string) =>
  new Date(s).toLocaleDateString("en-IN", { day: "numeric", month: "long", year: "numeric", timeZone: "Asia/Kolkata" });

export default async function SharedInvoicePage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const doc = await load(token);
  if (!doc) notFound();

  const pdf = `/api/public/invoices/${encodeURIComponent(token)}`;
  const credit = doc.type === "CREDIT_NOTE";

  return (
    <main className="w-full max-w-3xl mx-auto px-4 py-6 space-y-4">
      <header className="card p-4 space-y-4">
        <div className="min-w-0">
          <p className="text-xs font-semibold uppercase tracking-wide text-[var(--muted)]">{doc.title}</p>
          <h1 className="page-title !text-2xl break-words mt-1">{doc.seller.tradeName}</h1>
          <p className="text-sm text-[var(--ink-2)] mt-1 break-all">
            {doc.number} · {longDate(doc.date)}
          </p>
          <p className="text-sm text-[var(--muted)] break-words">For {doc.buyer.tradeName}</p>
        </div>

        <div className="grid grid-cols-2 gap-2">
          <div className="rounded-xl bg-black/[0.04] p-3">
            <p className="text-xs text-[var(--muted)]">{credit ? "Credit" : "Total"}</p>
            <p className="font-bold text-lg mt-0.5">{formatINR(doc.total)}</p>
          </div>
          {doc.due !== null ? (
            doc.due > 0 ? (
              <div className="rounded-xl bg-[var(--kesar-tint)] p-3">
                <p className="text-xs text-[var(--kesar-text)]">Amount due</p>
                <p className="font-bold text-lg mt-0.5 text-[var(--kesar-text)]">{formatINR(doc.due)}</p>
              </div>
            ) : (
              <div className="rounded-xl bg-[var(--mint-tint)] p-3">
                <p className="text-xs text-[var(--mint-text)]">Amount due</p>
                <p className="font-bold text-lg mt-0.5 text-[var(--mint-text)]">Paid</p>
              </div>
            )
          ) : (
            <div className="rounded-xl bg-black/[0.04] p-3">
              <p className="text-xs text-[var(--muted)]">Date</p>
              <p className="font-bold text-lg mt-0.5">{new Date(doc.date).toLocaleDateString("en-IN", { day: "numeric", month: "short", timeZone: "Asia/Kolkata" })}</p>
            </div>
          )}
        </div>

        <div className="flex flex-col sm:flex-row gap-2">
          <a href={`${pdf}?download=1`} className="btn btn-primary w-full sm:flex-1 !min-h-[52px] text-base">
            <Icon name="download" /> Download PDF
          </a>
          <a href={pdf} target="_blank" rel="noopener" className="btn btn-outline w-full sm:w-auto">
            <Icon name="file" className="h-4 w-4" /> Open PDF
          </a>
        </div>
      </header>

      <InvoiceView doc={doc} />

      <p className="text-xs text-center text-[var(--muted)] pb-4">
        Questions about this {doc.type === "CREDIT_NOTE" || doc.type === "DEBIT_NOTE" ? "note" : "bill"}? Contact {doc.seller.tradeName}
        {doc.seller.phone ? ` on ${doc.seller.phone}` : ""}.
      </p>
    </main>
  );
}
