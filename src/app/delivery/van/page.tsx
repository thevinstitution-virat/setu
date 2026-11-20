"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import Icon from "@/components/Icon";
import { expiryLabel, fetchVan, istToday, lotExpired, unitsLabel, type VanData, type VanRow } from "../spot-sale/van";

const STATUS = {
  PLANNED: { label: "Not started", cls: "chip-genda" },
  STARTED: { label: "On the road", cls: "chip-kesar" },
  CLOSED: { label: "Closed", cls: "" },
} as const;

/**
 * Van stock: what is in the driver's van per product — on hand, held for the
 * trip's stops, free to sell — with batches and expiry. The way into a spot
 * sale while the trip is running.
 */
export default function VanStockPage() {
  const [data, setData] = useState<VanData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [nonce, setNonce] = useState(0);
  const [q, setQ] = useState("");

  useEffect(() => {
    let live = true;
    fetchVan()
      .then((d) => {
        if (!live) return;
        setData(d);
        setError(null);
      })
      .catch((e: unknown) => live && setError(e instanceof Error ? e.message : "Could not load the van stock"));
    return () => {
      live = false;
    };
  }, [nonce]);

  const head = (
    <div>
      <p className="page-kick">Van stock</p>
      <h1 className="page-title">{data?.trip?.vehicle?.number ?? "Your van"}</h1>
    </div>
  );

  if (!data) {
    return (
      <div className="space-y-5">
        {head}
        {error ? (
          <div className="card p-5 space-y-3">
            <p className="text-sm text-[#a8281e]">{error}</p>
            <button type="button" className="btn btn-outline w-full" onClick={() => setNonce((n) => n + 1)}>
              Try again
            </button>
          </div>
        ) : (
          <p className="text-sm text-[var(--muted)]">Loading…</p>
        )}
      </div>
    );
  }

  if (!data.enabled) {
    return (
      <div className="space-y-5">
        {head}
        <Empty icon="stock" text="Stock isn't tracked for vans in this business." />
      </div>
    );
  }

  if (!data.trip) {
    return (
      <div className="space-y-5">
        {head}
        <Empty icon="truck" text="No trip today, so there is no van stock to show." />
      </div>
    );
  }

  const trip = data.trip;
  const s = STATUS[trip.status];
  const rows = data.rows;
  const needle = q.trim().toLowerCase();
  const shown = needle ? rows.filter((r) => r.name.toLowerCase().includes(needle)) : rows;
  const sellable = rows.filter((r) => r.free > 0).length;
  const expiredRows = rows.filter((r) => r.expired > 0).length;

  return (
    <div className="space-y-5">
      {head}

      <div className="card p-4 flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-xs text-[var(--muted)]">Trip</p>
          <p className="font-heading font-bold text-lg leading-tight break-all">{trip.number}</p>
        </div>
        <span className={`chip shrink-0 ${s.cls}`}>{s.label}</span>
      </div>

      {!trip.vehicle ? (
        <Empty icon="truck" text="This trip has no van. Ask the office to set one." />
      ) : (
        <>
          {rows.length > 0 && (
            <div className="panel-dark p-5 grid grid-cols-2 gap-4">
              <div>
                <p className="text-xs font-bold uppercase tracking-[0.12em] text-genda">Products</p>
                <p className="stat-num mt-2">{rows.length}</p>
              </div>
              <div>
                <p className="text-xs font-bold uppercase tracking-[0.12em] text-genda">Free to sell</p>
                <p className="stat-num mt-2">{sellable}</p>
                <p className="text-xs text-white/60 mt-1">product{sellable === 1 ? "" : "s"}</p>
              </div>
            </div>
          )}

          {data.canSell ? (
            sellable > 0 ? (
              <Link href="/delivery/spot-sale" className="btn btn-kesar w-full !min-h-[56px] text-base">
                <Icon name="cart" /> Spot sale
              </Link>
            ) : (
              rows.length > 0 && <p className="text-sm text-[var(--muted)]">Nothing is free to sell. All of it is for your stops.</p>
            )
          ) : (
            trip.status === "PLANNED" && (
              <p className="rounded-xl bg-[var(--genda-tint)] text-[var(--genda-text)] p-3 text-sm font-semibold">
                Start your trip to make spot sales from the van.
              </p>
            )
          )}

          {expiredRows > 0 && (
            <p className="flex items-start gap-2 rounded-xl bg-[#fde4e1] text-[#a8281e] p-3 text-sm font-semibold">
              <Icon name="alert" className="h-4 w-4 shrink-0 mt-0.5" />
              <span>
                {expiredRows} product{expiredRows === 1 ? " has" : "s have"} expired stock. Don&apos;t sell it; hand it back at the office.
              </span>
            </p>
          )}

          {rows.length === 0 ? (
            <Empty icon="box" text="The van is empty. Goods are loaded at the warehouse before the trip." />
          ) : (
            <section className="space-y-3">
              {rows.length > 6 && (
                <input
                  className="input"
                  type="search"
                  enterKeyHint="search"
                  placeholder="Find a product"
                  aria-label="Find a product"
                  value={q}
                  onChange={(e) => setQ(e.target.value)}
                />
              )}
              {shown.map((r) => (
                <VanRowCard key={r.productId} row={r} />
              ))}
              {shown.length === 0 && <p className="text-sm text-[var(--muted)] text-center py-4">No product matches.</p>}
            </section>
          )}
        </>
      )}

      <Link href="/delivery" className="btn btn-outline w-full">
        <Icon name="chevronLeft" className="h-4 w-4" /> Back to trip
      </Link>
    </div>
  );
}

