"use client";

import { use, useMemo, useState } from "react";
import Link from "next/link";
import Icon from "@/components/Icon";
import { formatINR } from "@/lib/money";
import { ErrorBox, errText, send, useFetch } from "@/components/admin/AdminKit";
import StockNav from "@/components/stock/StockNav";
import ProductPanel from "@/components/stock/overview/ProductPanel";
import { SMALL_CHIP, caseText, expiryInfo, plural, qtyText, type StockData, type StockRow } from "@/components/stock/overview/kit";

const FILTERS = [
  { key: "all", label: "All" },
  { key: "low", label: "To reorder" },
  { key: "out", label: "Out of stock" },
  { key: "expiring", label: "Expiring soon" },
  { key: "expired", label: "Expired" },
] as const;
type Filter = (typeof FILTERS)[number]["key"];

const isFilter = (v: unknown): v is Filter => typeof v === "string" && FILTERS.some((f) => f.key === v);

/** Same rules as the server's ?filter=, applied here so the chips switch at once. */
const MATCH: Record<Filter, (r: StockRow) => boolean> = {
  all: () => true,
  low: (r) => r.low,
  out: (r) => r.out,
  expiring: (r) => !!r.nextExpiry && !r.nextExpiry.expired,
  expired: (r) => r.expired > 0,
};

export default function StockPage({ searchParams }: { searchParams: Promise<{ filter?: string | string[] }> }) {
  const { filter: initial } = use(searchParams);
  const [filter, setFilter] = useState<Filter>(isFilter(initial) ? initial : "all");
  const [q, setQ] = useState("");
  const [openId, setOpenId] = useState<string | null>(null);
  const { data, error, reload } = useFetch<StockData>("/api/stock");

  function pick(f: Filter) {
    setFilter(f);
    try {
      window.history.replaceState(null, "", f === "all" ? "/admin/stock" : `/admin/stock?filter=${f}`);
    } catch {
      /* address bar only */
    }
  }

  const counts = useMemo(() => {
    const out = {} as Record<Filter, number>;
    for (const f of FILTERS) out[f.key] = (data?.products ?? []).filter(MATCH[f.key]).length;
    return out;
  }, [data]);

  const query = q.trim().toLowerCase();
  const shown = (data?.products ?? []).filter((r) => MATCH[filter](r) && (!query || r.name.toLowerCase().includes(query) || r.sku.toLowerCase().includes(query)));
  const open = openId ? (data?.products.find((p) => p.id === openId) ?? null) : null;

  return (
    <div className="space-y-5 pb-24">
      <div className="page-head">
        <div className="min-w-0">
          <p className="page-kick">Inventory</p>
          <h1 className="page-title">Stock</h1>
          <p className="page-sub">What you have, where it is, and what to reorder.</p>
        </div>
        {data?.settings.enabled && (
          <Link href="/admin/stock/receive" className="btn btn-kesar btn-sm !min-h-[44px]">
            <Icon name="plus" className="h-4 w-4" /> Receive goods
          </Link>
        )}
      </div>
      <StockNav />

      {error && <ErrorBox message={error} onRetry={reload} />}
      {!data && !error && <p className="text-sm text-[var(--muted)]">Loading…</p>}

      {data && !data.settings.enabled && (
        <div className="card p-6 text-center space-y-3 max-w-lg mx-auto">
          <span className="icon-tile mx-auto bg-[var(--genda-tint)] text-[var(--genda-text)]">
            <Icon name="stock" />
          </span>
          <p className="font-heading font-bold text-lg">Stock tracking is off</p>
          <p className="text-sm text-[var(--muted)]">Turn it on to count stock in your warehouses and vans, track batches and expiry, and see what to reorder.</p>
          <Link href="/admin/settings#stock" className="btn btn-kesar">
            <Icon name="settings" className="h-4 w-4" /> Open settings
          </Link>
        </div>
      )}

      {data && data.settings.enabled && (
        <>
          <Tiles data={data} onPick={pick} />

          {data.totals.expired > 0 && <ExpiredBar count={data.totals.expired} onDone={reload} />}

          <div className="space-y-3">
            <div className="-mx-4 overflow-x-auto px-4 sm:mx-0 sm:px-0">
              <div className="flex w-max gap-1.5 pb-1" role="tablist" aria-label="Show">
                {FILTERS.map((f) => (
                  <button
                    key={f.key}
                    type="button"
                    role="tab"
                    aria-selected={filter === f.key}
                    onClick={() => pick(f.key)}
                    className={`inline-flex h-10 items-center gap-1.5 whitespace-nowrap rounded-full border px-3.5 text-sm font-semibold transition-colors ${
                      filter === f.key ? "border-[var(--mor)] bg-[var(--mor)] text-white" : "border-foreground/15 bg-white/60 text-foreground/75 hover:bg-white"
                    }`}
                  >
                    {f.label}
                    <span className={`text-xs ${filter === f.key ? "text-white/75" : "text-[var(--muted)]"}`}>{counts[f.key]}</span>
                  </button>
                ))}
              </div>
            </div>
            <div className="relative sm:max-w-sm">
              <Icon name="search" className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--muted)]" />
              <input className="input !pl-9" type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search name or SKU" aria-label="Search products" />
            </div>
          </div>

          {data.products.length === 0 ? (
            <div className="card p-6 text-center space-y-1">
              <p className="text-sm font-semibold">No active products</p>
              <p className="text-sm text-[var(--muted)]">
                Add products in{" "}
                <Link href="/admin/products" className="font-bold text-[var(--kesar-text)]">
                  Products
                </Link>{" "}
                first.
              </p>
            </div>
          ) : shown.length === 0 ? (
            <div className="card p-6 text-center">
              <p className="text-sm text-[var(--muted)]">{query ? "No product matches your search." : "Nothing here right now."}</p>
            </div>
          ) : (
            <ul className="card divide-y divide-[var(--line)] overflow-hidden">
              <li className="hidden md:flex items-center gap-4 px-4 py-2 text-[11px] font-bold uppercase tracking-[0.08em] text-[var(--muted)]">
                <span className="flex-1">Product</span>
                <span className="grid w-72 grid-cols-3 text-center">
                  <span>Warehouse</span>
                  <span>In vans</span>
                  <span>On orders</span>
                </span>
                <span className="w-32 text-right">Available</span>
              </li>
              {shown.map((r) => (
                <li key={r.id}>
                  <ProductRow r={r} alertDays={data.settings.expiryAlertDays} onOpen={() => setOpenId(r.id)} />
                </li>
              ))}
            </ul>
          )}

          {open && <ProductPanel key={open.id} product={open} alertDays={data.settings.expiryAlertDays} onClose={() => setOpenId(null)} onChanged={reload} />}
        </>
      )}
    </div>
  );
}

