"use client";

import Link from "next/link";
import Icon from "@/components/Icon";
import { ErrorBox, useFetch } from "@/components/admin/AdminKit";
import RunBilling from "./RunBilling";
import { Section, TableWrap, inr, num, when } from "./kit";

type Data = {
  db: { ok: boolean; ms: number };
  jobs: { failed24h: number; waiting: number; oldestWaitingMin: number | null } | null;
  tenants: { tenantId: string; name: string; slug: string; messagesFailed: number; webhooksDead: number; einvoiceFailed: number; overduePaise: number }[];
  deleting: { id: string; name: string; deleteAfter: string }[];
  paused: { id: string; name: string; suspendReason: string | null; suspendedAt: string | null }[];
  readiness: { checks: { id: string; label: string; status: "ok" | "warn" | "fail"; detail: string }[]; fails: number; warnings: number };
};

type Tone = "ok" | "warn" | "bad";

const TONE: Record<Tone, string> = {
  ok: "border-[var(--mint)]/40",
  warn: "!bg-[var(--scheme-tint)] border-[var(--genda)]/50",
  bad: "!bg-[var(--risk-tint)] border-[var(--risk-text)]/30",
};

function Light({ tone, title, value, note }: { tone: Tone; title: string; value: string; note?: string }) {
  const icon = tone === "ok" ? "check" : "alert";
  const color = tone === "ok" ? "text-[var(--success-text)]" : tone === "warn" ? "text-[var(--scheme-text)]" : "text-[var(--risk-text)]";
  return (
    <div className={`card p-4 border-2 ${TONE[tone]} min-w-0`}>
      <p className={`text-sm font-semibold flex items-center gap-1.5 ${color}`}>
        <Icon name={icon} className="h-4 w-4 shrink-0" /> {title}
      </p>
      <p className="stat-num !text-2xl mt-2">{value}</p>
      {note && <p className="text-xs text-[var(--muted)] mt-1">{note}</p>}
    </div>
  );
}

const RANK = { fail: 0, warn: 1, ok: 2 } as const;

const bad = (n: number) => (n > 0 ? "text-[var(--risk-text)] font-semibold" : "text-[var(--muted)]");

