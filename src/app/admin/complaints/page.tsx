"use client";

import { use, useEffect, useState } from "react";
import Link from "next/link";
import Icon from "@/components/Icon";
import { TICKET_CATEGORIES } from "@/lib/engage-settings";
import { ErrorBox, shortDate, useFetch } from "@/components/admin/AdminKit";
import { Pills, SlaText, StatusChip, ago, categoryLabel, isOpenStatus, useNow } from "@/components/engage/admin/kit";

type Row = {
  id: string;
  number: string;
  category: string;
  subject: string;
  status: string;
  priority: string;
  slaDueAt: string;
  firstResponseAt: string | null;
  createdAt: string;
  updatedAt: string;
  overdue: boolean;
  retailer: { id: string; outletName: string; area: { name: string } | null };
  order: { id: string; orderNumber: string } | null;
  assignedTo: { id: string; name: string } | null;
};
type Data = { items: Row[]; counts: { open: number; overdue: number; mine: number; resolved: number; closed: number; all: number }; staff: { id: string; name: string }[] };

const VIEWS = [
  { key: "open", label: "Open" },
  { key: "overdue", label: "Overdue" },
  { key: "mine", label: "Mine" },
  { key: "resolved", label: "Resolved" },
  { key: "closed", label: "Closed" },
  { key: "all", label: "All" },
] as const;
type View = (typeof VIEWS)[number]["key"];
const isView = (v: unknown): v is View => typeof v === "string" && VIEWS.some((x) => x.key === v);

const CATEGORIES = Object.entries(TICKET_CATEGORIES).map(([key, c]) => ({ key, label: c.label }));

export default function ComplaintsPage({ searchParams }: { searchParams: Promise<{ view?: string | string[] }> }) {
  const { view: initial } = use(searchParams);
  const [view, setView] = useState<View>(isView(initial) ? initial : "open");
  const [category, setCategory] = useState("");
  const [q, setQ] = useState("");
  const [query, setQuery] = useState("");
  const now = useNow();

  useEffect(() => {
    const t = setTimeout(() => setQuery(q.trim()), 300);
    return () => clearTimeout(t);
  }, [q]);

  const params = new URLSearchParams({ view });
  if (category) params.set("category", category);
  if (query) params.set("q", query);
  const { data, error, reload } = useFetch<Data>(`/api/admin/tickets?${params}`);

  function pick(v: View) {
    setView(v);
    try {
      window.history.replaceState(null, "", v === "open" ? "/admin/complaints" : `/admin/complaints?view=${v}`);
    } catch {
      /* address bar only */
    }
  }

  const c = data?.counts;
  const views = VIEWS.map((v) => ({
    ...v,
    count: c ? c[v.key as keyof typeof c] ?? null : null,
    alert: v.key === "overdue",
  }));

  return (
    <div className="space-y-5 pb-16">
      <div className="page-head">
        <div className="min-w-0">
          <p className="page-kick">Customer care</p>
          <h1 className="page-title">Complaints</h1>
          <p className="page-sub">Problems shops have raised. The ones closest to their deadline are at the top.</p>
        </div>
      </div>

      {c && c.overdue > 0 && view !== "overdue" && (
        <button type="button" onClick={() => pick("overdue")} className="card w-full p-4 flex items-center gap-3 text-left hover:bg-white/80">
          <span className="icon-tile bg-[var(--risk-tint)] text-[var(--risk-text)]">
            <Icon name="alert" />
          </span>
          <span className="min-w-0 flex-1 text-sm">
            <b className="text-[var(--risk-text)]">
              {c.overdue} complaint{c.overdue === 1 ? " is" : "s are"} past the deadline.
            </b>{" "}
            <span className="text-[var(--ink-2)]">Show them</span>
          </span>
          <Icon name="arrow" className="h-4 w-4 text-[var(--muted)] shrink-0" />
        </button>
      )}

      <div className="space-y-3">
        <Pills items={views} value={view} onChange={pick} label="Show" />
        <div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_220px] sm:max-w-2xl">
          <div className="relative">
            <Icon name="search" className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--muted)]" />
            <input
              className="input !pl-9"
              type="search"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Search number, subject or shop"
              aria-label="Search complaints"
            />
          </div>
          <select className="input" value={category} onChange={(e) => setCategory(e.target.value)} aria-label="Complaint type">
            <option value="">All types</option>
            {CATEGORIES.map((x) => (
              <option key={x.key} value={x.key}>
                {x.label}
              </option>
            ))}
          </select>
        </div>
      </div>

      {error && <ErrorBox message={error} onRetry={reload} />}
      {!data && !error && <p className="text-sm text-[var(--muted)]">Loading…</p>}

      {data &&
        (data.items.length === 0 ? (
          <div className="card p-6 text-center space-y-1">
            <p className="text-sm font-semibold">{query || category ? "Nothing matches" : view === "open" || view === "mine" || view === "overdue" ? "All clear" : "Nothing here"}</p>
            <p className="text-sm text-[var(--muted)]">
              {query || category
                ? "Try another search or type."
                : view === "overdue"
                  ? "No complaint is past its deadline."
                  : view === "mine"
                    ? "No open complaint is assigned to you."
                    : view === "open"
                      ? "No open complaints right now."
                      : "No complaints in this list yet."}
            </p>
          </div>
        ) : (
          <ul className="card divide-y divide-[var(--line)] overflow-hidden">
            <li className="hidden lg:grid lg:grid-cols-[minmax(0,1fr)_180px_150px] gap-4 px-4 py-2 text-[11px] font-bold uppercase tracking-[0.08em] text-[var(--muted)]">
              <span>Complaint</span>
              <span>Handled by</span>
              <span className="text-right">Deadline</span>
            </li>
            {data.items.map((t) => (
              <li key={t.id}>
                <TicketRow t={t} now={now} />
              </li>
            ))}
          </ul>
        ))}
      {data && data.items.length >= 200 && <p className="text-xs text-[var(--muted)]">Showing the first 200. Search or pick a type to narrow it down.</p>}
    </div>
  );
}

