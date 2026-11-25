"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import Icon from "@/components/Icon";
import { ErrorBox, useFetch } from "@/components/admin/AdminKit";
import { StatusChip, TableWrap, ago, inr, num, when } from "./kit";

type Row = {
  id: string;
  slug: string;
  name: string;
  status: string;
  plan: string;
  createdAt: string;
  suspendReason: string | null;
  deleteAfter: string | null;
  subscription: { status: string; planCode: string; nextPlanCode: string | null; trialEndsAt: string | null; periodEnd: string } | null;
  staff: number;
  retailers: number;
  orders30d: number;
  lastOrderAt: string | null;
  overduePaise: number;
};

const STATUSES = [
  { v: "", label: "All but closed" },
  { v: "TRIAL", label: "Trial" },
  { v: "ACTIVE", label: "Active" },
  { v: "SUSPENDED", label: "Paused" },
  { v: "CLOSED", label: "Closed" },
];

export default function TenantsList() {
  const [q, setQ] = useState("");
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState("");
  const [take, setTake] = useState(100);

  useEffect(() => {
    const t = setTimeout(() => setQuery(q.trim()), 300);
    return () => clearTimeout(t);
  }, [q]);

  const sp = new URLSearchParams();
  if (query) sp.set("q", query);
  if (status) sp.set("status", status);
  sp.set("take", String(take));
  const url = `/api/platform/tenants?${sp}`;
  const { data, error, reload } = useFetch<{ tenants: Row[] }>(url);
  const rows = data?.tenants ?? [];

  return (
    <div className="space-y-5 pb-16">
      <div>
        <p className="page-kick">Platform</p>
        <h1 className="page-title">Tenants</h1>
        <p className="page-sub">Every business on the platform, newest first.</p>
      </div>

      <div className="flex flex-wrap gap-2">
        <div className="relative flex-1 min-w-[200px]">
          <Icon name="search" className="h-4 w-4 absolute left-3 top-1/2 -translate-y-1/2 text-[var(--muted)]" />
          <input className="input !pl-9" type="search" placeholder="Name, address or GSTIN" value={q} onChange={(e) => setQ(e.target.value)} />
        </div>
        <select className="input !w-auto" value={status} onChange={(e) => setStatus(e.target.value)} aria-label="Status">
          {STATUSES.map((s) => (
            <option key={s.v} value={s.v}>
              {s.label}
            </option>
          ))}
        </select>
      </div>

      {error && <ErrorBox message={error} onRetry={reload} />}
      {!error && !data && <p className="text-sm text-[var(--muted)]">Loading…</p>}

      {data && (
        <div className="card p-0 sm:p-1 overflow-hidden">
          {rows.length === 0 ? (
            <p className="p-5 text-sm text-[var(--muted)]">No businesses match.</p>
          ) : (
            <TableWrap bleed={false}>
              <thead>
                <tr>
                  <th>Business</th>
                  <th>Status</th>
                  <th>Plan</th>
                  <th>Trial ends</th>
                  <th className="!text-right">Staff / shops</th>
                  <th className="!text-right">Orders 30d</th>
                  <th>Last order</th>
                  <th className="!text-right">Overdue</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((t) => (
                  <tr key={t.id}>
                    <td className="max-w-[240px]">
                      <Link href={`/platform/tenants/${t.id}`} className="font-semibold text-[var(--mor)] hover:underline break-words">
                        {t.name}
                      </Link>
                      <span className="block text-xs text-[var(--muted)] font-mono">{t.slug}</span>
                      {t.suspendReason && <span className="block text-xs text-[var(--risk-text)]">{t.suspendReason}</span>}
                      {t.deleteAfter && <span className="block text-xs text-[var(--risk-text)]">Deletes {when(t.deleteAfter)}</span>}
                    </td>
                    <td>
                      <StatusChip value={t.status} />
                    </td>
                    <td>
                      <span className="font-mono text-xs">{t.subscription?.planCode ?? t.plan}</span>
                      {t.subscription?.nextPlanCode && <span className="block text-xs text-[var(--muted)]">then {t.subscription.nextPlanCode}</span>}
                      {t.subscription && (
                        <span className="block mt-0.5">
                          <StatusChip value={t.subscription.status} />
                        </span>
                      )}
                    </td>
                    <td className="whitespace-nowrap">{t.subscription?.status === "TRIAL" ? when(t.subscription.trialEndsAt) : "—"}</td>
                    <td className="!text-right tabular-nums">
                      {num(t.staff)} / {num(t.retailers)}
                    </td>
                    <td className="!text-right tabular-nums">{num(t.orders30d)}</td>
                    <td className="whitespace-nowrap" title={when(t.lastOrderAt, true)}>
                      {ago(t.lastOrderAt)}
                    </td>
                    <td className={`!text-right tabular-nums ${t.overduePaise ? "text-[var(--risk-text)] font-semibold" : "text-[var(--muted)]"}`}>
                      {t.overduePaise ? inr(t.overduePaise) : "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </TableWrap>
          )}
        </div>
      )}
      {data && rows.length >= take && take < 500 && (
        <button type="button" className="btn btn-quiet btn-sm" onClick={() => setTake(Math.min(take + 100, 500))}>
          Show more
        </button>
      )}
    </div>
  );
}