export default function HealthPage() {
  const { data, error, reload } = useFetch<Data>("/api/platform/health");

  const jobsTone: Tone = !data?.jobs ? "bad" : data.jobs.failed24h > 0 || (data.jobs.oldestWaitingMin ?? 0) > 30 ? (data.jobs.failed24h > 10 || (data.jobs.oldestWaitingMin ?? 0) > 120 ? "bad" : "warn") : "ok";
  const problemCount = data ? data.tenants.length : 0;

  return (
    <div className="space-y-5 pb-16">
      <div className="page-head">
        <div>
          <p className="page-kick">Platform</p>
          <h1 className="page-title">Health</h1>
          <p className="page-sub">What went wrong in the last day, overdue bills, paused businesses and scheduled deletions.</p>
        </div>
        <button type="button" className="btn btn-quiet btn-sm" onClick={reload}>
          Refresh
        </button>
      </div>

      {error && <ErrorBox message={error} onRetry={reload} />}
      {!data && !error && <p className="text-sm text-[var(--muted)]">Loading…</p>}

      {data && (
        <>
          <div className="grid gap-3 sm:grid-cols-3">
            <Light tone={data.db.ms > 500 ? "warn" : "ok"} title="Database" value={`${num(data.db.ms)} ms`} note="Time for one query" />
            {data.jobs ? (
              <Light
                tone={jobsTone}
                title="Background jobs"
                value={`${num(data.jobs.failed24h)} failed`}
                note={`${num(data.jobs.waiting)} waiting${data.jobs.oldestWaitingMin !== null ? ` · oldest ${num(data.jobs.oldestWaitingMin)} min` : ""} · last 24 h`}
              />
            ) : (
              <Light tone="bad" title="Background jobs" value="No queue" note="The worker has never started (no queue tables)." />
            )}
            <Light tone={problemCount ? "warn" : "ok"} title="Businesses with problems" value={num(problemCount)} note="Failed messages, dead webhooks, failed e-invoices or overdue bills" />
          </div>

          <Section
            title="Ready for real businesses"
            sub={`Server settings checked before go-live: ${data.readiness.fails} failing, ${data.readiness.warnings} to look at. The same list: npm run golive:check.`}
          >
            <ul className="divide-y divide-[var(--line)]">
              {[...data.readiness.checks]
                .sort((a, b) => RANK[a.status] - RANK[b.status])
                .map((c) => (
                  <li key={c.id} className="py-2 text-sm flex gap-2 items-start">
                    <Icon
                      name={c.status === "ok" ? "check" : "alert"}
                      className={`h-4 w-4 shrink-0 mt-0.5 ${c.status === "ok" ? "text-[var(--success-text)]" : c.status === "warn" ? "text-[var(--scheme-text)]" : "text-[var(--risk-text)]"}`}
                    />
                    <span className="min-w-0">
                      <span className="font-semibold">{c.label}</span>
                      <span className="block text-xs text-[var(--muted)] break-words">{c.detail}</span>
                    </span>
                  </li>
                ))}
            </ul>
          </Section>

          <Section title="Problems by business" sub="Messages and webhooks: last 24 hours. E-invoices: all still failed. Overdue: unpaid past the due date.">
            {data.tenants.length === 0 ? (
              <p className="text-sm text-[var(--success-text)] flex items-center gap-1.5">
                <Icon name="check" className="h-4 w-4" /> Nothing wrong.
              </p>
            ) : (
              <TableWrap>
                <thead>
                  <tr>
                    <th>Business</th>
                    <th className="!text-right">Messages failed</th>
                    <th className="!text-right">Webhooks dead</th>
                    <th className="!text-right">E-invoices failed</th>
                    <th className="!text-right">Overdue</th>
                  </tr>
                </thead>
                <tbody>
                  {[...data.tenants]
                    .sort((a, b) => b.overduePaise - a.overduePaise || b.messagesFailed + b.webhooksDead + b.einvoiceFailed - (a.messagesFailed + a.webhooksDead + a.einvoiceFailed))
                    .map((t) => (
                      <tr key={t.tenantId}>
                        <td>
                          <Link href={`/platform/tenants/${t.tenantId}`} className="font-semibold text-[var(--mor)] hover:underline">
                            {t.name}
                          </Link>
                          <span className="block text-xs text-[var(--muted)]">{t.slug}</span>
                        </td>
                        <td className={`!text-right tabular-nums ${bad(t.messagesFailed)}`}>{num(t.messagesFailed)}</td>
                        <td className={`!text-right tabular-nums ${bad(t.webhooksDead)}`}>{num(t.webhooksDead)}</td>
                        <td className={`!text-right tabular-nums ${bad(t.einvoiceFailed)}`}>{num(t.einvoiceFailed)}</td>
                        <td className={`!text-right tabular-nums ${bad(t.overduePaise)}`}>{t.overduePaise ? inr(t.overduePaise) : "—"}</td>
                      </tr>
                    ))}
                </tbody>
              </TableWrap>
            )}
          </Section>

          <div className="grid gap-5 lg:grid-cols-2 items-start">
            <Section title="Paused businesses" sub="Reasons starting with billing: were paused by the billing job.">
              {data.paused.length === 0 ? (
                <p className="text-sm text-[var(--muted)]">None.</p>
              ) : (
                <ul className="divide-y divide-[var(--line)]">
                  {data.paused.map((p) => (
                    <li key={p.id} className="py-2 text-sm">
                      <Link href={`/platform/tenants/${p.id}`} className="font-semibold text-[var(--mor)] hover:underline">
                        {p.name}
                      </Link>
                      <span className="block text-xs text-[var(--muted)]">
                        {p.suspendReason ?? "No reason"} {p.suspendedAt && `· since ${when(p.suspendedAt, true)}`}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </Section>
            <Section title="Scheduled deletions">
              {data.deleting.length === 0 ? (
                <p className="text-sm text-[var(--muted)]">None.</p>
              ) : (
                <ul className="divide-y divide-[var(--line)]">
                  {data.deleting.map((d) => (
                    <li key={d.id} className="py-2 text-sm flex flex-wrap justify-between gap-2">
                      <Link href={`/platform/tenants/${d.id}`} className="font-semibold text-[var(--mor)] hover:underline">
                        {d.name}
                      </Link>
                      <span className="text-[var(--risk-text)] font-semibold">{when(d.deleteAfter, true)}</span>
                    </li>
                  ))}
                </ul>
              )}
            </Section>
          </div>
        </>
      )}

      <RunBilling onDone={reload} />
    </div>
  );
}
