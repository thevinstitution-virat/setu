"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { ErrorBox, api, errText, useFetch } from "@/components/admin/AdminKit";
import { when } from "./kit";

type Entry = {
  id: string;
  action: string;
  tenantId: string | null;
  tenantName: string | null;
  by: string | null;
  detail: unknown;
  ip: string | null;
  createdAt: string;
};

const PAGE = 100;

const ACTIONS = [
  { v: "", label: "Everything" },
  { v: "auth.", label: "Sign-ins" },
  { v: "tenant.", label: "Business changes" },
  { v: "support.", label: "Support sessions" },
  { v: "invoice.", label: "Invoices" },
  { v: "plan.", label: "Plans" },
  { v: "announcement.", label: "Announcements" },
  { v: "platform.", label: "Billing runs" },
];

export default function AuditPage() {
  const tenants = useFetch<{ tenants: { id: string; name: string }[] }>("/api/platform/tenants?take=500");
  const [action, setAction] = useState("");
  const [tenantId, setTenantId] = useState("");
  const [rows, setRows] = useState<Entry[]>([]);
  const [more, setMore] = useState(false);
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(
    async (before: string | null) => {
      setBusy(true);
      setError(null);
      const sp = new URLSearchParams();
      if (action) sp.set("action", action);
      if (tenantId) sp.set("tenantId", tenantId);
      if (before) sp.set("before", before);
      try {
        const r = await api<{ entries: Entry[] }>(`/api/platform/audit?${sp}`);
        setRows((cur) => (before ? [...cur, ...r.entries] : r.entries));
        setMore(r.entries.length >= PAGE);
      } catch (e) {
        setError(errText(e));
      } finally {
        setBusy(false);
      }
    },
    [action, tenantId]
  );

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load(null);
  }, [load]);

  return (
    <div className="space-y-5 pb-16">
      <div>
        <p className="page-kick">Platform</p>
        <h1 className="page-title">Audit</h1>
        <p className="page-sub">Everything done in this console, newest first.</p>
      </div>

      <div className="flex flex-wrap gap-2">
        <select className="input !w-auto" value={action} onChange={(e) => setAction(e.target.value)} aria-label="Kind">
          {ACTIONS.map((a) => (
            <option key={a.v} value={a.v}>
              {a.label}
            </option>
          ))}
        </select>
        <select className="input !w-auto max-w-full" value={tenantId} onChange={(e) => setTenantId(e.target.value)} aria-label="Business">
          <option value="">All businesses</option>
          {tenants.data?.tenants.map((t) => (
            <option key={t.id} value={t.id}>
              {t.name}
            </option>
          ))}
        </select>
      </div>

      {error && <ErrorBox message={error} onRetry={() => load(rows.length ? rows[rows.length - 1].createdAt : null)} />}

      <div className="card px-4 py-1">
        {rows.length === 0 && !busy && !error && <p className="py-4 text-sm text-[var(--muted)]">Nothing logged.</p>}
        <ul className="divide-y divide-[var(--line)]">
          {rows.map((r) => (
            <li key={r.id} className="py-2.5 text-sm space-y-0.5">
              <div className="flex flex-wrap items-baseline gap-x-3 gap-y-0.5">
                <span className={`font-mono font-semibold ${r.action.endsWith("failed") ? "text-[#a8281e]" : ""}`}>{r.action}</span>
                {r.tenantId && (
                  <Link href={`/platform/tenants/${r.tenantId}`} className="text-[var(--mor)] hover:underline">
                    {r.tenantName ?? r.tenantId}
                  </Link>
                )}
                <span className="ml-auto text-xs text-[var(--muted)] whitespace-nowrap">{when(r.createdAt, true)}</span>
              </div>
              <p className="text-xs text-[var(--muted)]">
                {r.by ?? "System"}
                {r.ip && ` · ${r.ip}`}
              </p>
              {r.detail !== null && r.detail !== undefined && <Detail value={r.detail} />}
            </li>
          ))}
        </ul>
        {busy && <p className="py-3 text-sm text-[var(--muted)]">Loading…</p>}
      </div>

      {more && !busy && (
        <button type="button" className="btn btn-quiet btn-sm" onClick={() => load(rows[rows.length - 1].createdAt)}>
          Older entries
        </button>
      )}
    </div>
  );
}

function Detail({ value }: { value: unknown }) {
  const text = JSON.stringify(value);
  if (!text || text === "{}") return null;
  if (text.length <= 140) return <p className="font-mono text-[11.5px] text-[var(--ink-2)] break-all">{text}</p>;
  return (
    <details>
      <summary className="cursor-pointer text-xs font-bold text-[var(--kesar-text)]">Details</summary>
      <pre className="mt-1 rounded-xl bg-ink/5 p-2 text-[11.5px] font-mono overflow-x-auto max-h-72">{JSON.stringify(value, null, 2)}</pre>
    </details>
  );
}
