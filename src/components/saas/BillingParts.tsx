"use client";

/** Pieces of the owner's billing screen: plan cards and our invoices to the business. */

import Icon from "@/components/Icon";
import { SMALL_CHIP, inr, istDate, plural } from "@/components/saas/SaasKit";

export type PlanCard = {
  code: string;
  name: string;
  basePaise: number;
  seatPaise: number;
  retailerPaise: number;
  aiCredits: number;
  aiCreditPaise: number;
  limits: { staff?: number; retailers?: number };
  features: string[];
};

export type Module = { code: string; label: string; on: boolean };

export type PlatformInvoice = {
  id: string;
  number: string;
  issuedAt: string;
  dueAt: string;
  periodStart: string;
  periodEnd: string;
  total: number;
  status: "ISSUED" | "PAID" | "VOID";
  paidAt: string | null;
  payUrl: string | null;
  overdue: boolean;
};

export function PlanOption({
  plan,
  modules,
  gstRegistered,
  badge,
  action,
}: {
  plan: PlanCard;
  modules: Module[];
  gstRegistered: boolean;
  badge?: string | null;
  action: React.ReactNode;
}) {
  const extras: string[] = [];
  if (plan.seatPaise > 0) extras.push(`+ ${inr(plan.seatPaise)} per staff login`);
  if (plan.retailerPaise > 0) extras.push(`+ ${inr(plan.retailerPaise)} per active shop`);
  const limits = [
    plan.limits.staff !== undefined ? plural(plan.limits.staff, "staff login") : "Any number of staff",
    plan.limits.retailers !== undefined ? plural(plan.limits.retailers, "shop") : "any number of shops",
  ];
  return (
    <div className={`card p-5 flex flex-col gap-3 min-w-0 ${badge ? "ring-2 ring-[var(--kesar)]" : ""}`}>
      <div className="flex items-start justify-between gap-2">
        <p className="font-heading text-lg font-bold">{plan.name}</p>
        {badge && <span className={`${SMALL_CHIP} chip-kesar`}>{badge}</span>}
      </div>
      <div>
        <p>
          <span className="stat-num">{inr(plan.basePaise)}</span>
          <span className="text-sm text-[var(--muted)]"> / month</span>
        </p>
        {extras.length > 0 && <p className="text-xs text-[var(--ink-2)] mt-1">{extras.join(" · ")} a month</p>}
        <p className="text-xs text-[var(--muted)] mt-1">{gstRegistered ? "Plus 18% GST." : "No GST is charged."}</p>
      </div>
      <ul className="text-sm space-y-1">
        <li className="flex items-start gap-2">
          <Icon name="users" className="h-4 w-4 shrink-0 mt-0.5 text-[var(--muted)]" />
          <span>Up to {limits.join(" and ")}</span>
        </li>
        <li className="flex items-start gap-2">
          <Icon name="star" className="h-4 w-4 shrink-0 mt-0.5 text-[var(--muted)]" />
          <span>
            {plan.aiCredits > 0 ? `${plan.aiCredits.toLocaleString("en-IN")} AI credits a month included` : "No AI credits included"}
            {plan.aiCreditPaise > 0 ? `, then ${inr(plan.aiCreditPaise)} each` : ""}
          </span>
        </li>
      </ul>
      <ul className="text-sm space-y-1 border-t border-[var(--line)] pt-3">
        {modules.map((m) => {
          const has = plan.features.includes(m.code);
          return (
            <li key={m.code} className={`flex items-start gap-2 ${has ? "" : "text-[var(--muted)]"}`}>
              <Icon name={has ? "check" : "x"} className={`h-4 w-4 shrink-0 mt-0.5 ${has ? "text-[var(--mint-text)]" : "opacity-50"}`} />
              <span className={has ? "" : "line-through decoration-1"}>{m.label}</span>
            </li>
          );
        })}
      </ul>
      <div className="mt-auto pt-1">{action}</div>
    </div>
  );
}

export function InvoiceStatus({ inv }: { inv: PlatformInvoice }) {
  if (inv.status === "PAID") return <span className={`${SMALL_CHIP} chip-mint`}>Paid {istDate(inv.paidAt)}</span>;
  if (inv.status === "VOID") return <span className={SMALL_CHIP}>Cancelled</span>;
  if (inv.overdue) return <span className={`${SMALL_CHIP} chip-kesar`}>Overdue since {istDate(inv.dueAt)}</span>;
  return <span className={`${SMALL_CHIP} chip-genda`}>Due {istDate(inv.dueAt)}</span>;
}

export function InvoiceRow({ inv }: { inv: PlatformInvoice }) {
  const unpaid = inv.status === "ISSUED";
  return (
    <li className="flex flex-wrap items-center gap-3 py-3 border-b border-[var(--line)] last:border-0">
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <p className="font-semibold font-mono text-sm">{inv.number}</p>
          <InvoiceStatus inv={inv} />
        </div>
        <p className="text-xs text-[var(--muted)] mt-0.5">
          {istDate(inv.periodStart)} to {istDate(inv.periodEnd)} · issued {istDate(inv.issuedAt)}
        </p>
      </div>
      <p className={`font-bold tabular-nums ${inv.status === "VOID" ? "line-through text-[var(--muted)]" : ""}`}>{inr(inv.total)}</p>
      <div className="flex gap-2">
        {unpaid &&
          (inv.payUrl ? (
            <a href={inv.payUrl} target="_blank" rel="noopener noreferrer" className="btn btn-primary btn-sm">
              Pay
            </a>
          ) : (
            <span className="text-xs text-[var(--muted)] max-w-[10rem]">Pay link not ready. Contact support to pay.</span>
          ))}
        <a href={`/api/admin/billing/invoices/${inv.id}/pdf`} target="_blank" rel="noopener noreferrer" className="btn btn-quiet btn-sm">
          <Icon name="file" className="h-4 w-4" /> PDF
        </a>
      </div>
    </li>
  );
}
