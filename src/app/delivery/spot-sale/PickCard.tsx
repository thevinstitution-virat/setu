"use client";

import { useState } from "react";
import Stepper from "../orders/[id]/Stepper";
import { unitsLabel } from "./van";

export type FreeRow = { productId: string; name: string; unit: string; caseSize: number | null; free: number };
export type PickState = Record<string, number>;

/**
 * Step 2: products free in the van, each with − / + (never more than is
 * free). Products sold in cases get a "+ case" button. `over`: products the
 * last price check found short in the van (productId → free).
 */
export default function PickCard({
  rows,
  value,
  over,
  onChangeAction,
}: {
  rows: FreeRow[];
  value: PickState;
  over: Record<string, number>;
  onChangeAction: (v: PickState) => void;
}) {
  const [q, setQ] = useState("");
  // Products already picked stay listed even if the van no longer has them free.
  const listed = rows.filter((r) => r.free > 0 || (value[r.productId] ?? 0) > 0);
  const held = rows.length - listed.length;
  const needle = q.trim().toLowerCase();
  const shown = needle ? listed.filter((r) => r.name.toLowerCase().includes(needle)) : listed;
  const picked = Object.values(value).filter((n) => n > 0).length;
  const set = (id: string, n: number) => {
    const next = { ...value };
    if (n > 0) next[id] = n;
    else delete next[id];
    onChangeAction(next);
  };

  if (listed.length === 0) {
    return (
      <p className="text-sm text-[var(--muted)]">
        Nothing is free to sell in the van. Everything left is for your stops.
      </p>
    );
  }

  return (
    <div className="space-y-3">
      {(picked > 0 || listed.length > 6) && (
        <div className="flex items-center gap-2">
          {listed.length > 6 && (
            <input
              className="input flex-1 min-w-0"
              type="search"
              enterKeyHint="search"
              placeholder="Find a product"
              aria-label="Find a product"
              value={q}
              onChange={(e) => setQ(e.target.value)}
            />
          )}
          {picked > 0 && (
            <button type="button" className="btn btn-quiet shrink-0 ml-auto" onClick={() => onChangeAction({})}>
              Clear {picked}
            </button>
          )}
        </div>
      )}

      <ul className="divide-y divide-[var(--line)]">
        {shown.map((r) => {
          const qty = value[r.productId] ?? 0;
          const hasCase = !!r.caseSize && r.caseSize > 1;
          const short = r.productId in over;
          return (
            <li key={r.productId} className="py-3 space-y-2">
              <p className="text-sm font-semibold break-words">{r.name}</p>
              <div className="flex items-center justify-between gap-3">
                <div className="min-w-0 text-xs text-[var(--muted)]">
                  <p className={r.free === 0 ? "text-[var(--risk-text)] font-semibold" : ""}>{unitsLabel(r.free, r.unit, r.caseSize)} free</p>
                  {hasCase && (
                    <button
                      type="button"
                      className="btn btn-quiet btn-xs mt-1"
                      disabled={qty + r.caseSize! > r.free}
                      onClick={() => set(r.productId, qty + r.caseSize!)}
                      aria-label={`One more case of ${r.name}`}
                    >
                      + case of {r.caseSize}
                    </button>
                  )}
                </div>
                <Stepper value={qty} max={Math.max(r.free, 0)} label={r.name} onChangeAction={(n) => set(r.productId, n)} />
              </div>
              {short && (
                <p className="text-xs font-semibold text-[var(--risk-text)]">
                  {over[r.productId] > 0 ? `Only ${over[r.productId]} free in the van (free goods count too).` : "None free in the van now."}
                </p>
              )}
            </li>
          );
        })}
      </ul>
      {shown.length === 0 && <p className="text-sm text-[var(--muted)] text-center py-2">No product matches.</p>}
      {held > 0 && (
        <p className="text-xs text-[var(--muted)]">
          {held} more product{held === 1 ? " is" : "s are"} in the van, all for your stops.
        </p>
      )}
    </div>
  );
}
