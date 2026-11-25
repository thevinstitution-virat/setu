"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import Icon, { type IconName } from "@/components/Icon";
import { formatINR } from "@/lib/money";

type Ageing = { d0_7: number; d8_15: number; d16_30: number; d30p: number };

type Row = {
  retailerId: string;
  outletName: string;
  ownerName: string;
  phone: string | null;
  areaName: string;
  salesAgentId: string | null;
  paymentMode: "PREPAID" | "POSTPAID";
  creditLimit: number | null;
  receivable: number;
  wallet: number;
  overdue: number;
  oldestDueDays: number | null;
  ageing: Ageing;
  lastPaymentAt: string | null;
};

type Totals = {
  receivable: number;
  advance: number;
  wallet: number;
  overdue: number;
  overdueCount: number;
  d0_7: number;
  d8_15: number;
  d16_30: number;
  d30p: number;
};

const FILTERS = [
  { key: "all", label: "All" },
  { key: "due", label: "Has dues" },
  { key: "overdue", label: "Overdue" },
  { key: "advance", label: "Advance" },
] as const;
type Filter = (typeof FILTERS)[number]["key"];

const SORTS = [
  { key: "name", label: "Name" },
  { key: "balance", label: "Balance" },
  { key: "overdue", label: "Overdue" },
  { key: "oldest", label: "Oldest due" },
  { key: "lastpay", label: "Last payment" },
] as const;
type Sort = (typeof SORTS)[number]["key"];

const DEFAULT_SORT: Record<Filter, Sort> = { all: "name", due: "balance", overdue: "overdue", advance: "balance" };

const BUCKETS = [
  { key: "d0_7", label: "0–7 days", color: "var(--mint)" },
  { key: "d8_15", label: "8–15 days", color: "var(--genda)" },
  { key: "d16_30", label: "16–30 days", color: "var(--kesar)" },
  { key: "d30p", label: "30+ days", color: "#a8281e" },
] as const;

const PAGE = 200;

function fmtDate(s: string | null) {
  if (!s) return "—";
  return new Date(s).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric", timeZone: "Asia/Kolkata" });
}

