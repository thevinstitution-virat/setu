"use client";

import { use, useMemo, useState } from "react";
import { MOVE_LABEL } from "@/lib/inventory-settings";
import { ErrorBox, Field, SearchPick, api, errText, useFetch, type Option } from "@/components/admin/AdminKit";
import StockNav from "@/components/stock/StockNav";
import { KIND_LABEL, MoveRow, todayYmd, ymdText, type Move, type Place, type StockData } from "@/components/stock/overview/kit";

type Page = { moves: Move[]; next: string | null };
const YMD = /^\d{4}-\d{2}-\d{2}$/;

/** IST day of a timestamp, YYYY-MM-DD. */
const istDay = (iso: string) => new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata" }).format(new Date(iso));

export default function StockHistoryPage({ searchParams }: { searchParams: Promise<{ productId?: string | string[] }> }) {
  const { productId: initial } = use(searchParams);
  const [productId, setProductId] = useState<string | null>(typeof initial === "string" && initial ? initial : null);
  const [kind, setKind] = useState("");
  const [placeId, setPlaceId] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [more, setMore] = useState<{ key: string; moves: Move[]; next: string | null } | null>(null);
  const [moreBusy, setMoreBusy] = useState(false);
  const [moreError, setMoreError] = useState<string | null>(null);

  const stock = useFetch<StockData>("/api/stock");
  const places = useFetch<{ locations: Place[] }>("/api/stock/locations");

  // Date range: both ends are needed by the API; one end alone means "that day to today" / "just that day".
  let rangeError: string | null = null;
  let range: { from: string; to: string } | null = null;
  if (from || to) {
    const f = from || to;
    const t = to || (from ? todayYmd() : to);
    if (!YMD.test(f) || !YMD.test(t)) rangeError = "Pick valid dates";
    else if (f > t) rangeError = "The start date is after the end date";
    else if (Date.parse(t) - Date.parse(f) > 400 * 86_400_000) rangeError = "Pick at most about a year at a time";
    else range = { from: f, to: t };
  }

  const params = new URLSearchParams();
  if (productId) params.set("productId", productId);
  if (kind) params.set("kind", kind);
  if (placeId) params.set("locationId", placeId);
  if (range) {
    params.set("from", range.from);
    params.set("to", range.to);
  }
  const qs = params.toString();
  const url = `/api/stock/moves${qs ? `?${qs}` : ""}`;
  const first = useFetch<Page>(rangeError ? null : url);

  const extra = more && more.key === url ? more : null;
  const moves = first.data ? [...first.data.moves, ...(extra?.moves ?? [])] : [];
  const next = extra ? extra.next : (first.data?.next ?? null);

  async function loadMore() {
    if (!next) return;
    setMoreBusy(true);
    setMoreError(null);
    const p = new URLSearchParams(params);
    p.set("before", next);
    try {
      const d = await api<Page>(`/api/stock/moves?${p}`);
      setMore({ key: url, moves: [...(extra?.moves ?? []), ...d.moves], next: d.next });
    } catch (e) {
      setMoreError(errText(e));
    } finally {
      setMoreBusy(false);
    }
  }

  const productOpts: Option[] = useMemo(() => (stock.data?.products ?? []).map((p) => ({ id: p.id, label: p.name, sub: p.sku })), [stock.data]);
  const filtered = !!(productId || kind || placeId || from || to);

  const days: { day: string; moves: Move[] }[] = [];
  for (const m of moves) {
    const d = istDay(m.at);
    const last = days[days.length - 1];
    if (last && last.day === d) last.moves.push(m);
    else days.push({ day: d, moves: [m] });
  }

  return (
    <div className="space-y-5 pb-24">
      <div className="page-head">
        <div className="min-w-0">
          <p className="page-kick">Stock</p>
          <h1 className="page-title">Stock history</h1>
          <p className="page-sub">Every move in and out, newest first.</p>
        </div>
      </div>
      <StockNav />

      <section className="card p-4 space-y-3">
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Field label="Product" className="sm:col-span-2 lg:col-span-1">
            {stock.error ? (
              <p className="text-sm text-[#a8281e]">{stock.error}</p>
            ) : (
              <SearchPick options={productOpts} value={productId} onChange={setProductId} placeholder={stock.data ? "All products" : "Loading…"} />
            )}
          </Field>
          <Field label="What happened">
            <select className="input" value={kind} onChange={(e) => setKind(e.target.value)}>
              <option value="">Everything</option>
              {Object.entries(MOVE_LABEL).map(([k, label]) => (
                <option key={k} value={k}>
                  {label}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Place">
            <select className="input" value={placeId} onChange={(e) => setPlaceId(e.target.value)}>
              <option value="">All places</option>
              {(places.data?.locations ?? []).map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name} ({KIND_LABEL[p.kind]}){p.active ? "" : " · off"}
                </option>
              ))}
            </select>
          </Field>
          <div className="grid grid-cols-2 gap-2 min-w-0">
            <Field label="From">
              <input className="input !px-2" type="date" value={from} max={to || undefined} onChange={(e) => setFrom(e.target.value)} />
            </Field>
            <Field label="To">
              <input className="input !px-2" type="date" value={to} min={from || undefined} onChange={(e) => setTo(e.target.value)} />
            </Field>
          </div>
        </div>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="text-xs text-[var(--muted)]">
            {range ? (range.from === range.to ? `On ${ymdText(range.from)}` : `${ymdText(range.from)} to ${ymdText(range.to)}`) : "All dates"}
          </p>
          {filtered && (
            <button
              type="button"
              className="btn btn-quiet btn-xs !min-h-[40px]"
              onClick={() => {
                setProductId(null);
                setKind("");
                setPlaceId("");
                setFrom("");
                setTo("");
              }}
            >
              Clear filters
            </button>
          )}
        </div>
        {rangeError && <p className="text-sm text-[#a8281e]">{rangeError}</p>}
      </section>

      {first.error && <ErrorBox message={first.error} onRetry={first.reload} />}
      {!rangeError && !first.data && !first.error && <p className="text-sm text-[var(--muted)]">Loading…</p>}

      {first.data && moves.length === 0 && (
        <div className="card p-6 text-center space-y-1">
          <p className="text-sm font-semibold">{filtered ? "Nothing matches these filters" : "No stock moves yet"}</p>
          <p className="text-sm text-[var(--muted)]">Receiving goods, loading vans, sales and adjustments all show here.</p>
        </div>
      )}

      {days.map((d) => (
        <section key={d.day} className="space-y-2">
          <p className="text-xs font-extrabold uppercase tracking-[0.1em] text-[var(--ink-2)]">{d.day === todayYmd() ? "Today" : ymdText(d.day)}</p>
          <ul className="card divide-y divide-[var(--line)] overflow-hidden">
            {d.moves.map((m) => (
              <li key={m.id}>
                <MoveRow m={m} />
              </li>
            ))}
          </ul>
        </section>
      ))}

      {next && (
        <div className="flex flex-col items-center gap-2">
          <button type="button" className="btn btn-outline" disabled={moreBusy} onClick={loadMore}>
            {moreBusy ? "Loading…" : "Load more"}
          </button>
          {moreError && <p className="text-sm text-[#a8281e]">{moreError}</p>}
        </div>
      )}
    </div>
  );
}