// ───────────────────────────── tiles ─────────────────────────────

function Tiles({ data, onPick }: { data: StockData; onPick: (f: Filter) => void }) {
  const t = data.totals;
  const tile = "card p-4 text-left min-w-0 block transition hover:shadow-lg";
  return (
    <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
      <div className="card p-4 min-w-0">
        <p className="stat-num !text-2xl break-words">{formatINR(t.value, { whole: true })}</p>
        <p className="stat-lbl">Stock value at cost</p>
      </div>
      <Link href="/admin/stock/reorder" className={tile}>
        <p className={`stat-num !text-2xl ${t.low ? "text-[var(--genda-text)]" : ""}`}>{t.low}</p>
        <p className="stat-lbl flex items-center gap-1">
          To reorder <Icon name="arrow" className="h-3.5 w-3.5" />
        </p>
      </Link>
      <button type="button" className={tile} onClick={() => onPick("expiring")}>
        <p className={`stat-num !text-2xl ${t.expiringSoon ? "text-[var(--genda-text)]" : ""}`}>{t.expiringSoon}</p>
        <p className="stat-lbl">Expiring in {plural(data.settings.expiryAlertDays, "day")}</p>
      </button>
      <button type="button" className={tile} onClick={() => onPick("expired")}>
        <p className={`stat-num !text-2xl ${t.expired ? "text-[#a8281e]" : ""}`}>{t.expired}</p>
        <p className="stat-lbl">{t.expired === 1 ? "Product with expired stock" : "Products with expired stock"}</p>
      </button>
    </div>
  );
}

// ───────────────────────────── expired → damaged ─────────────────────────────

