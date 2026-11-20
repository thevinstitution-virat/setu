"use client";

import Link from "next/link";
import { useState } from "react";
import Icon from "@/components/Icon";
import { Field, errText, send } from "@/components/admin/AdminKit";
import CopyButton from "@/components/admin/CopyButton";
import { ConfirmButton, ErrLine, StatusChip, inr, useIsOwner, when } from "./kit";

export type PlatformInvoice = {
  id: string;
  tenantId: string;
  number: string;
  periodStart: string;
  periodEnd: string;
  taxable: number;
  cgst: number;
  sgst: number;
  igst: number;
  total: number;
  status: "ISSUED" | "PAID" | "VOID";
  issuedAt: string;
  dueAt: string;
  paidAt: string | null;
  paidRef: string | null;
  paidVia: string | null;
  voidReason: string | null;
  payUrl: string | null;
  remindersSent: number;
  tenant?: { name: string; slug: string };
};

const METHODS = ["bank transfer", "UPI", "cheque", "cash", "online"];

/** Our invoices to businesses, each with its actions (paid, void, pay link, PDF). */
export default function InvoiceList({ invoices, onChanged, showTenant = true }: { invoices: PlatformInvoice[]; onChanged: () => void; showTenant?: boolean }) {
  if (!invoices.length) return <p className="text-sm text-[var(--muted)]">No invoices.</p>;
  return (
    <ul className="divide-y divide-[var(--line)]">
      {invoices.map((inv) => (
        <InvoiceRow key={inv.id} inv={inv} onChanged={onChanged} showTenant={showTenant} />
      ))}
    </ul>
  );
}

function InvoiceRow({ inv, onChanged, showTenant }: { inv: PlatformInvoice; onChanged: () => void; showTenant: boolean }) {
  const owner = useIsOwner();
  const [open, setOpen] = useState<"paid" | "void" | null>(null);
  const [ref, setRef] = useState("");
  const [via, setVia] = useState(METHODS[0]);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [payUrl, setPayUrl] = useState(inv.payUrl);
  const overdue = inv.status === "ISSUED" && new Date(inv.dueAt) <= new Date();

  async function act(body: Record<string, unknown>) {
    setBusy(true);
    setError(null);
    try {
      const r = await send<PlatformInvoice>(`/api/platform/invoices/${inv.id}`, "PATCH", body);
      if (body.action === "link") setPayUrl(r.payUrl);
      else {
        setOpen(null);
        onChanged();
      }
    } catch (e) {
      setError(errText(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <li className="py-3 space-y-2">
      <div className="flex flex-wrap items-start gap-x-4 gap-y-1">
        <div className="min-w-0 flex-1">
          <p className="font-semibold font-mono text-sm">{inv.number}</p>
          {showTenant && inv.tenant && (
            <Link href={`/platform/tenants/${inv.tenantId}`} className="text-sm text-[var(--mor)] hover:underline">
              {inv.tenant.name}
            </Link>
          )}
          <p className="text-xs text-[var(--muted)]">
            {when(inv.periodStart)} to {when(new Date(new Date(inv.periodEnd).getTime() - 1))} · issued {when(inv.issuedAt)}
          </p>
        </div>
        <div className="text-right">
          <p className="font-heading font-bold tabular-nums">{inr(inv.total)}</p>
          <p className="text-xs text-[var(--muted)]">
            {inv.cgst + inv.sgst + inv.igst > 0 ? `${inr(inv.taxable)} + GST` : "no GST"}
          </p>
        </div>
        <div className="w-full sm:w-auto sm:text-right space-y-0.5">
          <StatusChip value={inv.status} label={overdue ? "Overdue" : undefined} tone={overdue ? "red" : undefined} />
          <p className="text-xs text-[var(--muted)]">
            {inv.status === "PAID" && `Paid ${when(inv.paidAt)}${inv.paidVia ? ` · ${inv.paidVia}` : ""}${inv.paidRef ? ` · ${inv.paidRef}` : ""}`}
            {inv.status === "ISSUED" && `Due ${when(inv.dueAt)}${inv.remindersSent ? ` · ${inv.remindersSent} reminder${inv.remindersSent === 1 ? "" : "s"}` : ""}`}
            {inv.status === "VOID" && (inv.voidReason ?? "Voided")}
          </p>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <a className="btn btn-quiet btn-xs" href={`/api/platform/invoices/${inv.id}/pdf`} target="_blank" rel="noreferrer">
          <Icon name="file" className="h-3.5 w-3.5" /> PDF
        </a>
        {inv.status === "ISSUED" && (
          <>
            <button type="button" className="btn btn-quiet btn-xs" disabled={busy} onClick={() => setOpen(open === "paid" ? null : "paid")}>
              <Icon name="check" className="h-3.5 w-3.5" /> Mark paid
            </button>
            <button type="button" className="btn btn-quiet btn-xs" disabled={busy} onClick={() => act({ action: "link" })}>
              <Icon name="share" className="h-3.5 w-3.5" /> {busy && !open ? "Working…" : payUrl ? "Refresh pay link" : "Make pay link"}
            </button>
            {owner && (
              <button type="button" className="btn btn-quiet btn-xs" disabled={busy} onClick={() => setOpen(open === "void" ? null : "void")}>
                <Icon name="x" className="h-3.5 w-3.5" /> Void
              </button>
            )}
          </>
        )}
      </div>

      {payUrl && inv.status === "ISSUED" && (
        <div className="flex items-center gap-2 rounded-xl bg-ink/5 px-3 py-1.5 min-w-0">
          <a href={payUrl} target="_blank" rel="noreferrer" className="flex-1 min-w-0 font-mono text-xs break-all text-[var(--mor)] hover:underline">
            {payUrl}
          </a>
          <CopyButton text={payUrl} />
        </div>
      )}

      {open === "paid" && (
        <form
          className="rounded-2xl border border-[var(--line)] bg-white p-3 grid gap-3 sm:grid-cols-[1fr_180px_auto] items-end"
          onSubmit={(e) => {
            e.preventDefault();
            act({ action: "paid", ref: ref.trim(), via });
          }}
        >
          <Field label="Payment reference" hint="UTR, UPI reference or cheque number">
            <input className="input" value={ref} onChange={(e) => setRef(e.target.value)} maxLength={120} required />
          </Field>
          <Field label="Paid by">
            <select className="input" value={via} onChange={(e) => setVia(e.target.value)}>
              {METHODS.map((m) => (
                <option key={m} value={m}>
                  {m}
                </option>
              ))}
            </select>
          </Field>
          <button type="submit" className="btn btn-primary btn-sm" disabled={busy || !ref.trim()}>
            {busy ? "Saving…" : "Mark paid"}
          </button>
        </form>
      )}

      {open === "void" && owner && (
        <div className="rounded-2xl border border-[var(--line)] bg-white p-3 space-y-3">
          <Field label="Why is it voided?">
            <input className="input" value={reason} onChange={(e) => setReason(e.target.value)} maxLength={300} />
          </Field>
          <ConfirmButton
            label="Void invoice"
            question={`Void ${inv.number}? It cannot be un-voided.`}
            yes="Yes, void it"
            busy={busy}
            disabled={!reason.trim()}
            onConfirm={() => act({ action: "void", reason: reason.trim() })}
          />
        </div>
      )}

      <ErrLine text={error} />
    </li>
  );
}
