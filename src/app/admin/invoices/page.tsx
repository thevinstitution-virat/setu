"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import Icon from "@/components/Icon";
import { formatINR } from "@/lib/money";
import { ErrorBox, TabBar, useFetch } from "@/components/admin/AdminKit";
import { DOC_CHIP, EINV_LABEL, fmtDate, type InvoiceJson } from "@/components/invoice/InvoiceView";

type DocType = InvoiceJson["type"];
type EinvStatus = InvoiceJson["einvStatus"];

type Row = {
  id: string;
  type: DocType;
  number: string;
  date: string;
  total: number;
  taxable: number;
  cgst: number;
  sgst: number;
  igst: number;
  b2b: boolean;
  einvStatus: EinvStatus;
  einvError: string | null;
  ewbNo: string | null;
  noteKind: string | null;
  reason: string | null;
  retailer: { id: string; outletName: string };
  order: { id: string; orderNumber: string } | null;
  original: { id: string; number: string } | null;
  due: number | null;
};
type Totals = { type: DocType; count: number; taxable: number | null; cgst: number | null; sgst: number | null; igst: number | null; total: number | null };
type ListResponse = { invoices: Row[]; count: number; page: number; pages: number; totals: Totals[] };

const TYPE_OPTIONS: { value: "" | DocType; label: string }[] = [
  { value: "", label: "All documents" },
  { value: "TAX_INVOICE", label: "Tax invoices" },
  { value: "BILL_OF_SUPPLY", label: "Bills of supply" },
  { value: "CREDIT_NOTE", label: "Credit notes" },
  { value: "DEBIT_NOTE", label: "Debit notes" },
];
const EINV_OPTIONS: { value: "" | EinvStatus; label: string }[] = [
  { value: "", label: "Any e-invoice status" },
  { value: "PENDING", label: "e-Invoice pending" },
  { value: "FAILED", label: "e-Invoice failed" },
  { value: "GENERATED", label: "e-Invoice done" },
  { value: "CANCELLED", label: "e-Invoice cancelled" },
  { value: "NOT_REQUIRED", label: "No e-invoice needed" },
];
const SHORT_TYPE: Record<DocType, string> = {
  TAX_INVOICE: "Invoice",
  BILL_OF_SUPPLY: "Bill of supply",
  CREDIT_NOTE: "Credit note",
  DEBIT_NOTE: "Debit note",
};
const EINV_CHIP: Record<EinvStatus, string> = {
  NOT_REQUIRED: "chip",
  PENDING: "chip chip-genda",
  GENERATED: "chip chip-mint",
  FAILED: "chip chip-kesar",
  CANCELLED: "chip",
};

// ───────────────────────────── dates (IST) ─────────────────────────────

const todayIST = () => new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata" }).format(new Date());

function monthRange(month: string) {
  const [y, m] = month.split("-").map(Number);
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return { from: `${month}-01`, to: `${month}-${String(last).padStart(2, "0")}` };
}

function monthLabel(month: string) {
  const [y, m] = month.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, 1)).toLocaleDateString("en-IN", { month: "long", year: "numeric", timeZone: "UTC" });
}

/** True when from–to is exactly one calendar month. */
function isWholeMonth(from: string, to: string) {
  if (from.slice(0, 7) !== to.slice(0, 7)) return false;
  const r = monthRange(from.slice(0, 7));
  return r.from === from && r.to === to;
}

const ymdLabel = (s: string) => fmtDate(`${s}T00:00:00+05:30`);

// ───────────────────────────── page ─────────────────────────────