function ExpiredBar({ count, onDone }: { count: number; onDone: () => void }) {
  const [asking, setAsking] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [flash, setFlash] = useState<string | null>(null);

  async function go() {
    setBusy(true);
    setError(null);
    try {
      const d = await send<{ result: { batches: number } }>("/api/stock/expired", "POST", {});
      setAsking(false);
      setFlash(d.result.batches ? `${plural(d.result.batches, "batch", "batches")} moved to the damaged bin.` : "No expired batches in the warehouses.");
      onDone();
    } catch (e) {
      setError(errText(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="card p-4 space-y-2 !bg-[#fde4e1]/70">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm font-semibold text-[#a8281e] flex items-center gap-2 min-w-0">
          <Icon name="alert" className="h-4 w-4 shrink-0" />
          {plural(count, "product")} {count === 1 ? "has" : "have"} expired stock.
        </p>
        {!asking && (
          <button type="button" className="btn btn-danger btn-sm !min-h-[40px]" onClick={() => setAsking(true)}>
            Move expired to damaged
          </button>
        )}
      </div>
      {asking && (
        <div className="space-y-2">
          <p className="text-sm text-[var(--ink-2)]">Every expired batch in your warehouses goes to the damaged bin, so it can&apos;t be sold or loaded.</p>
          <div className="flex flex-wrap gap-2">
            <button type="button" className="btn btn-danger btn-sm !min-h-[40px]" disabled={busy} onClick={go}>
              {busy ? "Moving…" : "Yes, move them"}
            </button>
            <button type="button" className="btn btn-quiet btn-sm !min-h-[40px]" disabled={busy} onClick={() => setAsking(false)}>
              Cancel
            </button>
          </div>
        </div>
      )}
      {error && <p className="text-sm text-[#a8281e]">{error}</p>}
      {flash && <p className="text-sm text-[var(--mint-text)]">{flash}</p>}
    </div>
  );
}

// ───────────────────────────── product row ─────────────────────────────

function ProductRow({ r, alertDays, onOpen }: { r: StockRow; alertDays: number; onOpen: () => void }) {
  const ex = r.nextExpiry ? expiryInfo(r.nextExpiry.date, alertDays) : null;
  const cases = caseText(r.available, r);
  return (
    <button type="button" onClick={onOpen} className="w-full text-left px-4 py-3 flex items-start md:items-center gap-4 min-h-[64px] hover:bg-black/[0.03] transition">
      <span className="min-w-0 flex-1 space-y-0.5">
        <span className="flex flex-wrap items-center gap-1.5">
          <span className="text-sm font-bold break-words">{r.name}</span>
          {r.out && <span className={`chip ${SMALL_CHIP} !bg-[#fde4e1] !text-[#a8281e] !border-transparent`}>Out</span>}
          {r.low && !r.out && <span className={`chip chip-genda ${SMALL_CHIP}`}>Reorder</span>}
          {r.expired > 0 && <span className={`chip chip-kesar ${SMALL_CHIP}`}>{r.expired} expired</span>}
        </span>
        <span className="block text-xs text-[var(--muted)] truncate">
          {r.sku}
          {r.category ? ` · ${r.category.name}` : ""}
        </span>
        <span className="block md:hidden text-xs text-[var(--ink-2)]">
          Warehouse {r.warehouse.toLocaleString("en-IN")} · Vans {r.van.toLocaleString("en-IN")} · On orders {r.reserved.toLocaleString("en-IN")}
        </span>
        {ex && r.nextExpiry && (
          <span className={`block text-xs font-semibold ${ex.tone}`}>
            {ex.text} · {qtyText(r.nextExpiry.qty, r.unit)}
          </span>
        )}
      </span>
      <span className="hidden md:grid w-72 shrink-0 grid-cols-3 text-center text-sm">
        <span>{r.warehouse.toLocaleString("en-IN")}</span>
        <span>{r.van.toLocaleString("en-IN")}</span>
        <span>{r.reserved.toLocaleString("en-IN")}</span>
      </span>
      <span className="shrink-0 text-right md:w-32">
        <span className={`block font-heading font-bold text-2xl leading-none ${r.available <= 0 ? "text-[#a8281e]" : ""}`}>{r.available.toLocaleString("en-IN")}</span>
        <span className="block text-[11px] text-[var(--muted)] mt-1">{r.unit} available</span>
        {cases && <span className="block text-[11px] text-[var(--muted)]">{cases}</span>}
      </span>
    </button>
  );
}
