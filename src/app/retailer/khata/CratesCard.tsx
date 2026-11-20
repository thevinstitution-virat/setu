"use client";

import { useEffect, useState } from "react";
import Icon from "@/components/Icon";

type Balance = { returnableId: string; name: string; balance: number };

/** Crates / jars the shop holds. Hidden when there are none. */
export default function CratesCard() {
  const [rows, setRows] = useState<Balance[]>([]);

  useEffect(() => {
    let live = true;
    fetch("/api/returnables/balances")
      .then((r) => (r.ok ? r.json() : null))
      .then((d: { balances?: Balance[] } | null) => live && setRows((d?.balances ?? []).filter((b) => b.balance > 0)))
      .catch(() => {});
    return () => {
      live = false;
    };
  }, []);

  if (rows.length === 0) return null;
  return (
    <section className="card p-4 space-y-2 print:hidden">
      <div className="flex items-center gap-2">
        <Icon name="box" className="h-4 w-4 text-[var(--kesar-text)]" />
        <h2 className="font-bold text-base">Crates &amp; jars with you</h2>
      </div>
      <ul className="divide-y divide-black/5">
        {rows.map((b) => (
          <li key={b.returnableId} className="py-2 flex items-center justify-between gap-3 text-sm">
            <span className="min-w-0 break-words">{b.name}</span>
            <span className="font-bold shrink-0">{b.balance}</span>
          </li>
        ))}
      </ul>
      <p className="text-xs text-[var(--muted)]">Give the empties back to the driver at the next delivery.</p>
    </section>
  );
}
