"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import Icon from "@/components/Icon";
import { errText, Field, send, Sheet, Toggle } from "@/components/admin/AdminKit";
import { drcr } from "@/components/books/fmt";

export type ChartRowView = { key: string; name: string; balance: number; href: string | null; count?: number; headId?: string; active: boolean; note?: string | null; group: string };
export type ChartGroupView = { group: string; label: string; side: string; total: number; rows: ChartRowView[] };

type Edit = { id: string | null; name: string; group: string; note: string; active: boolean };

const SIDE: Record<string, string> = { asset: "What the business has", liability: "What it owes", capital: "Owner's money", income: "Income", expense: "Expenses" };

/** Chart of accounts by group, with the business's own heads editable in place. */
export default function ChartView({ groups, headGroups, canSetup }: { groups: ChartGroupView[]; headGroups: { group: string; label: string }[]; canSetup: boolean }) {
  const router = useRouter();
  const [edit, setEdit] = useState<Edit | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [showHidden, setShowHidden] = useState(false);

  async function save() {
    if (!edit) return;
    setBusy(true);
    setErr(null);
    try {
      const body = { name: edit.name, group: edit.group, note: edit.note, ...(edit.id ? { active: edit.active } : {}) };
      if (edit.id) await send(`/api/admin/books/heads/${edit.id}`, "PATCH", body);
      else await send("/api/admin/books/heads", "POST", body);
      setEdit(null);
      router.refresh();
    } catch (e) {
      setErr(errText(e));
    } finally {
      setBusy(false);
    }
  }

  const hiddenCount = groups.reduce((s, g) => s + g.rows.filter((r) => !r.active).length, 0);
  // Groups with something to show, each marked when it starts a new side (assets, liabilities ...).
  const visible = groups
    .map((g) => ({ ...g, rows: g.rows.filter((r) => r.active || showHidden) }))
    .filter((g) => g.rows.length)
    .map((g, i, all) => ({ ...g, sideHead: i === 0 || all[i - 1].side !== g.side ? SIDE[g.side] : null }));

  return (
    <section className="card p-4 space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="font-heading font-bold text-[var(--ink)]">Chart of accounts</h2>
          <p className="text-xs text-[var(--muted)] mt-0.5">Every account with its balance today. Dr = the business has or spent it; Cr = it owes or earned it. Open any account for its ledger.</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <a className="btn btn-outline btn-xs" href="/api/admin/books/chart?format=pdf" target="_blank" rel="noreferrer">
            <Icon name="file" className="h-3.5 w-3.5" /> Trial balance PDF
          </a>
          <a className="btn btn-outline btn-xs" href="/api/admin/books/chart?format=csv" download>
            <Icon name="download" className="h-3.5 w-3.5" /> CSV
          </a>
          {canSetup && (
            <button type="button" className="btn btn-mor btn-xs" onClick={() => { setErr(null); setEdit({ id: null, name: "", group: headGroups[0].group, note: "", active: true }); }}>
              <Icon name="plus" className="h-3.5 w-3.5" /> Add a head
            </button>
          )}
        </div>
      </div>
      {hiddenCount > 0 && (
        <button type="button" className="text-xs font-semibold text-[var(--kesar-text)]" onClick={() => setShowHidden((v) => !v)}>
          {showHidden ? "Hide" : "Show"} {hiddenCount} hidden head{hiddenCount === 1 ? "" : "s"}
        </button>
      )}
      <div className="divide-y divide-[var(--line)]">
        {visible.map((g) => {
          return (
            <div key={g.group} className="py-3">
              {g.sideHead && <p className="text-[11px] font-bold uppercase tracking-wide text-[var(--muted)] mb-2">{g.sideHead}</p>}
              <div className="flex items-baseline justify-between gap-3">
                <h3 className="font-heading font-bold text-sm text-[var(--ink)]">{g.label}</h3>
                <span className="text-sm font-bold tabular-nums text-[var(--ink)]">{drcr(g.total)}</span>
              </div>
              <ul className="mt-1.5 space-y-1">
                {g.rows.map((r) => (
                  <li key={r.key} className="flex items-center justify-between gap-3 text-sm pl-3">
                    <span className={`min-w-0 truncate ${r.active ? "text-[var(--ink-2)]" : "text-[var(--muted)] line-through"}`}>
                      {r.href ? (
                        <Link href={r.href} className="hover:text-[var(--kesar-text)]">
                          {r.name}
                        </Link>
                      ) : (
                        r.name
                      )}
                      {r.count ? <span className="text-xs text-[var(--muted)]"> · {r.count} accounts</span> : null}
                      {r.note ? <span className="ml-1.5 chip chip-mint !text-[10px]">{r.note}</span> : null}
                    </span>
                    <span className="flex shrink-0 items-center gap-2">
                      <span className="tabular-nums text-[var(--ink-2)]">{drcr(r.balance)}</span>
                      {canSetup && r.headId && (
                        <button
                          type="button"
                          aria-label={`Edit ${r.name}`}
                          className="rounded-md p-1 text-[var(--muted)] hover:bg-black/5 hover:text-[var(--ink)]"
                          onClick={() => { setErr(null); setEdit({ id: r.headId!, name: r.name, group: r.group, note: r.note ?? "", active: r.active }); }}
                        >
                          <Icon name="edit" className="h-3.5 w-3.5" />
                        </button>
                      )}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          );
        })}
      </div>

      {edit && (
        <Sheet
          title={edit.id ? `Edit ${edit.name || "head"}` : "Add a head"}
          onClose={() => setEdit(null)}
          footer={
            <div className="flex items-center justify-end gap-2">
              <button type="button" className="btn btn-quiet btn-sm" onClick={() => setEdit(null)}>
                Cancel
              </button>
              <button type="button" className="btn btn-mor btn-sm" disabled={busy || edit.name.trim().length < 2} onClick={save}>
                {busy ? "Saving…" : "Save"}
              </button>
            </div>
          }
        >
          <div className="space-y-4">
            <Field label="Name" hint="Like Godown rent, Diesel, Staff tea, Loan from Axis Bank.">
              <input className="input" value={edit.name} maxLength={60} onChange={(e) => setEdit({ ...edit, name: e.target.value })} autoFocus />
            </Field>
            <Field label="Goes under">
              <select className="input" value={edit.group} onChange={(e) => setEdit({ ...edit, group: e.target.value })}>
                {headGroups.map((g) => (
                  <option key={g.group} value={g.group}>
                    {g.label}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Note (optional)">
              <input className="input" value={edit.note} maxLength={200} onChange={(e) => setEdit({ ...edit, note: e.target.value })} />
            </Field>
            {edit.id && (
              <Toggle checked={edit.active} onChange={(v) => setEdit({ ...edit, active: v })} label="In use" hint="A hidden head keeps its entries but takes no new ones." />
            )}
            {err && <p className="text-sm text-[#a8281e]">{err}</p>}
          </div>
        </Sheet>
      )}
    </section>
  );
}
