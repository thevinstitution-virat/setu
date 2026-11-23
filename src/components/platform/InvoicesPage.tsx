"use client";

import { useState } from "react";
import { ErrorBox, TabBar, useFetch } from "@/components/admin/AdminKit";
import InvoiceList, { type PlatformInvoice } from "./InvoiceList";
import { Kpi, inr, num } from "./kit";

type Totals = { status: "ISSUED" | "PAID" | "VOID"; _sum: { total: number | null }; _count: number }[];

const TABS = [
  { key: "all", label: "All" },
  { key: "ISSUED", label: "Unpaid" },
  { key: "overdue", label: "Overdue" },
  { key: "PAID", label: "Paid" },
  { key: "VOID", label: "Void" },
] as const;

type Tab = (typeof TABS)[number]["key"];

const TOTAL_TILE = {
  ISSUED: { label: "Unpaid", icon: "receipt", tone: "kesar", tab: "ISSUED" },
  PAID: { label: "Paid", icon: "check", tone: "mint", tab: "PAID" },
  VOID: { label: "Void", icon: "x", tone: "mor", tab: "VOID" },
} as const;

export default function InvoicesPage() {
  const [tab, setTab] = useState<Tab>("all");
  const url = tab === "all" ? "/api/platform/invoices" : tab === "overdue" ? "/api/platform/invoices?overdue=1" : `/api/platform/invoices?status=${tab}`;
  const { data, error, reload } = useFetch<{ invoices: PlatformInvoice[]; totals: Totals }>(url);

  return (
    <div className="space-y-5 pb-16">
      <div>
        <p className="page-kick">Customers</p>
        <h1 className="page-title">Invoices</h1>
        <p className="page-sub">Our GST invoices to businesses for their subscription. The latest 200 are shown.</p>
      </div>

      {data && (
        <section aria-label="Totals" className="grid grid-cols-2 sm:grid-cols-3 gap-3 sm:gap-4">
          {(["ISSUED", "PAID", "VOID"] as const).map((s) => {
            const t = data.totals.find((x) => x.status === s);
            const tile = TOTAL_TILE[s];
            const n = t?._count ?? 0;
            return (
              <Kpi
                key={s}
                icon={tile.icon}
                tone={tile.tone}
                label={tile.label}
                value={inr(t?._sum.total ?? 0)}
                note={`${num(n)} invoice${n === 1 ? "" : "s"}`}
                onClick={() => setTab(tab === tile.tab ? "all" : tile.tab)}
                active={tab === tile.tab}
              />
            );
          })}
        </section>
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