export default function InvoicesPage() {
  const [tab, setTab] = useState<"list" | "reports">("list");
  const [month, setMonth] = useState(() => todayIST().slice(0, 7));
  const [custom, setCustom] = useState(false);
  const [range, setRange] = useState(() => monthRange(todayIST().slice(0, 7)));
  const [type, setType] = useState<"" | DocType>("");
  const [einv, setEinv] = useState<"" | EinvStatus>("");
  const [qDraft, setQDraft] = useState("");
  const [q, setQ] = useState("");
  const [page, setPage] = useState(1);

  // Search a moment after typing stops.
  useEffect(() => {
    const t = setTimeout(() => {
      setQ(qDraft.trim());
      setPage(1);
    }, 350);
    return () => clearTimeout(t);
  }, [qDraft]);

  const period = custom ? range : monthRange(month);
  const badRange = !period.from || !period.to || period.from > period.to;
  const params = new URLSearchParams({ from: period.from, to: period.to, page: String(page) });
  if (type) params.set("type", type);
  if (einv) params.set("einv", einv);
  if (q) params.set("q", q);
  const { data, error, reload } = useFetch<ListResponse>(tab === "list" && !badRange ? `/api/invoices?${params}` : null);

  const periodText = custom ? `${ymdLabel(period.from)} – ${ymdLabel(period.to)}` : monthLabel(month);

  return (
    <div className="space-y-4">
      <div>
        <p className="page-kick">GST</p>
        <h1 className="page-title">Invoices</h1>
        <p className="page-sub">Every invoice, bill of supply, credit note and debit note, with downloads for your accountant.</p>
      </div>

      <TabBar
        tabs={[
          { key: "list", label: "Invoices" },
          { key: "reports", label: "Reports" },
        ]}
        value={tab}
        onChange={setTab}
      />

      <PeriodPicker
        month={month}
        custom={custom}
        range={range}
        onMonth={(m) => {
          setMonth(m);
          setPage(1);
        }}
        onCustom={(c) => {
          setCustom(c);
          if (c) setRange(monthRange(month));
          setPage(1);
        }}
        onRange={(r) => {
          setRange(r);
          setPage(1);
        }}
      />
      {badRange && <p className="text-sm text-[#a8281e]">The start date must be on or before the end date.</p>}

      {tab === "reports" ? (
        !badRange && <Reports from={period.from} to={period.to} periodText={periodText} />
      ) : (
        <>
          <div className="grid gap-2 sm:grid-cols-[1fr_1fr_1.4fr]">
            <select
              className="input"
              aria-label="Document type"
              value={type}
              onChange={(e) => {
                setType(e.target.value as "" | DocType);
                setPage(1);
              }}
            >
              {TYPE_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
            <select
              className="input"
              aria-label="e-Invoice status"
              value={einv}
              onChange={(e) => {
                setEinv(e.target.value as "" | EinvStatus);
                setPage(1);
              }}
            >
              {EINV_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
            <input
              className="input"
              type="search"
              placeholder="Search number, order or shop"
              aria-label="Search invoices"
              value={qDraft}
              onChange={(e) => setQDraft(e.target.value)}
            />
          </div>

          {error && <ErrorBox message={error} onRetry={reload} />}
          {data && <TotalsStrip totals={data.totals} />}
          {data ? <InvoiceList data={data} page={page} setPage={setPage} /> : !error && !badRange && <p className="text-sm text-[var(--muted)]">Loading…</p>}
        </>
      )}
    </div>
  );
}

// ───────────────────────────── period ─────────────────────────────

function PeriodPicker({
  month,
  custom,
  range,
  onMonth,
  onCustom,
  onRange,
}: {
  month: string;
  custom: boolean;
  range: { from: string; to: string };
  onMonth: (m: string) => void;
  onCustom: (c: boolean) => void;
  onRange: (r: { from: string; to: string }) => void;
}) {
  const step = (d: number) => {
    const [y, m] = month.split("-").map(Number);
    const t = new Date(Date.UTC(y, m - 1 + d, 1));
    onMonth(`${t.getUTCFullYear()}-${String(t.getUTCMonth() + 1).padStart(2, "0")}`);
  };
  return (
    <div className="card p-3 space-y-2 sm:max-w-md">
      <div className="flex flex-wrap items-center gap-2">
        {custom ? (
          <div className="grid grid-cols-2 gap-2 flex-1 min-w-0">
            <label className="block min-w-0">
              <span className="block text-xs font-medium text-[var(--ink-2)] mb-1">From</span>
              <input className="input" type="date" value={range.from} max={range.to || undefined} onChange={(e) => onRange({ ...range, from: e.target.value })} />
            </label>
            <label className="block min-w-0">
              <span className="block text-xs font-medium text-[var(--ink-2)] mb-1">To</span>
              <input className="input" type="date" value={range.to} min={range.from || undefined} onChange={(e) => onRange({ ...range, to: e.target.value })} />
            </label>
          </div>
        ) : (
          <div className="flex items-center gap-1.5 flex-1 min-w-0">
            <button type="button" className="btn btn-quiet btn-sm !px-2.5 shrink-0" aria-label="Previous month" onClick={() => step(-1)}>
              <Icon name="arrow" className="h-4 w-4 rotate-180" />
            </button>
            <input
              className="input min-w-0 flex-1"
              type="month"
              aria-label="Month"
              value={month}
              onChange={(e) => e.target.value && onMonth(e.target.value)}
            />
            <button type="button" className="btn btn-quiet btn-sm !px-2.5 shrink-0" aria-label="Next month" onClick={() => step(1)}>
              <Icon name="arrow" className="h-4 w-4" />
            </button>
          </div>
        )}
      </div>
      <button type="button" className="btn btn-quiet btn-xs" onClick={() => onCustom(!custom)}>
        {custom ? "Pick a month instead" : "Choose your own dates"}
      </button>
    </div>
  );
}

// ───────────────────────────── totals ─────────────────────────────

function TotalsStrip({ totals }: { totals: Totals[] }) {
  const sum = (types: DocType[], k: "taxable" | "total" | "gst") =>
    totals
      .filter((t) => types.includes(t.type))
      .reduce((a, t) => a + (k === "gst" ? (t.cgst ?? 0) + (t.sgst ?? 0) + (t.igst ?? 0) : (t[k] ?? 0)), 0);
  const sales: DocType[] = ["TAX_INVOICE", "BILL_OF_SUPPLY"];
  const creditCount = totals.find((t) => t.type === "CREDIT_NOTE")?.count ?? 0;
  const debitCount = totals.find((t) => t.type === "DEBIT_NOTE")?.count ?? 0;
  const tiles = [
    { label: "Sales before GST", value: formatINR(sum(sales, "taxable")) },
    { label: "GST on sales", value: formatINR(sum(sales, "gst")) },
    { label: "Sales total", value: formatINR(sum(sales, "total")) },
    { label: `Credit notes${creditCount ? ` (${creditCount})` : ""}`, value: formatINR(sum(["CREDIT_NOTE"], "total")) },
  ];
  return (
    <div className="space-y-1.5">
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-2">
        {tiles.map((t) => (
          <div key={t.label} className="card p-3 min-w-0">
            <p className="font-heading text-lg font-bold leading-tight break-words">{t.value}</p>
            <p className="text-xs text-[var(--muted)] mt-1">{t.label}</p>
          </div>
        ))}
      </div>
      {debitCount > 0 && (
        <p className="text-xs text-[var(--muted)]">
          Debit notes ({debitCount}): {formatINR(sum(["DEBIT_NOTE"], "total"))}
        </p>
      )}
    </div>
  );
}

// ───────────────────────────── list ─────────────────────────────

function InvoiceList({ data, page, setPage }: { data: ListResponse; page: number; setPage: (p: number) => void }) {
  if (data.invoices.length === 0) {
    return <div className="card p-6 text-center text-sm text-[var(--muted)]">No documents in this period with these filters.</div>;
  }
  return (
    <div className="space-y-3">
      <p className="text-xs text-[var(--muted)]">
        {data.count} document{data.count === 1 ? "" : "s"}
      </p>
      <div className="card overflow-hidden">
        <div className="hidden md:grid grid-cols-[minmax(0,1.3fr)_6.5rem_minmax(0,1.5fr)_7rem_6.5rem_7rem] gap-3 px-4 py-2 text-xs font-semibold text-[var(--muted)] border-b border-[var(--line)]">
          <span>Number</span>
          <span>Date</span>
          <span>Retailer</span>
          <span className="text-right">Before GST</span>
          <span className="text-right">GST</span>
          <span className="text-right">Total</span>
        </div>
        <ul className="divide-y divide-[var(--line)]">
          {data.invoices.map((r) => (
            <li key={r.id}>
              <InvoiceRow r={r} />
            </li>
          ))}
        </ul>
      </div>
      {data.pages > 1 && (
        <div className="flex items-center justify-between gap-2">
          <button type="button" className="btn btn-quiet btn-sm" disabled={page <= 1} onClick={() => setPage(page - 1)}>
            <Icon name="arrow" className="h-4 w-4 rotate-180" /> Newer
          </button>
          <span className="text-sm text-[var(--muted)]">
            Page {data.page} of {data.pages}
          </span>
          <button type="button" className="btn btn-quiet btn-sm" disabled={page >= data.pages} onClick={() => setPage(page + 1)}>
            Older <Icon name="arrow" className="h-4 w-4" />
          </button>
        </div>
      )}
    </div>
  );
}

function InvoiceRow({ r }: { r: Row }) {
  const gst = r.cgst + r.sgst + r.igst;
  const note = r.type === "CREDIT_NOTE" || r.type === "DEBIT_NOTE";
  const chips = (
    <>
      {r.einvStatus !== "NOT_REQUIRED" && <span className={`${EINV_CHIP[r.einvStatus]} !py-0.5 !px-2 !text-[11px]`}>{EINV_LABEL[r.einvStatus]}</span>}
      {r.ewbNo && <span className="chip !py-0.5 !px-2 !text-[11px]">E-way bill</span>}
      {r.due !== null && r.due > 0 && !note && <span className="text-[11px] font-semibold text-[var(--kesar-text)]">Due {formatINR(r.due)}</span>}
    </>
  );
  const sub = [r.order ? `Order ${r.order.orderNumber}` : null, r.original ? `On ${r.original.number}` : null].filter(Boolean).join(" · ");
  return (
    <Link href={`/admin/invoices/${r.id}`} className="block px-4 py-3 hover:bg-black/[0.03] transition">
      {/* Phone */}
      <div className="md:hidden flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="flex flex-wrap items-center gap-1.5">
            <span className="font-semibold text-sm break-all">{r.number}</span>
            <span className={`${DOC_CHIP[r.type]} !py-0.5 !px-2 !text-[11px]`}>{SHORT_TYPE[r.type]}</span>
          </p>
          <p className="text-sm truncate mt-0.5">{r.retailer.outletName}</p>
          <p className="text-xs text-[var(--muted)] truncate">
            {fmtDate(r.date)}
            {sub ? ` · ${sub}` : ""}
          </p>
          <div className="flex flex-wrap items-center gap-1.5 mt-1">{chips}</div>
        </div>
        <div className="text-right shrink-0">
          <p className="font-semibold text-sm">{r.type === "CREDIT_NOTE" ? "−" : ""}{formatINR(r.total)}</p>
          {gst > 0 && <p className="text-[11px] text-[var(--muted)]">GST {formatINR(gst)}</p>}
        </div>
      </div>
      {/* Desktop */}
      <div className="hidden md:grid grid-cols-[minmax(0,1.3fr)_6.5rem_minmax(0,1.5fr)_7rem_6.5rem_7rem] gap-3 items-center text-sm">
        <div className="min-w-0">
          <p className="font-semibold truncate">{r.number}</p>
          <span className={`${DOC_CHIP[r.type]} !py-0.5 !px-2 !text-[11px]`}>{SHORT_TYPE[r.type]}</span>
        </div>
        <span className="text-[var(--ink-2)]">{fmtDate(r.date)}</span>
        <div className="min-w-0">
          <p className="truncate">{r.retailer.outletName}</p>
          {sub && <p className="text-xs text-[var(--muted)] truncate">{sub}</p>}
          <div className="flex flex-wrap items-center gap-1.5 mt-0.5">{chips}</div>
        </div>
        <span className="text-right">{formatINR(r.taxable)}</span>
        <span className="text-right text-[var(--ink-2)]">{gst > 0 ? formatINR(gst) : "—"}</span>
        <span className="text-right font-semibold">
          {r.type === "CREDIT_NOTE" ? "−" : ""}
          {formatINR(r.total)}
        </span>
      </div>
    </Link>
  );
}

// ───────────────────────────── reports ─────────────────────────────

function Reports({ from, to, periodText }: { from: string; to: string; periodText: string }) {
  const href = (kind: string) => `/api/admin/exports?${new URLSearchParams({ kind, from, to })}`;
  const wholeMonth = isWholeMonth(from, to);
  const items = [
    {
      kind: "gstr1",
      title: "GSTR-1",
      file: "Excel",
      help: "Sales, credit notes and HSN summary in the GSTR-1 layout. Run it for one calendar month.",
      warn: wholeMonth ? null : "This period is not one whole calendar month. GSTR-1 is filed month by month.",
    },
    {
      kind: "register",
      title: "Sales register",
      file: "Excel",
      help: "Every invoice and note in the period, line by line, with GST split.",
      warn: null,
    },
    {
      kind: "tally",
      title: "Tally",
      file: "XML",
      help: "Sales, notes and payments as vouchers. In Tally: Gateway of Tally → Import → Vouchers, then pick this file.",
      warn: null,
    },
  ];
  return (
    <div className="space-y-3">
      <p className="text-sm text-[var(--ink-2)]">
        Downloads for <b>{periodText}</b>. Ledger names for Tally are set in Settings → GST &amp; invoices.
      </p>
      <div className="card divide-y divide-[var(--line)]">
        {items.map((it) => (
          <div key={it.kind} className="p-4 flex flex-col sm:flex-row sm:items-center gap-3 sm:justify-between">
            <div className="min-w-0">
              <p className="font-heading font-bold">
                {it.title} <span className="text-xs font-normal text-[var(--muted)]">({it.file})</span>
              </p>
              <p className="text-sm text-[var(--muted)] mt-0.5">{it.help}</p>
              {it.warn && (
                <p className="text-xs text-[var(--kesar-text)] mt-1 flex items-start gap-1">
                  <Icon name="alert" className="h-3.5 w-3.5 shrink-0 mt-0.5" /> {it.warn}
                </p>
              )}
            </div>
            <a className="btn btn-outline btn-sm shrink-0 self-start sm:self-center" href={href(it.kind)} download>
              <Icon name="download" className="h-4 w-4" /> Download
            </a>
          </div>
        ))}
      </div>
    </div>
  );
}
