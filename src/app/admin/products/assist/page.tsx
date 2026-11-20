"use client";

import { useState } from "react";
import Link from "next/link";
import Icon from "@/components/Icon";
import { ErrorBox, errText, send, useFetch } from "@/components/admin/AdminKit";

type Edit = { nameHi?: string; hsnCode?: string; gstRate?: number };
type Item = {
  id: string;
  title: string;
  detail: string;
  reasons: string[];
  payload: { field: "nameHi" | "hsn"; productId: string; category: string; current: { nameHi?: string | null; hsnCode?: string | null; gstRate?: number }; proposed: Edit; source: "ai" | "rules"; confidence: string };
};
type Data = { items: Item[]; missing: { nameHi: number; hsn: number }; ai: { available: boolean; message?: string; used: number; cap: number | null } };
type RunResult = { looked: number; made: number; credits: number; source: "ai" | "rules" | "mixed"; note: string | null };

const GST = [0, 0.25, 3, 5, 12, 18, 28, 40];

/** A13: Hindi names and HSN codes proposed by AI or the rules; check, edit, apply. */
export default function CatalogueAssistPage() {
  const { data, error, reload } = useFetch<Data>("/api/admin/catalogue-assist");
  const [busy, setBusy] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [edits, setEdits] = useState<Record<string, Edit>>({});
  const [skip, setSkip] = useState<Set<string>>(new Set());

  async function run(field: "nameHi" | "hsn") {
    setBusy(field);
    setNote(null);
    try {
      const r = await send<RunResult>("/api/admin/catalogue-assist", "POST", { field });
      setNote(
        r.looked === 0
          ? "Nothing to do: every product already has one, or a suggestion is waiting below."
          : `${r.made} suggestion${r.made === 1 ? "" : "s"} for ${r.looked} product${r.looked === 1 ? "" : "s"}${r.credits ? `, ${r.credits} AI credit${r.credits === 1 ? "" : "s"}` : ""}.${r.note && r.source === "mixed" ? ` ${r.note}` : ""}`
      );
      reload();
    } catch (e) {
      setNote(errText(e));
    } finally {
      setBusy(null);
    }
  }

  async function decide(items: Item[], accept: boolean) {
    if (!items.length) return;
    setBusy(accept ? "accept" : "reject");
    setNote(null);
    try {
      const r = await send<{ accepted: number; rejected: number }>("/api/admin/catalogue-assist/decide", "POST", {
        decisions: items.map((i) => ({ id: i.id, accept, edit: accept ? edits[i.id] : undefined })),
      });
      setNote(accept ? `${r.accepted} product${r.accepted === 1 ? "" : "s"} updated.` : `${r.rejected} dismissed.`);
      // Rows not decided keep their tick and edits.
      const done = new Set(items.map((i) => i.id));
      setEdits((x) => Object.fromEntries(Object.entries(x).filter(([id]) => !done.has(id))));
      setSkip((s) => new Set([...s].filter((id) => !done.has(id))));
      reload();
    } catch (e) {
      setNote(errText(e));
    } finally {
      setBusy(null);
    }
  }

  const items = data?.items ?? [];
  const groups: { field: "nameHi" | "hsn"; title: string; list: Item[] }[] = [
    { field: "hsn", title: "HSN codes and GST", list: items.filter((i) => i.payload.field === "hsn") },
    { field: "nameHi", title: "Hindi names", list: items.filter((i) => i.payload.field === "nameHi") },
  ];

  return (
    <div className="space-y-5">
      <div className="page-head">
        <div className="min-w-0">
          <Link href="/admin/products" className="text-xs font-bold text-[var(--kesar-text)]">
            ← Products
          </Link>
          <h1 className="page-title">Catalogue assist</h1>
          <p className="page-sub">Hindi names and HSN codes for products that lack them. Nothing changes until you apply it; you can edit each one first.</p>
        </div>
      </div>

      {error && <ErrorBox message={error} onRetry={reload} />}
      {!data && !error && <p className="text-sm text-[var(--muted)]">Loading…</p>}

      {data && (
        <>
          <p className={`rounded-xl px-3 py-2 text-sm ${data.ai.available ? "bg-[var(--mint-tint)]" : "bg-ink/5"}`} role="status">
            {data.ai.available
              ? `AI is on: about one credit per 25 products${data.ai.cap !== null ? ` (${data.ai.used} of ${data.ai.cap} used this month)` : ""}. Check brand spellings and tax codes before applying.`
              : data.ai.message}
          </p>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div className="card flex items-center justify-between gap-3 p-4">
              <div className="min-w-0">
                <p className="font-heading font-bold">Hindi names</p>
                <p className="text-xs text-[var(--muted)]">{data.missing.nameHi} active product{data.missing.nameHi === 1 ? "" : "s"} without one</p>
              </div>
              <button type="button" className="btn btn-primary btn-sm shrink-0" disabled={!!busy || !data.missing.nameHi} onClick={() => run("nameHi")}>
                {busy === "nameHi" ? "Working…" : "Suggest"}
              </button>
            </div>
            <div className="card flex items-center justify-between gap-3 p-4">
              <div className="min-w-0">
                <p className="font-heading font-bold">HSN codes</p>
                <p className="text-xs text-[var(--muted)]">{data.missing.hsn} active product{data.missing.hsn === 1 ? "" : "s"} without one</p>
              </div>
              <button type="button" className="btn btn-primary btn-sm shrink-0" disabled={!!busy || !data.missing.hsn} onClick={() => run("hsn")}>
                {busy === "hsn" ? "Working…" : "Suggest"}
              </button>
            </div>
          </div>
          <p className="text-xs text-[var(--muted)]">
            Tidying an Excel sheet before import is on{" "}
            <Link href="/admin/import" className="font-bold text-[var(--kesar-text)]">
              Import
            </Link>{" "}
            (Products → “Tidy the sheet first”).
          </p>
          {note && (
            <p className="text-sm text-[var(--muted)]" role="status">
              {note}
            </p>
          )}

          {groups.map(
            (g) =>
              g.list.length > 0 && (
                <section key={g.field} className="card overflow-hidden">
                  <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[var(--line)] px-4 py-3">
                    <h2 className="font-heading font-bold">
                      {g.title} · {g.list.length}
                    </h2>
                    <div className="flex flex-wrap gap-2">
                      <button type="button" className="btn btn-primary btn-sm" disabled={!!busy} onClick={() => decide(g.list.filter((i) => !skip.has(i.id)), true)}>
                        Apply {g.list.filter((i) => !skip.has(i.id)).length} ticked
                      </button>
                      <button type="button" className="btn btn-outline btn-sm" disabled={!!busy || !g.list.some((i) => skip.has(i.id))} onClick={() => decide(g.list.filter((i) => skip.has(i.id)), false)}>
                        Dismiss unticked
                      </button>
                    </div>
                  </div>
                  <ul className="divide-y divide-[var(--line)]">
                    {g.list.map((i) => (
                      <Row
                        key={i.id}
                        i={i}
                        on={!skip.has(i.id)}
                        edit={edits[i.id]}
                        onToggle={(on) =>
                          setSkip((s) => {
                            const n = new Set(s);
                            if (on) n.delete(i.id);
                            else n.add(i.id);
                            return n;
                          })
                        }
                        onEdit={(e) => setEdits((x) => ({ ...x, [i.id]: { ...x[i.id], ...e } }))}
                      />
                    ))}
                  </ul>
                </section>
              )
          )}
          {items.length === 0 && <p className="card p-4 text-sm text-[var(--muted)]">No suggestions waiting. Press Suggest above.</p>}
        </>
      )}
    </div>
  );
}

