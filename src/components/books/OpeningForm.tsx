"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import { errText, Field, readRupees, rupeeText, send } from "@/components/admin/AdminKit";
import { formatINR } from "@/lib/money";
import type { openingView } from "@/lib/final-accounts";

type View = Awaited<ReturnType<typeof openingView>>;
type Amt = { dr: string; cr: string };
const todayIst = () => new Date(Date.now() + 5.5 * 3_600_000).toISOString().slice(0, 10);
const showDay = (d: string) => d.split("-").reverse().join("/");

/** The opening trial balance: each account's balance on the day before the books start here, and the stock then. */
export default function OpeningForm({ view, canSetup }: { view: View; canSetup: boolean }) {
  const router = useRouter();
  const defaultStart = () => {
    const t = todayIst();
    return Number(t.slice(5, 7)) >= 4 ? `${t.slice(0, 4)}-04-01` : `${Number(t.slice(0, 4)) - 1}-04-01`;
  };
  const [startOn, setStartOn] = useState(view.startOn ?? defaultStart());
  const [stock, setStock] = useState(rupeeText(view.openingStock));
  const [amts, setAmts] = useState<Record<string, Amt>>(() =>
    Object.fromEntries(view.accounts.map((a) => [a.code, { dr: a.amount > 0 ? rupeeText(a.amount) : "", cr: a.amount < 0 ? rupeeText(-a.amount) : "" }])),
  );
  const [q, setQ] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);

  const totals = useMemo(() => {
    let dr = 0;
    let cr = 0;
    let bad = false;
    for (const v of Object.values(amts)) {
      const d = readRupees(v.dr);
      const c = readRupees(v.cr);
      if (d === "bad" || c === "bad") bad = true;
      else {
        dr += d ?? 0;
        cr += c ?? 0;
      }
    }
    const s = readRupees(stock);
    if (s === "bad") bad = true;
    const stockP = s === "bad" ? 0 : (s ?? 0);
    const debit = dr + stockP + view.shops.dues;
    const credit = cr + view.shops.advances + view.suppliers.owed;
    return { bad, debit, credit, diff: debit - credit };
  }, [amts, stock, view.shops, view.suppliers]);

  const groups = useMemo(() => {
    const query = q.trim().toLowerCase();
    const out: { label: string; rows: View["accounts"] }[] = [];
    for (const a of view.accounts) {
      if (query && !`${a.name} ${a.groupLabel}`.toLowerCase().includes(query)) continue;
      const g = out.find((x) => x.label === a.groupLabel);
      if (g) g.rows.push(a);
      else out.push({ label: a.groupLabel, rows: [a] });
    }
    return out;
  }, [view.accounts, q]);

  const set = (code: string, side: "dr" | "cr", v: string) =>
    setAmts((m) => ({ ...m, [code]: { ...(m[code] ?? { dr: "", cr: "" }), [side]: v, ...(v ? { [side === "dr" ? "cr" : "dr"]: "" } : {}) } }));

  async function save() {
    setErr(null);
    setDone(null);
    const lines: { code: string; amount: number }[] = [];
    for (const [code, v] of Object.entries(amts)) {
      const d = readRupees(v.dr);
      const c = readRupees(v.cr);
      if (d === "bad" || c === "bad") return setErr("An amount is not a number");
      const amount = (d ?? 0) - (c ?? 0);
      if (amount) lines.push({ code, amount });
    }
    const s = readRupees(stock);
    if (s === "bad") return setErr("The opening stock is not a number");
    setBusy(true);
    try {
      await send("/api/admin/books/opening", "POST", { startOn, openingStock: s, lines });
      setDone("Saved.");
      router.refresh();
    } catch (e) {
      setErr(errText(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-4">
      <section className="card p-4 sm:p-5 space-y-3">
        <div>
          <h2 className="font-heading text-xl font-bold text-[var(--ink)]">Opening balances</h2>
          <p className="text-sm text-[var(--ink-2)] mt-1">
            Enter the balances from the old books as at the end of the day before the books start here: banks, cash, capital, loans, fixed assets, taxes and, for a switch in the middle of a year, the
            year&apos;s income and expenses so far. Shops&apos; and suppliers&apos; balances come bill by bill from their own pages.
          </p>
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Books start here on" hint={`Balances are as at the end of ${showDay(new Date(Date.parse(`${startOn}T00:00:00Z`) - 86_400_000).toISOString().slice(0, 10))}.`}>
            <input type="date" className="input" value={startOn} max={todayIst()} disabled={!canSetup} onChange={(e) => setStartOn(e.target.value)} />
          </Field>
          <Field
            label="Opening stock at cost (₹)"
            hint={
              view.stockSuggestion ? (
                <>
                  The app&apos;s stock then: {formatINR(view.stockSuggestion.value)}
                  {view.stockSuggestion.source === "count" ? " (counted)" : ""}.{" "}
                  {canSetup && (
                    <button type="button" className="font-semibold text-[var(--accent-text)] underline" onClick={() => setStock(rupeeText(view.stockSuggestion!.value))}>
                      Use it
                    </button>
                  )}
                </>
              ) : (
                "At the start of the first year in these books. Count it (Books → Stock) dated the day before, or take it from the old books."
              )
            }
          >
            <input className="input text-right" inputMode="decimal" value={stock} disabled={!canSetup} onChange={(e) => setStock(e.target.value)} />
          </Field>
        </div>
      </section>

      <section className="card p-0 overflow-hidden">
        <div className="p-3 sm:p-4">
          <input className="input !py-1.5" placeholder="Search accounts" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search accounts" />
        </div>
        <div className="grid grid-cols-[1fr_6rem_6rem] sm:grid-cols-[1fr_8rem_8rem] gap-2 px-3 sm:px-4 pb-1 text-[11px] uppercase tracking-wide text-[var(--muted)]">
          <span>Account</span>
          <span className="text-right">Debit ₹</span>
          <span className="text-right">Credit ₹</span>
        </div>
        {groups.map((g) => (
          <div key={g.label}>
            <p className="px-3 sm:px-4 py-1.5 bg-black/[0.03] text-xs font-bold text-[var(--ink-2)]">{g.label}</p>
            <ul className="divide-y divide-[var(--line)]">
              {g.rows.map((a) => (
                <li key={a.code} className="grid grid-cols-[1fr_6rem_6rem] sm:grid-cols-[1fr_8rem_8rem] items-center gap-2 px-3 sm:px-4 py-1.5">
                  <span className="text-sm min-w-0 truncate">{a.name}</span>
                  <input
                    className="input !py-1 !px-2 text-right tabular-nums"
                    inputMode="decimal"
                    aria-label={`${a.name} debit`}
                    value={amts[a.code]?.dr ?? ""}
                    disabled={!canSetup}
                    onChange={(e) => set(a.code, "dr", e.target.value)}
                  />
                  <input
                    className="input !py-1 !px-2 text-right tabular-nums"
                    inputMode="decimal"
                    aria-label={`${a.name} credit`}
                    value={amts[a.code]?.cr ?? ""}
                    disabled={!canSetup}
                    onChange={(e) => set(a.code, "cr", e.target.value)}
                  />
                </li>
              ))}
            </ul>
          </div>
        ))}
        <div className="border-t border-[var(--line)] px-3 sm:px-4 py-3 space-y-1 text-sm">
          <p className="flex justify-between gap-3">
            <span>
              Shops&apos; opening bills ({view.shops.count}){" "}
              <Link href="/admin/khata" className="text-[var(--accent-text)] underline">
                khata
              </Link>
            </span>
            <span className="tabular-nums">
              {formatINR(view.shops.dues)} Dr{view.shops.advances ? ` · ${formatINR(view.shops.advances)} Cr` : ""}
            </span>
          </p>
          <p className="flex justify-between gap-3">
            <span>
              Suppliers&apos; opening bills ({view.suppliers.count}){" "}
              <Link href="/admin/books/suppliers" className="text-[var(--accent-text)] underline">
                suppliers
              </Link>
            </span>
            <span className="tabular-nums">{formatINR(view.suppliers.owed)} Cr</span>
          </p>
        </div>
      </section>

      <div className="sticky bottom-[5.5rem] md:bottom-3 z-20 rounded-2xl border border-[var(--line)] bg-white/95 backdrop-blur shadow-lg p-3 space-y-2">
        <div className="flex items-center justify-between gap-3 text-sm">
          <span className="min-w-0 tabular-nums">
            <span className="block">
              Debit {formatINR(totals.debit)} · Credit {formatINR(totals.credit)}
            </span>
            <span className={`block text-xs font-semibold ${totals.diff ? "text-[var(--risk-text)]" : "text-[#2e7d4f]"}`}>
              {totals.bad
                ? "Fix the amounts that are not numbers"
                : totals.diff
                  ? `Out by ${formatINR(Math.abs(totals.diff))} ${totals.diff > 0 ? "Dr" : "Cr"}: usually the capital`
                  : "Agrees: debits equal credits"}
            </span>
          </span>
          {canSetup && (
            <button type="button" className="btn btn-mor btn-sm shrink-0" disabled={busy || totals.bad} onClick={save}>
              {busy ? "Saving…" : "Save"}
            </button>
          )}
        </div>
        {err && <p className="text-sm text-[var(--risk-text)]">{err}</p>}
        {done && <p className="text-sm text-[#2e7d4f]">{done}</p>}
        {totals.diff !== 0 && !totals.bad && (
          <p className="text-xs text-[var(--muted)]">You can save before it agrees; until it does, the difference shows on the balance sheet under opening balances.</p>
        )}
      </div>
    </div>
  );
}
