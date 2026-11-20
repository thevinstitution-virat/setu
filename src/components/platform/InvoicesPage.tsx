"use client";

import { useState } from "react";
import { ErrorBox, TabBar, useFetch } from "@/components/admin/AdminKit";
import InvoiceList, { type PlatformInvoice } from "./InvoiceList";
import { inr, num } from "./kit";

type Totals = { status: "ISSUED" | "PAID" | "VOID"; _sum: { total: number | null }; _count: number }[];

const TABS = [
  { key: "all", label: "All" },
  { key: "ISSUED", label: "Unpaid" },
  { key: "overdue", label: "Overdue" },
  { key: "PAID", label: "Paid" },
  { key: "VOID", label: "Void" },
] as const;

type Tab = (typeof TABS)[number]["key"];

const TOTAL_LABEL = { ISSUED: "Unpaid", PAID: "Paid", VOID: "Void" } as const;

export default function InvoicesPage() {
  const [tab, setTab] = useState<Tab>("all");
  const url = tab === "all" ? "/api/platform/invoices" : tab === "overdue" ? "/api/platform/invoices?overdue=1" : `/api/platform/invoices?status=${tab}`;
  const { data, error, reload } = useFetch<{ invoices: PlatformInvoice[]; totals: Totals }>(url);

  return (
    <div className="space-y-5 pb-16 max-w-4xl">
      <div>
        <p className="page-kick">Platform</p>
        <h1 className="page-title">Invoices</h1>
        <p className="page-sub">Our GST invoices to businesses for their subscription. The latest 200 are shown.</p>
      </div>

      {data && (
        <div className="grid grid-cols-3 gap-3">
          {(["ISSUED", "PAID", "VOID"] as const).map((s) => {
            const t = data.totals.find((x) => x.status === s);
            return (
              <div key={s} className="card p-3 sm:p-4 min-w-0">
                <p className="stat-num !text-lg sm:!text-2xl truncate">{inr(t?._sum.total ?? 0)}</p>
                <p className="stat-lbl">
                  {TOTAL_LABEL[s]} · {num(t?._count ?? 0)}
                </p>
              </div>
            );
          })}
        </div>
      )}

      <TabBar tabs={TABS} value={tab} onChange={setTab} />

      {error && <ErrorBox message={error} onRetry={reload} />}
      {!data && !error && <p className="text-sm text-[var(--muted)]">Loading…</p>}
      {data && (
        <div className="card px-4 py-1">
          <InvoiceList invoices={data.invoices} onChanged={reload} />
        </div>
      )}
    </div>
  );
}