function Row({ i, on, edit, onToggle, onEdit }: { i: Item; on: boolean; edit?: Edit; onToggle: (on: boolean) => void; onEdit: (e: Edit) => void }) {
  const p = i.payload;
  const v = { ...p.proposed, ...edit };
  return (
    <li className="flex items-start gap-3 px-4 py-3">
      <input type="checkbox" className="mt-1 h-5 w-5 shrink-0 accent-[var(--kesar)]" checked={on} onChange={(e) => onToggle(e.target.checked)} aria-label={`Apply to ${i.title}`} />
      <div className="min-w-0 flex-1 space-y-1.5">
        <div className="flex flex-wrap items-baseline justify-between gap-x-3">
          <p className="text-sm font-semibold break-words">{i.title}</p>
          <span className="text-[11px] text-[var(--muted)]">
            {p.category} · {p.source === "ai" ? "AI" : "rules"} · {p.confidence}
          </span>
        </div>
        {p.field === "nameHi" ? (
          <input className="input !py-1.5" lang="hi" value={v.nameHi ?? ""} maxLength={120} onChange={(e) => onEdit({ nameHi: e.target.value })} aria-label={`Hindi name for ${i.title}`} />
        ) : (
          <div className="flex flex-wrap items-center gap-2">
            <input
              className="input !w-32 !py-1.5 tabular-nums"
              inputMode="numeric"
              value={v.hsnCode ?? ""}
              maxLength={8}
              onChange={(e) => onEdit({ hsnCode: e.target.value.replace(/\D/g, "") })}
              aria-label={`HSN code for ${i.title}`}
            />
            <select className="input !w-auto !py-1.5" value={String(v.gstRate ?? 0)} onChange={(e) => onEdit({ gstRate: Number(e.target.value) })} aria-label={`GST for ${i.title}`}>
              {GST.map((r) => (
                <option key={r} value={r}>
                  {r}% GST
                </option>
              ))}
            </select>
            {p.current.gstRate !== undefined && p.current.gstRate !== v.gstRate && <span className="text-xs text-[var(--muted)]">now {p.current.gstRate}%</span>}
          </div>
        )}
        {i.detail && (
          <p className="text-xs text-[var(--muted)]">
            <Icon name="alert" className="mr-1 inline h-3 w-3" />
            {i.detail}
          </p>
        )}
      </div>
    </li>
  );
}
