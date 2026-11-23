"use client";

import Link from "next/link";
import { useState } from "react";
import { ErrorBox, useFetch } from "@/components/admin/AdminKit";
import RunBilling from "./RunBilling";
import { Kpi, TableWrap, inr, num } from "./kit";
import type { IconName } from "@/components/Icon";

type Data = {
  period: string;
  tenants: { tenantId: string; name: string; slug: string; plan: string; metrics: Record<string, number>; costPaise: number }[];
  totals: { metrics: Record<string, number>; costPaise: number };
};

const LABEL: Record<string, string> = { ai_credits: "AI credits", messages: "Messages", api_calls: "API calls" };
const BASE = ["ai_credits", "messages", "api_calls"];
const TILE: Record<string, { icon: IconName; tone: "kesar" | "mor" | "blue" }> = {
  ai_credits: { icon: "sparkle", tone: "kesar" },
  messages: { icon: "chat", tone: "mor" },
  api_calls: { icon: "share", tone: "blue" },
};

export default function UsagePage() {
  const [period, setPeriod] = useState("");
  const { data, error, reload } = useFetch<Data>(`/api/platform/usage${period ? `?period=${period}` : ""}`);
  const metrics = data ? [...new Set([...BASE, ...Object.keys(data.totals.metrics)])] : BASE;

  return (
    <div className="space-y-5 pb-16">
      <div className="page-head">
        <div>
          <p className="page-kick">Platform</p>
          <h1 className="page-title">Usage</h1>
          <p className="page-sub">Metered use and our AI provider cost per business, by month (India time).</p>
        </div>
        <label className="flex items-center gap-2 text-sm">
          <span className="text-[var(--ink-2)] font-medium">Month</span>
          <input className="input !w-auto" type="month" value={period || data?.period || ""} onChange={(e) => setPeriod(e.target.value)} />
        </label>
      </div>

      <RunBilling onDone={reload} />

      {error && <ErrorBox message={error} onRetry={reload} />}
      {!data && !error && <p className="text-sm text-[var(--muted)]">Loading…</p>}

      {data && (
        <>
          <section aria-label="This month's totals" className="grid grid-cols-2 xl:grid-cols-4 gap-3 sm:gap-4">
            {metrics.slice(0, 3).map((m) => (
              <Kpi key={m} icon={TILE[m]?.icon ?? "chart"} tone={TILE[m]?.tone ?? "mor"} label={LABEL[m] ?? m} value={num(data.totals.metrics[m])} note={`Every business, ${data.period}`} />
            ))}
            <Kpi icon="rupee" tone="red" label="Our AI cost" value={inr(data.totals.costPaise)} note="What the AI provider charges us" />
          </section>

          <div className="card p-0 sm:p-1 overflow-hidden">
            {data.tenants.length === 0 ? (
              <p className="p-5 text-sm text-[var(--muted)]">Nothing metered in {data.period}.</p>
            ) : (
              <TableWrap bleed={false}>
                <thead>
                  <tr>
                    <th>Business</th>
                    <th>Plan</th>
                    {metrics.map((m) => (
                      <th key={m} className="!text-right">
                        {LABEL[m] ?? m}
                      </th>
                    ))}
                    <th className="!text-right">Our cost</th>
                  </tr>
                </thead>
                <tbody>
                  {data.tenants.map((t) => (
                    <tr key={t.tenantId}>
                      <td>
                        <Link href={`/platform/tenants/${t.tenantId}`} className="font-semibold text-[var(--mor)] hover:underline">
                          {t.name}
                        </Link>
                        <span className="block text-xs text-[var(--muted)]">{t.slug}</span>
                      </td>
                      <td className="capitalize">{t.plan}</td>
                      {metrics.map((m) => (
                        <td key={m} className="!text-right tabular-nums">
                          {num(t.metrics[m])}
                        </td>
                      ))}
                      <td className="!text-right tabular-nums font-semibold">{inr(t.costPaise)}</td>
                    </tr>
                  ))}
                </tbody>
              </TableWrap>
            )}
          </div>
        </>
      )}
    </div>
  );
}