function Empty({ icon, text }: { icon: "stock" | "truck" | "box"; text: string }) {
  return (
    <div className="card p-6 text-center">
      <span className="icon-tile mx-auto mb-3 bg-black/[0.06] text-[var(--muted)]">
        <Icon name={icon} />
      </span>
      <p className="text-sm text-[var(--ink-2)]">{text}</p>
    </div>
  );
}

/** One product: on hand / for stops / free, then its batches (expired ones in red). */
function VanRowCard({ row: r }: { row: VanRow }) {
  const today = istToday();
  const lots = [...r.lots].sort((a, b) => (a.expiry ?? "9999").localeCompare(b.expiry ?? "9999"));
  const showLots = lots.length > 1 || lots.some((l) => l.batch || l.expiry);
  return (
    <div className="card p-4 space-y-3">
      <div className="flex items-start justify-between gap-3">
        <p className="font-bold text-sm break-words min-w-0">{r.name}</p>
        {r.caseSize && r.caseSize > 1 && <span className="chip !py-0.5 !text-[11.5px] shrink-0">case of {r.caseSize}</span>}
      </div>

      <div className="grid grid-cols-3 gap-2 text-center">
        <div className="rounded-xl bg-black/[0.04] p-2">
          <p className="text-[11px] text-[var(--muted)]">On hand</p>
          <p className="font-bold text-sm mt-0.5">{r.onHand}</p>
        </div>
        <div className="rounded-xl bg-black/[0.04] p-2">
          <p className="text-[11px] text-[var(--muted)]">For stops</p>
          <p className="font-bold text-sm mt-0.5">{r.reserved}</p>
        </div>
        <div className={`rounded-xl p-2 ${r.free > 0 ? "bg-[var(--kesar-tint)]" : "bg-black/[0.04]"}`}>
          <p className={`text-[11px] ${r.free > 0 ? "text-[var(--kesar-text)]" : "text-[var(--muted)]"}`}>Free to sell</p>
          <p className={`font-bold text-sm mt-0.5 ${r.free > 0 ? "text-[var(--kesar-text)]" : ""}`}>{r.free}</p>
        </div>
      </div>
      <p className="text-xs text-[var(--muted)]">
        In {r.unit}
        {r.free > 0 && r.caseSize && r.caseSize > 1 ? ` · free: ${unitsLabel(r.free, r.unit, r.caseSize)}` : ""}
      </p>
      {r.reserved > r.onHand - r.expired && (
        <p className="text-xs font-semibold text-[#a8281e]">
          Short for your stops by {r.reserved - (r.onHand - r.expired)} {r.unit}.
        </p>
      )}

      {showLots && (
        <ul className="divide-y divide-[var(--line)] border-t border-[var(--line)]">
          {lots.map((l, i) => {
            const gone = lotExpired(l, today);
            return (
              <li
                key={`${l.batch}-${l.expiry ?? ""}-${i}`}
                className={`py-2 flex items-center justify-between gap-3 text-xs ${gone ? "text-[#a8281e]" : ""}`}
              >
                <span className="min-w-0 break-words">
                  {l.batch ? <b>Batch {l.batch}</b> : <b>No batch</b>}
                  {l.expiry ? ` · ${gone ? "expired" : "expires"} ${expiryLabel(l.expiry)}` : ""}
                </span>
                <span className="flex items-center gap-1.5 shrink-0">
                  {gone && <span className="chip !py-0.5 !text-[11px] !bg-[#fde4e1] !text-[#a8281e] !border-transparent">Expired</span>}
                  <span className="font-bold">{l.qty}</span>
                </span>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