function csvCell(v: string | number | null) {
  const s = v === null ? "" : String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export default function KhataListPage() {
  const router = useRouter();
  const [rows, setRows] = useState<Row[] | null>(null);
  const [totals, setTotals] = useState<Totals | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<Filter>("all");
  const [sort, setSort] = useState<Sort>("name");
  const [query, setQuery] = useState("");
  const [q, setQ] = useState("");
  const [limit, setLimit] = useState(PAGE);

  useEffect(() => {
    let live = true;
    fetch("/api/admin/khata?filter=all")
      .then(async (r) => {
        const data = await r.json();
        if (!r.ok) throw new Error(data.error ?? "Could not load the khata");
        if (!live) return;
        setRows(data.rows ?? []);
        setTotals(data.totals ?? null);
      })
      .catch((e) => live && setError(e instanceof Error ? e.message : "Could not load the khata"));
    return () => {
      live = false;
    };
  }, []);

  // Debounced search.
  useEffect(() => {
    const t = setTimeout(() => setQ(query.trim().toLowerCase()), 250);
    return () => clearTimeout(t);
  }, [query]);

  function pickFilter(f: Filter) {
    setFilter(f);
    setSort(DEFAULT_SORT[f]);
    setLimit(PAGE);
  }

  const shown = useMemo(() => {
    if (!rows) return [];
    let out = rows;
    if (filter === "due") out = out.filter((r) => r.receivable > 0);
    else if (filter === "overdue") out = out.filter((r) => r.overdue > 0);
    else if (filter === "advance") out = out.filter((r) => r.receivable < 0 || r.wallet > 0);
    if (q) {
      out = out.filter(
        (r) =>
          r.outletName.toLowerCase().includes(q) ||
          r.ownerName.toLowerCase().includes(q) ||
          r.areaName.toLowerCase().includes(q) ||
          (r.phone ?? "").includes(q)
      );
    }
    const sorted = [...out];
    if (sort === "name") sorted.sort((a, b) => a.outletName.localeCompare(b.outletName));
    else if (sort === "balance")
      sorted.sort((a, b) => (filter === "advance" ? a.receivable - a.wallet - (b.receivable - b.wallet) : b.receivable - a.receivable));
    else if (sort === "overdue") sorted.sort((a, b) => b.overdue - a.overdue || (b.oldestDueDays ?? -1) - (a.oldestDueDays ?? -1));
    else if (sort === "oldest") sorted.sort((a, b) => (b.oldestDueDays ?? -1) - (a.oldestDueDays ?? -1));
    else if (sort === "lastpay")
      sorted.sort((a, b) => (a.lastPaymentAt ? Date.parse(a.lastPaymentAt) : 0) - (b.lastPaymentAt ? Date.parse(b.lastPaymentAt) : 0));
    return sorted;
  }, [rows, filter, q, sort]);

  const counts = useMemo(() => {
    const r = rows ?? [];
    return {
      all: r.length,
      due: r.filter((x) => x.receivable > 0).length,
      overdue: r.filter((x) => x.overdue > 0).length,
      advance: r.filter((x) => x.receivable < 0 || x.wallet > 0).length,
    } satisfies Record<Filter, number>;
  }, [rows]);

  function downloadCsv() {
    const head = [
      "Outlet",
      "Owner",
      "Phone",
      "Area",
      "Mode",
      "Credit limit (₹)",
      "Balance (₹, + owes us / − advance)",
      "Wallet (₹)",
      "Overdue (₹)",
      "Oldest overdue (days)",
      "0-7 days (₹)",
      "8-15 days (₹)",
      "16-30 days (₹)",
      "30+ days (₹)",
      "Last payment",
    ];
    const rupees = (p: number) => (p / 100).toFixed(2);
    const lines = shown.map((r) =>
      [
        r.outletName,
        r.ownerName,
        r.phone,
        r.areaName,
        r.paymentMode === "PREPAID" ? "Prepaid" : "Postpaid",
        r.creditLimit === null ? "" : rupees(r.creditLimit),
        rupees(r.receivable),
        rupees(r.wallet),
        rupees(r.overdue),
        r.oldestDueDays,
        rupees(r.ageing.d0_7),
        rupees(r.ageing.d8_15),
        rupees(r.ageing.d16_30),
        rupees(r.ageing.d30p),
        r.lastPaymentAt ? new Date(r.lastPaymentAt).toISOString().slice(0, 10) : "",
      ]
        .map(csvCell)
        .join(",")
    );
    const blob = new Blob(["﻿" + [head.map(csvCell).join(","), ...lines].join("\r\n")], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `khata-${filter}-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  const ageTotal = totals ? totals.d0_7 + totals.d8_15 + totals.d16_30 + totals.d30p : 0;

  return (
    <div className="space-y-5">
      <div className="page-head">
        <div>
          <p className="page-kick">Money</p>
          <h1 className="page-title">Khata</h1>
          <p className="page-sub">Who owes what, how old it is, and who has paid ahead.</p>
        </div>
        <button className="btn btn-outline btn-sm" onClick={downloadCsv} disabled={!shown.length}>
          <Icon name="download" className="h-4 w-4" /> Download CSV
        </button>
      </div>

      {error && <p className="card p-4 text-sm text-[#a8281e]">{error}</p>}

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Tile icon="book" tint="kesar" label="Total receivable" value={totals ? formatINR(totals.receivable, { whole: true }) : "…"} />
        <Tile
          icon="alert"
          tint="red"
          label={totals ? `Overdue · ${totals.overdueCount} retailer${totals.overdueCount === 1 ? "" : "s"}` : "Overdue"}
          value={totals ? formatINR(totals.overdue, { whole: true }) : "…"}
        />
        <Tile icon="receipt" tint="mint" label="Advances held" value={totals ? formatINR(totals.advance, { whole: true }) : "…"} />
        <Tile icon="wallet" tint="mor" label="Wallet balances" value={totals ? formatINR(totals.wallet, { whole: true }) : "…"} />
      </div>

      {totals && (
        <div className="card p-4 space-y-3">
          <div className="flex items-center justify-between gap-2">
            <p className="font-heading font-bold">Unpaid bills by age</p>
            <p className="text-xs text-[var(--muted)]">{formatINR(ageTotal, { whole: true })} unpaid</p>
          </div>
          <div className="flex h-3 w-full overflow-hidden rounded-full bg-black/5" aria-hidden>
            {ageTotal > 0 &&
              BUCKETS.map((b) => (
                <div key={b.key} style={{ width: `${(totals[b.key] / ageTotal) * 100}%`, background: b.color }} />
              ))}
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
            {BUCKETS.map((b) => (
              <div key={b.key} className="flex items-start gap-2">
                <span className="mt-1 h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: b.color }} />
                <div>
                  <p className="text-sm font-bold">{formatINR(totals[b.key], { whole: true })}</p>
                  <p className="text-xs text-[var(--muted)]">
                    {b.label}
                    {ageTotal > 0 && ` · ${Math.round((totals[b.key] / ageTotal) * 100)}%`}
                  </p>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="space-y-3">
        <div className="flex gap-2 overflow-x-auto pb-1">
          {FILTERS.map((f) => (
            <button
              key={f.key}
              onClick={() => pickFilter(f.key)}
              className={`shrink-0 rounded-full px-3 py-1.5 text-xs font-medium ${
                filter === f.key ? "bg-gradient-to-br from-mor to-[#0c3634] text-white" : "bg-black/5 text-foreground/60"
              }`}
            >
              {f.label}
              {rows && <span className="ml-1 opacity-70">{counts[f.key]}</span>}
            </button>
          ))}
        </div>
        <div className="flex gap-2">
          <input
            className="input flex-1"
            type="search"
            placeholder="Search outlet, owner, phone or area"
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setLimit(PAGE);
            }}
          />
          <select
            className="input !w-auto"
            value={sort}
            onChange={(e) => setSort(e.target.value as Sort)}
            aria-label="Sort by"
          >
            {SORTS.map((s) => (
              <option key={s.key} value={s.key}>
                {s.label}
              </option>
            ))}
          </select>
        </div>
      </div>

      {rows === null && !error && <p className="text-sm text-[var(--muted)]">Loading…</p>}

      {rows && (
        <div className="card overflow-hidden">
          {/* Desktop table */}
          <table className="hidden md:table w-full text-sm">
            <thead>
              <tr className="text-left text-xs text-[var(--muted)] border-b border-[var(--line)]">
                <th className="px-4 py-3 font-semibold">Outlet</th>
                <th className="px-2 py-3 font-semibold">Area</th>
                <th className="px-2 py-3 font-semibold">Mode</th>
                <th className="px-2 py-3 font-semibold text-right">Balance</th>
                <th className="px-2 py-3 font-semibold text-right">Overdue</th>
                <th className="px-4 py-3 font-semibold text-right">Last payment</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[var(--line)]">
              {shown.slice(0, limit).map((r) => (
                <tr
                  key={r.retailerId}
                  className="cursor-pointer hover:bg-black/[0.03]"
                  onClick={() => router.push(`/admin/khata/${r.retailerId}`)}
                >
                  <td className="px-4 py-3">
                    <Link href={`/admin/khata/${r.retailerId}`} className="font-bold" onClick={(e) => e.stopPropagation()}>
                      {r.outletName}
                    </Link>
                    <p className="text-xs text-[var(--muted)]">
                      {r.ownerName}
                      {r.phone && ` · ${r.phone}`}
                    </p>
                  </td>
                  <td className="px-2 py-3 text-[var(--ink-2)]">{r.areaName}</td>
                  <td className="px-2 py-3">
                    <ModeChip mode={r.paymentMode} />
                  </td>
                  <td className="px-2 py-3 text-right">
                    <Balance r={r} />
                  </td>
                  <td className="px-2 py-3 text-right">
                    <Overdue r={r} />
                  </td>
                  <td className="px-4 py-3 text-right text-[var(--ink-2)]">{fmtDate(r.lastPaymentAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>

          {/* Mobile cards */}
          <div className="md:hidden divide-y divide-[var(--line)]">
            {shown.slice(0, limit).map((r) => (
              <Link key={r.retailerId} href={`/admin/khata/${r.retailerId}`} className="block px-4 py-3 space-y-1.5">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-sm font-bold truncate">{r.outletName}</p>
                    <p className="text-xs text-[var(--muted)] truncate">
                      {r.ownerName} · {r.areaName}
                    </p>
                  </div>
                  <div className="text-right shrink-0">
                    <Balance r={r} />
                  </div>
                </div>
                <div className="flex items-center justify-between gap-2 text-xs">
                  <div className="flex items-center gap-2">
                    <ModeChip mode={r.paymentMode} />
                    <Overdue r={r} compact />
                  </div>
                  <span className="text-[var(--muted)]">Paid {fmtDate(r.lastPaymentAt)}</span>
                </div>
              </Link>
            ))}
          </div>

          {shown.length === 0 && (
            <p className="px-4 py-6 text-sm text-[var(--muted)]">{q ? "No retailer matches this search." : "No retailers in this filter."}</p>
          )}
          {shown.length > 0 && (
            <div className="flex items-center justify-between gap-2 px-4 py-3 border-t border-[var(--line)] text-xs text-[var(--muted)]">
              <span>
                Showing {Math.min(limit, shown.length)} of {shown.length}
              </span>
              {shown.length > limit && (
                <button className="btn btn-quiet btn-xs" onClick={() => setLimit((l) => l + PAGE)}>
                  Show more
                </button>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function ModeChip({ mode }: { mode: "PREPAID" | "POSTPAID" }) {
  return (
    <span className={`chip !py-0.5 !px-2 !text-[11.5px] ${mode === "PREPAID" ? "chip-genda" : "chip-mor"}`}>
      {mode === "PREPAID" ? "Prepaid" : "Postpaid"}
    </span>
  );
}

function Balance({ r }: { r: Row }) {
  if (r.receivable < 0) {
    return (
      <span className="font-bold text-[var(--mint-text)]">
        {formatINR(-r.receivable)} <span className="text-xs font-semibold">advance</span>
      </span>
    );
  }
  return (
    <span className={`font-bold ${r.overdue > 0 ? "text-[#a8281e]" : ""}`}>
      {formatINR(r.receivable)}
      {r.wallet > 0 && <span className="block text-xs font-semibold text-[var(--mint-text)]">Wallet {formatINR(r.wallet)}</span>}
    </span>
  );
}

function Overdue({ r, compact }: { r: Row; compact?: boolean }) {
  if (r.overdue <= 0) return compact ? null : <span className="text-[var(--muted)]">—</span>;
  const days = r.oldestDueDays ?? 0;
  return (
    <span className="text-[#a8281e] font-semibold">
      {formatINR(r.overdue, { whole: true })}
      <span className={`${compact ? "ml-1" : "block"} text-xs font-medium`}>
        {days} day{days === 1 ? "" : "s"}
      </span>
    </span>
  );
}

const TINTS = {
  kesar: "bg-[var(--kesar-tint)] text-[var(--kesar-text)]",
  mor: "bg-[#e1eeec] text-mor",
  mint: "bg-[var(--mint-tint)] text-[var(--mint-text)]",
  red: "bg-[#fde4e1] text-[#a8281e]",
};

function Tile({ label, value, icon, tint }: { label: string; value: string; icon: IconName; tint: keyof typeof TINTS }) {
  return (
    <div className="card p-4 flex items-center gap-3 min-w-0">
      <span className={`icon-tile ${TINTS[tint]}`}>
        <Icon name={icon} />
      </span>
      <div className="min-w-0">
        <p className="stat-num !text-xl sm:!text-2xl truncate">{value}</p>
        <p className="stat-lbl !mt-1">{label}</p>
      </div>
    </div>
  );
}
