"use client";

import { useState } from "react";
import Link from "next/link";
import Icon from "@/components/Icon";
import { formatINR } from "@/lib/money";
import { ErrorBox, TabBar, errText, send, shortDate, useFetch } from "@/components/admin/AdminKit";
import { VISIT_REASON, type VisitReason } from "@/lib/automation-math";

type Kind = "visit_plan" | "credit_limit" | "credit_stop" | "credit_restore" | "check" | "trip_plan";
type Status = "OPEN" | "ACCEPTED" | "REJECTED" | "EXPIRED";
type PlanShop = { retailerId: string; name: string; area: string; score: number; reasons: VisitReason[]; overdue: number; onRoute: boolean };
type PlannedTrip = { driverId: string; driverName: string; vehicleName: string | null; orderIds: string[]; drops: number; value: number; km: number | null; areas: string[] };
type Item = {
  id: string;
  kind: Kind;
  subjectId: string;
  title: string;
  detail: string;
  reasons: string[];
  payload: Record<string, unknown>;
  score: number;
  status: Status;
  forDate: string | null;
  auto: boolean;
  note: string | null;
  result: Record<string, unknown> | null;
  decidedBy: string | null;
  decidedAt: string | null;
  createdAt: string;
  expiresAt: string | null;
};
type Inbox = { items: Item[]; counts: Partial<Record<Kind, number>>; kinds: Kind[] };

const KIND_LABEL: Record<Kind, string> = {
  visit_plan: "Visit plans",
  credit_limit: "Credit limits",
  credit_stop: "Stop credit",
  credit_restore: "Credit back",
  check: "Checks",
  trip_plan: "Trip plans",
};
const ACCEPT_LABEL: Record<Kind, string> = {
  visit_plan: "Add to their day",
  credit_limit: "Change the limit",
  credit_stop: "Stop credit",
  credit_restore: "Give credit back",
  check: "Looked into it",
  trip_plan: "Make the trips",
};
const REJECT_LABEL: Partial<Record<Kind, string>> = { check: "Not a problem" };
const STATUS_TABS = [
  { key: "OPEN", label: "To decide" },
  { key: "ACCEPTED", label: "Accepted" },
  { key: "REJECTED", label: "Rejected" },
  { key: "EXPIRED", label: "Expired" },
] as const;

const rs = (p: number | null | undefined) => (p == null ? "no limit" : formatINR(p, { whole: true }));

/** The suggestions inbox: what the automations propose, with their reasons; accept or reject each. */
export default function SuggestionsPage() {
  const [status, setStatus] = useState<Status>("OPEN");
  const [kind, setKind] = useState<Kind | null>(null);
  const { data, error, reload } = useFetch<Inbox>(`/api/admin/suggestions?status=${status}${kind ? `&kind=${kind}` : ""}`);
  const totalOpen = Object.values(data?.counts ?? {}).reduce((a, b) => a + (b ?? 0), 0);

  return (
    <div className="space-y-5">
      <div className="page-head">
        <div className="min-w-0">
          <p className="page-kick">Automation</p>
          <h1 className="page-title">Suggestions</h1>
          <p className="page-sub">Worked out from your own records every morning. Nothing changes until someone accepts it.</p>
        </div>
        <Link href="/admin/settings/automation" className="btn btn-quiet btn-sm">
          <Icon name="settings" className="h-4 w-4" /> Settings
        </Link>
      </div>

      <TabBar tabs={STATUS_TABS} value={status} onChange={setStatus} />

      {data && data.kinds.length > 1 && (
        <div className="flex flex-wrap gap-2" role="group" aria-label="Kind">
          <button type="button" className={`chip ${kind === null ? "chip-mor" : ""}`} aria-pressed={kind === null} onClick={() => setKind(null)}>
            All{status === "OPEN" && totalOpen ? ` · ${totalOpen}` : ""}
          </button>
          {data.kinds.map((k) => (
            <button key={k} type="button" className={`chip ${kind === k ? "chip-mor" : ""}`} aria-pressed={kind === k} onClick={() => setKind(k)}>
              {KIND_LABEL[k]}
              {status === "OPEN" && data.counts[k] ? ` · ${data.counts[k]}` : ""}
            </button>
          ))}
        </div>
      )}

      {error && <ErrorBox message={error} onRetry={reload} />}
      {!data && !error && <p className="text-sm text-[var(--muted)]">Loading…</p>}
      {data && !data.items.length && (
        <p className="card p-4 text-sm text-[var(--muted)]">
          {status === "OPEN" ? "Nothing to decide. New suggestions come every morning at 6." : "Nothing here yet."}
        </p>
      )}
      {data && (
        <div className="space-y-3">
          {data.items.map((s) => (
            <SuggestionCard key={s.id} s={s} onDone={reload} />
          ))}
        </div>
      )}
    </div>
  );
}

