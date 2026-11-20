"use client";

import { useEffect, useState } from "react";
import Stepper from "./Stepper";

type Returnable = { id: string; name: string; nameHi: string | null; unitCharge: number; active: boolean };
type Balance = { returnableId: string; name: string; balance: number };

/** Crates / jars counted at the drop, per type. */
export type CrateState = Record<string, { given: number; taken: number }>;

export const cratesBody = (c: CrateState) =>
  Object.entries(c)
    .filter(([, v]) => v.given > 0 || v.taken > 0)
    .map(([returnableId, v]) => ({ returnableId, given: v.given, taken: v.taken }));

/**
 * Crates & jars: the shop's balance per type and how many full ones are left
 * / empties taken back. Hidden when the business doesn't use returnables.
 */
export default function ReturnablesCard({
  retailerId,
  value,
  onChangeAction,
}: {
  retailerId: string;
  value: CrateState;
  onChangeAction: (c: CrateState) => void;
}) {
  const [types, setTypes] = useState<Returnable[] | null>(null);
  const [balances, setBalances] = useState<Balance[] | null>(null);

  useEffect(() => {
    let live = true;
    fetch("/api/returnables")
      .then((r) => (r.ok ? r.json() : { returnables: [] }))
      .then((d: { returnables?: Returnable[] }) => live && setTypes((d.returnables ?? []).filter((t) => t.active)))
      .catch(() => live && setTypes([]));
    fetch(`/api/returnables/balances?retailerId=${encodeURIComponent(retailerId)}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d: { balances?: Balance[] } | null) => live && setBalances(d?.balances ?? null))
      .catch(() => live && setBalances(null));
    return () => {
      live = false;
    };
  }, [retailerId]);

  if (!types || types.length === 0) return null;

  const set = (id: string, patch: Partial<CrateState[string]>) =>
    onChangeAction({ ...value, [id]: { ...(value[id] ?? { given: 0, taken: 0 }), ...patch } });

  return (
    <div className="card p-4 space-y-3">
      <p className="text-sm font-semibold">Crates &amp; jars</p>
      <ul className="divide-y divide-[var(--line)]">
        {types.map((t) => {
          const v = value[t.id] ?? { given: 0, taken: 0 };
          const held = balances?.find((b) => b.returnableId === t.id)?.balance;
          return (
            <li key={t.id} className="py-3 space-y-2">
              <div className="flex items-center justify-between gap-3">
                <p className="text-sm font-semibold break-words min-w-0">{t.name}</p>
                <span className="chip shrink-0">
                  Shop has {balances ? (held ?? 0) : "—"}
                </span>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <p className="text-xs text-[var(--muted)] mb-1">Given (full)</p>
                  <Stepper value={v.given} max={999} label={`${t.name} given`} onChangeAction={(n) => set(t.id, { given: n })} />
                </div>
                <div>
                  <p className="text-xs text-[var(--muted)] mb-1">Taken back</p>
                  <Stepper value={v.taken} max={999} label={`${t.name} taken back`} onChangeAction={(n) => set(t.id, { taken: n })} />
                </div>
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