function TicketRow({ t, now }: { t: Row; now: number }) {
  const open = isOpenStatus(t.status);
  return (
    <Link
      href={`/admin/complaints/${t.id}`}
      className={`block px-4 py-3.5 hover:bg-white/70 lg:grid lg:grid-cols-[minmax(0,1fr)_180px_150px] lg:items-center lg:gap-4 ${t.overdue ? "border-l-4 border-l-[#d23b2e]" : ""}`}
    >
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="font-mono text-xs text-[var(--muted)]">{t.number}</span>
          <StatusChip status={t.status} />
          {t.priority === "high" && <span className="chip chip-kesar !py-0.5 !px-2 !text-[11.5px]">High priority</span>}
          <span className="text-xs text-[var(--muted)]">{categoryLabel(t.category)}</span>
        </div>
        <p className="font-bold mt-1 break-words">{t.subject}</p>
        <p className="text-sm text-[var(--ink-2)] break-words">
          {t.retailer.outletName}
          {t.retailer.area && <span className="text-[var(--muted)]"> · {t.retailer.area.name}</span>}
          {t.order && <span className="text-[var(--muted)]"> · Order {t.order.orderNumber}</span>}
        </p>
        <p className="text-xs text-[var(--muted)] mt-0.5">
          Raised {ago(t.createdAt, now)}
          {open && !t.firstResponseAt && <span className="font-semibold text-[var(--accent-text)]"> · No reply yet</span>}
        </p>
      </div>
      <div className="mt-2 flex flex-wrap items-center justify-between gap-x-3 gap-y-1 text-sm lg:contents">
        <span className={`min-w-0 truncate ${t.assignedTo ? "text-[var(--ink-2)]" : "text-[var(--muted)] italic"}`}>
          <Icon name="user" className="inline h-3.5 w-3.5 mr-1 -mt-0.5 lg:hidden" />
          {t.assignedTo?.name ?? "Not assigned"}
        </span>
        <span className="lg:text-right">
          {open ? (
            <SlaText status={t.status} slaDueAt={t.slaDueAt} now={now} />
          ) : (
            <span className="text-xs text-[var(--muted)] whitespace-nowrap">Updated {shortDate(t.updatedAt)}</span>
          )}
        </span>
      </div>
    </Link>
  );
}