function SuggestionCard({ s, onDone }: { s: Item; onDone: () => void }) {
  const shops = s.kind === "visit_plan" ? (s.payload.shops as PlanShop[]) : [];
  const [keep, setKeep] = useState<Set<string>>(() => new Set(shops.map((x) => x.retailerId)));
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const open = s.status === "OPEN";

  async function act(accept: boolean) {
    setBusy(true);
    setErr(null);
    try {
      await send(`/api/admin/suggestions/${s.id}`, "POST", { accept, note: note || undefined, retailerIds: s.kind === "visit_plan" && accept ? [...keep] : undefined });
      onDone();
    } catch (e) {
      setErr(errText(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <article className="card p-4 space-y-3">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0 space-y-1">
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="chip chip-mor text-xs">{KIND_LABEL[s.kind]}</span>
            {s.forDate && <span className="text-xs text-[var(--muted)]">for {shortDate(`${s.forDate}T00:00:00+05:30`)}</span>}
            {s.auto && <span className="chip text-xs">Applied automatically</span>}
          </div>
          <h2 className="font-heading font-bold text-[var(--ink)] leading-snug">{s.title}</h2>
          {s.detail && <p className="text-sm text-[var(--muted)]">{s.detail}</p>}
        </div>
        {open && <span className="text-xs text-[var(--muted)] tabular-nums" title="Priority, 0–100">Priority {s.score}</span>}
      </div>

      {s.reasons.length > 0 && (
        <ul className="flex flex-wrap gap-1.5" aria-label="Why">
          {s.reasons.map((r) => (
            <li key={r} className="rounded-full bg-[var(--mint-tint)] px-2.5 py-0.5 text-xs text-[var(--ink)]">
              {r}
            </li>
          ))}
        </ul>
      )}

      {s.kind === "visit_plan" && (
        <ul className="divide-y divide-[var(--line)] rounded-2xl border border-[var(--line)]">
          {shops.map((x) => (
            <li key={x.retailerId}>
              <label className="flex items-center gap-3 px-3 py-2 text-sm">
                {open && (
                  <input
                    type="checkbox"
                    className="h-4 w-4 accent-[var(--mor)]"
                    checked={keep.has(x.retailerId)}
                    onChange={(e) => {
                      const next = new Set(keep);
                      if (e.target.checked) next.add(x.retailerId);
                      else next.delete(x.retailerId);
                      setKeep(next);
                    }}
                  />
                )}
                <span className="min-w-0 flex-1">
                  <Link href={`/admin/reports/shops/${x.retailerId}`} className="font-semibold text-[var(--ink)] hover:text-[var(--kesar-text)]">
                    {x.name}
                  </Link>
                  <span className="text-xs text-[var(--muted)]">
                    {" "}
                    · {x.area}
                    {x.onRoute ? " · on the beat" : ""}
                  </span>
                  <span className="block text-xs text-[var(--muted)]">
                    {x.reasons.map((r) => VISIT_REASON[r]).join(", ")}
                    {x.overdue > 0 && ` · ${rs(x.overdue)} overdue`}
                  </span>
                </span>
              </label>
            </li>
          ))}
        </ul>
      )}

      {s.kind === "trip_plan" && (
        <ul className="grid gap-2 sm:grid-cols-2">
          {(s.payload.trips as PlannedTrip[]).map((t) => (
            <li key={t.driverId} className="rounded-2xl border border-[var(--line)] p-3 text-sm">
              <p className="font-semibold text-[var(--ink)]">
                {t.driverName}
                {t.vehicleName && <span className="font-normal text-[var(--muted)]"> · {t.vehicleName}</span>}
              </p>
              <p className="text-xs text-[var(--muted)]">
                {t.drops} drop{t.drops === 1 ? "" : "s"} · {rs(t.value)}
                {t.km !== null && ` · about ${t.km} km`}
              </p>
              <p className="text-xs text-[var(--muted)]">{t.areas.join(", ")}</p>
            </li>
          ))}
        </ul>
      )}

      {(s.kind === "credit_limit" || s.kind === "credit_stop") && (
        <p className="text-sm">
          Limit: <span className="font-semibold">{rs(s.payload.from as number | null | undefined ?? (s.payload.effective as number | null))}</span> →{" "}
          <span className="font-semibold">{rs(s.payload.to as number)}</span>
          <Link href={`/admin/khata/${s.subjectId}`} className="ml-3 text-xs font-bold text-[var(--kesar-text)]">
            Khata →
          </Link>
        </p>
      )}
      {s.kind === "credit_restore" && (
        <p className="text-sm">
          Limit: <span className="font-semibold">₹0</span> → <span className="font-semibold">{s.payload.restoreTo === null ? "business default" : rs(s.payload.restoreTo as number)}</span>
        </p>
      )}

      {open ? (
        <div className="space-y-2">
          <input className="input" placeholder="Note (optional)" value={note} maxLength={500} onChange={(e) => setNote(e.target.value)} aria-label="Note" />
          <div className="flex flex-wrap items-center gap-2">
            <button type="button" className="btn btn-primary btn-sm" disabled={busy || (s.kind === "visit_plan" && !keep.size)} onClick={() => act(true)}>
              {ACCEPT_LABEL[s.kind]}
              {s.kind === "visit_plan" && keep.size < shops.length ? ` (${keep.size})` : ""}
            </button>
            <button type="button" className="btn btn-outline btn-sm" disabled={busy} onClick={() => act(false)}>
              {REJECT_LABEL[s.kind] ?? "Reject"}
            </button>
            {err && (
              <span className="text-sm text-[#a8281e]" role="alert">
                {err}
              </span>
            )}
          </div>
        </div>
      ) : (
        <p className="text-xs text-[var(--muted)]">
          {s.status === "EXPIRED" ? "Expired" : s.status === "ACCEPTED" ? "Accepted" : "Rejected"}
          {s.decidedBy && ` by ${s.decidedBy}`}
          {s.decidedAt && `, ${shortDate(s.decidedAt, true)}`}
          {s.note && ` · “${s.note}”`}
          {s.kind === "trip_plan" && s.result && Array.isArray(s.result.trips) && (
            <>
              {" · "}
              {(s.result.trips as { id: string; number: string }[]).map((t, i) => (
                <span key={t.id}>
                  {i > 0 && ", "}
                  <Link href={`/admin/dispatch/${t.id}`} className="font-bold text-[var(--kesar-text)]">
                    {t.number}
                  </Link>
                </span>
              ))}
            </>
          )}
        </p>
      )}
    </article>
  );
}
