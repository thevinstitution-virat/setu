"use client";

import { formatINR } from "@/lib/money";
import { SHORT_REASONS } from "@/lib/delivery-settings";
import { qtyLabel } from "@/components/store/format";
import Stepper from "./Stepper";
import { deliveredOf, fullLines, orderedOf, type DeliverItem, type LineState } from "./deliver-model";

/**
 * What is handed over, line by line. Every line (free goods too) starts at
 * the ordered quantity; a lower count needs a reason.
 */
export default function LinesCard({
  orderNumber,
  items,
  lines,
  onChangeAction,
  full,
  amount,
  notes,
}: {
  orderNumber: string;
  items: DeliverItem[];
  lines: LineState;
  onChangeAction: (l: LineState) => void;
  /** Order value if everything is handed over, and for the counts now (paise). */
  full: number;
  amount: number;
  notes: string | null;
}) {
  const changed = items.some((i) => deliveredOf(lines, i) !== orderedOf(i));
  const set = (id: string, patch: Partial<LineState[string]>) =>
    onChangeAction({ ...lines, [id]: { ...(lines[id] ?? { qty: 0, reason: "" }), ...patch } });

  return (
    <div className="card p-4 space-y-3">
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <p className="text-sm font-semibold">Items to hand over</p>
          <p className="text-xs text-[var(--muted)] break-all">{orderNumber}</p>
        </div>
        {changed && (
          <button type="button" className="btn btn-quiet shrink-0" onClick={() => onChangeAction(fullLines(items))}>
            Deliver all
          </button>
        )}
      </div>

      <ul className="divide-y divide-[var(--line)]">
        {items.map((i) => {
          const ordered = orderedOf(i);
          const qty = deliveredOf(lines, i);
          const free = !!i.freeSchemeId || i.price === 0;
          const short = qty < ordered;
          return (
            <li key={i.id} className="py-3 space-y-2">
              <div className="flex items-start justify-between gap-2">
                <p className="text-sm font-semibold break-words min-w-0">{i.product.name}</p>
                {free && <span className="chip chip-mint shrink-0">FREE</span>}
              </div>
              <div className="flex items-center justify-between gap-3">
                <div className="min-w-0 text-xs text-[var(--muted)]">
                  <p>Ordered {qtyLabel(ordered, i.product.unit, i.cases, i.caseSize, i.product.caseUnit)}</p>
                  {!free && (
                    <p>
                      {formatINR(i.price)}
                      {i.product.unit ? ` / ${i.product.unit}` : ""}
                    </p>
                  )}
                </div>
                <Stepper value={qty} max={ordered} label={i.product.name} onChangeAction={(n) => set(i.id, { qty: n })} />
              </div>
              {short && (
                <label className="block rounded-xl bg-[var(--kesar-tint)] p-2.5">
                  <span className="text-xs font-bold text-[var(--kesar-text)]">
                    {ordered - qty} short. Why?
                  </span>
                  <select
                    className="input mt-1 !min-h-[44px]"
                    value={lines[i.id]?.reason ?? ""}
                    onChange={(e) => set(i.id, { reason: e.target.value })}
                  >
                    <option value="">Pick a reason</option>
                    {Object.entries(SHORT_REASONS).map(([k, v]) => (
                      <option key={k} value={k}>
                        {v}
                      </option>
                    ))}
                  </select>
                </label>
              )}
            </li>
          );
        })}
      </ul>

      <div className="border-t border-[var(--line)] pt-3 flex items-end justify-between gap-3">
        <div>
          <p className="text-xs text-[var(--muted)]">Amount for this order</p>
          {changed && amount !== full && (
            <p className="text-xs text-[var(--muted)] line-through">{formatINR(full)}</p>
          )}
        </div>
        <p className="font-heading font-bold text-xl">{formatINR(amount)}</p>
      </div>
      {notes && <p className="text-xs text-[var(--muted)]">Note: {notes}</p>}
    </div>
  );
}
