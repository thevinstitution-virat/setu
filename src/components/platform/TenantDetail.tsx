"use client";

import Link from "next/link";
import Icon from "@/components/Icon";
import { ErrorBox, useFetch } from "@/components/admin/AdminKit";
import InvoiceList from "./InvoiceList";
import TenantPlanPanel from "./TenantPlanPanel";
import TenantOverrides from "./TenantOverrides";
import TenantSupport from "./TenantSupport";
import TenantAdmins from "./TenantAdmins";
import TenantAndroid from "./TenantAndroid";
import TenantDataPanel from "./TenantDataPanel";
import { Kpi, Section, StatusChip, TableWrap, ago, inr, num, when } from "./kit";
import type { TenantData } from "./tenant-types";

const METRIC_LABEL: Record<string, string> = { ai_credits: "AI credits", messages: "Messages", api_calls: "API calls" };

export default function TenantDetail({ id }: { id: string }) {
  const { data, error, reload } = useFetch<TenantData>(`/api/platform/tenants/${id}`);

  if (error && !data) {
    return (
      <div className="space-y-4">
        <BackLink />
        <ErrorBox message={error} onRetry={reload} />
      </div>
    );
  }
  if (!data) return <p className="text-sm text-[var(--muted)]">Loading…</p>;

  const { tenant: t, subscription: sub, health: h } = data;

  return (
    <div className="space-y-5 pb-16">
      <BackLink />
      <div className="page-head">
        <div className="min-w-0">
          <p className="page-kick">Business · {t.slug}</p>
          <h1 className="page-title break-words">{t.name}</h1>
          <div className="flex flex-wrap gap-1.5 mt-2">
            <StatusChip value={t.status} />
            {sub && <StatusChip value={sub.status} label={`Billing: ${sub.status.toLowerCase().replace("_", " ")}`} tone={sub.status === "ACTIVE" ? "mint" : sub.status === "TRIAL" ? "genda" : "kesar"} />}
            {sub?.status === "TRIAL" && sub.trialEndsAt && <StatusChip value="x" label={`Trial ends ${when(sub.trialEndsAt)}`} />}
            {sub?.nextPlanCode && <StatusChip value="x" label={`Then ${sub.nextPlanCode}`} />}
            {t.deleteAfter && <StatusChip value="x" tone="red" label={`Deletes ${when(t.deleteAfter)}`} />}
          </div>
        </div>
      </div>
      {error && <ErrorBox message={error} onRetry={reload} />}

      <section aria-label="At a glance" className="grid grid-cols-2 xl:grid-cols-4 gap-3 sm:gap-4">
        <Kpi icon="users" tone="mor" label="Staff logins" value={num(data.limits.staff.used)} note={data.limits.staff.limit !== null ? `of ${num(data.limits.staff.limit)} on the plan` : "No limit"} />
        <Kpi icon="cart" tone="blue" label="Shops" value={num(data.limits.retailers.used)} note={data.limits.retailers.limit !== null ? `of ${num(data.limits.retailers.limit)} on the plan` : "No limit"} />
        <Kpi icon="box" tone="kesar" label="Orders, 30 days" value={num(h.orders30d)} note="Placed in the last 30 days" />
        <Kpi icon="clock" tone="mint" label="Last order" value={ago(h.lastOrderAt)} note={h.lastOrderAt ? when(h.lastOrderAt, true) : "No orders yet"} />
      </section>

      {(h.messagesFailed24h > 0 || h.webhooksDead24h > 0 || h.einvoiceFailed > 0) && (
        <div className="card p-4 !bg-[#fde4e1]/70 flex flex-wrap gap-x-5 gap-y-1 text-sm text-[#a8281e]">
          <Icon name="alert" className="h-5 w-5 shrink-0" />
          {h.messagesFailed24h > 0 && <span>{num(h.messagesFailed24h)} messages failed (24 h)</span>}
          {h.webhooksDead24h > 0 && <span>{num(h.webhooksDead24h)} webhooks given up (24 h)</span>}
          {h.einvoiceFailed > 0 && <span>{num(h.einvoiceFailed)} e-invoices failed</span>}
        </div>
      )}

      <div className="grid gap-5 lg:grid-cols-2 items-start">
        <div className="space-y-5 min-w-0">
          <Section title="Business">
            <dl className="grid gap-x-4 gap-y-1.5 text-sm sm:grid-cols-[120px_1fr]">
              <Row k="Legal name" v={t.legalName} />
              <Row k="GSTIN" v={t.gstin} mono />
              <Row k="State code" v={t.stateCode} />
              <Row k="Address" v={t.address} />
              <Row k="Phone" v={t.phone} />
              <Row k="Joined" v={when(t.createdAt)} />
              {sub?.billingEmail && <Row k="Billing email" v={sub.billingEmail} />}
            </dl>
            {data.domains.length > 0 && (
              <div className="space-y-1">
                <p className="text-xs font-bold text-[var(--muted)] uppercase tracking-wide">Own addresses</p>
                <ul className="text-sm space-y-1">
                  {data.domains.map((d) => (
                    <li key={d.id} className="flex flex-wrap items-center gap-2">
                      <span className="font-mono break-all">{d.host}</span>
                      <StatusChip value="x" label={d.verifiedAt ? "Verified" : "Not verified"} tone={d.verifiedAt ? "mint" : "genda"} />
                      {d.tlsStatus && <span className="text-xs text-[var(--muted)]">TLS: {d.tlsStatus}</span>}
                      {d.lastError && <span className="text-xs text-[#a8281e] w-full">{d.lastError}</span>}
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </Section>

          <TenantPlanPanel data={data} onChanged={reload} />
          <TenantOverrides key={JSON.stringify(t.overrides ?? {})} data={data} onChanged={reload} />
          <UsageTable data={data} />
        </div>

        <div className="space-y-5 min-w-0">
          <TenantAdmins tenantId={t.id} closed={t.status === "CLOSED"} />
          <TenantSupport data={data} onChanged={reload} />
          <Section title="Invoices" sub="The latest 24.">
            <InvoiceList invoices={data.invoices} onChanged={reload} showTenant={false} />
          </Section>
          <TenantDataPanel data={data} onChanged={reload} />
          {t.status !== "CLOSED" && <TenantAndroid tenantId={t.id} slug={t.slug} />}
        </div>
      </div>
    </div>
  );
}

function BackLink() {
  return (
    <Link href="/platform" className="inline-flex items-center gap-1 text-sm font-semibold text-[var(--mor)] hover:underline">
      <Icon name="chevronLeft" className="h-4 w-4" /> All businesses
    </Link>
  );
}

function Row({ k, v, mono }: { k: string; v: string | null | undefined; mono?: boolean }) {
  return (
    <>
      <dt className="text-[var(--muted)]">{k}</dt>
      <dd className={`break-words ${mono ? "font-mono" : ""}`}>{v || <span className="text-[var(--muted)]">—</span>}</dd>
    </>
  );
}

function UsageTable({ data }: { data: TenantData }) {
  const metrics = [...new Set(data.usage.map((u) => u.metric))].sort();
  const periods = [...new Set(data.usage.map((u) => u.period))].sort().reverse();
  const cell = (p: string, m: string) => data.usage.find((u) => u.period === p && u.metric === m)?.value ?? 0;
  const cost = (p: string) => data.usage.filter((u) => u.period === p).reduce((s, u) => s + u.costPaise, 0);
  return (
    <Section title="Usage by month" sub={`This month is ${data.thisPeriod}. Cost is what the AI provider charges us.`}>
      {periods.length === 0 ? (
        <p className="text-sm text-[var(--muted)]">Nothing metered yet.</p>
      ) : (
        <TableWrap>
          <thead>
            <tr>
              <th>Month</th>
              {metrics.map((m) => (
                <th key={m} className="!text-right">
                  {METRIC_LABEL[m] ?? m}
                </th>
              ))}
              <th className="!text-right">Our cost</th>
            </tr>
          </thead>
          <tbody>
            {periods.map((p) => (
              <tr key={p}>
                <td className="font-mono">{p}</td>
                {metrics.map((m) => (
                  <td key={m} className="!text-right tabular-nums">
                    {num(cell(p, m))}
                  </td>
                ))}
                <td className="!text-right tabular-nums">{inr(cost(p))}</td>
              </tr>
            ))}
          </tbody>
        </TableWrap>
      )}
    </Section>
  );
}
