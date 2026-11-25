"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import Icon from "@/components/Icon";
import { formatINR } from "@/lib/money";
import { showDay } from "@/components/books/fmt";

type Check = { key: string; ok: boolean; text: string };
type Target = { kind: "ACCOUNT"; code: string; name: string } | { kind: "NEW"; group: string } | { kind: "DEBTORS" | "CREDITORS" | "STOCK" | "SKIP" } | { kind: "UNMATCHED"; why: string };
type TbResult = {
  rows: { row: number; name: string; amount: number; target: Target }[];
  accounts: { code: string; name: string; old: number; here: number }[];
  debit: number;
  credit: number;
  checks: Check[];
  ready: boolean;
  agrees: boolean;
  errors: { row: number; message: string }[];
  startOn: string | null;
};
type Line = { name: string; here: number | null; old: number | null; diff: number };
type Part = { key: string; title: string; lines: Line[]; here: number; old: number; sent: boolean };
type Parallel = { day: string; parts: Part[]; errors: { row: number; message: string }[]; agrees: boolean };

const signed = (p: number) => (p < 0 ? `−${formatINR(-p)}` : formatINR(p));
const TARGET: Record<string, string> = { DEBTORS: "Shops' open bills", CREDITORS: "Suppliers' open bills", STOCK: "Opening stock", SKIP: "Left out" };

async function upload<T>(fields: Record<string, string | File>): Promise<T> {
  const fd = new FormData();
  for (const [k, v] of Object.entries(fields)) fd.append(k, v);
  const res = await fetch("/api/admin/books/switch", { method: "POST", body: fd });
  const j = await res.json().catch(() => ({ error: "Something went wrong" }));
  if (!res.ok && !(j && Array.isArray(j.errors) && j.errors.length)) throw new Error(j.error ?? "Something went wrong");
  return j as T;
}

function Errors({ list }: { list: { row: number; message: string }[] }) {
  if (!list.length) return null;
  return (
    <div className="rounded-lg bg-[#fdecea] px-3 py-2 text-sm text-[#a8281e] space-y-0.5">
      <p className="font-semibold">Fix these rows in the sheet:</p>
      {list.slice(0, 30).map((e) => (
        <p key={`${e.row}${e.message}`}>
          Row {e.row}: {e.message}
        </p>
      ))}
      {list.length > 30 && <p>… and {list.length - 30} more.</p>}
    </div>
  );
}

/** A10.2: the old software's trial balance, matched to our accounts, checked, and used as the opening balances. */
export function OldTrialBalance({ startOn, canSetup }: { startOn: string | null; canSetup: boolean }) {
  const router = useRouter();
  const [file, setFile] = useState<File | null>(null);
  const [day, setDay] = useState(startOn ?? "");
  const [r, setR] = useState<TbResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);

  async function check(f = file) {
    if (!f) return setErr("Choose the sheet first");
    setErr(null);
    setDone(null);
    setBusy(true);
    try {
      const x = await upload<TbResult>({ file: f, what: "tb", mode: "check" });
      setR(x);
      if (!day && x.startOn) setDay(x.startOn);
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function apply() {
    if (!file || !r) return;
    if (!day) return setErr("Pick the day the books start here");
    setErr(null);
    setBusy(true);
    try {
      const x = await upload<{ errors: { row: number; message: string }[]; opening: { difference: number } | null }>({ file, what: "tb", mode: "apply", startOn: day });
      if (!x.opening) return setErr("The sheet has rows to fix first");
      setDone(x.opening.difference === 0 ? "Saved as the opening balances, and they agree." : `Saved as the opening balances. They are out by ${formatINR(Math.abs(x.opening.difference))} until the open bills and stock match.`);
      router.refresh();
      await check(file);
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  const changed = r ? r.accounts.filter((a) => a.old !== a.here) : [];
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-end gap-2">
        <label className="text-xs text-[var(--muted)] min-w-0 flex-1 basis-56">
          The old trial balance (CSV or Excel)
          <input
            type="file"
            accept=".csv,.xlsx"
            className="input !py-1.5 mt-1 block w-full"
            onChange={(e) => {
              const f = e.target.files?.[0] ?? null;
              setFile(f);
              setR(null);
              if (f) void check(f);
            }}
          />
        </label>
        <a className="btn btn-quiet btn-sm" href="/api/admin/books/switch?template=tb">
          Sheet to fill in
        </a>
      </div>
      <p className="text-xs text-[var(--muted)]">
        Columns: account, debit, credit, and when a name doesn&apos;t match ours, maps_to (our account&apos;s name, or debtors, creditors, stock or skip) or group (like Capital or Fixed
        assets) to add it as a new head. As on the day before the switch.
      </p>
      {busy && <p className="text-sm text-[var(--muted)]">Checking…</p>}
      {err && <p className="rounded-lg bg-[#fdecea] px-3 py-2 text-sm text-[#a8281e]">{err}</p>}
      {done && <p className="rounded-lg bg-[#e3f4ec] px-3 py-2 text-sm text-[#1d6b47]">{done}</p>}
      {r && (
        <div className="space-y-3">
          <Errors list={r.errors} />
          <ul className="space-y-1.5">
            {r.checks.map((c) => (
              <li key={c.key} className="flex gap-2 text-sm">
                <Icon name={c.ok ? "check" : "alert"} className={`h-4 w-4 shrink-0 mt-0.5 ${c.ok ? "text-[#1d6b47]" : "text-[#b26a00]"}`} />
                <span>{c.text}</span>
              </li>
            ))}
          </ul>
          <details className="rounded-xl border border-[var(--line)]">
            <summary className="cursor-pointer px-3 py-2 text-sm font-semibold">
              {r.rows.length} lines and where they go{changed.length ? ` · ${changed.length} differ from what is entered now` : ""}
            </summary>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[26rem] text-sm tabular-nums">
                <tbody className="divide-y divide-[var(--line)]">
                  {r.rows.map((x) => (
                    <tr key={x.row}>
                      <td className="px-3 py-1.5">
                        {x.name}
                        <span className={`block text-xs ${x.target.kind === "UNMATCHED" ? "text-[#a8281e]" : "text-[var(--muted)]"}`}>
                          {x.target.kind === "ACCOUNT"
                            ? `→ ${x.target.name}`
                            : x.target.kind === "NEW"
                              ? "→ a new head"
                              : x.target.kind === "UNMATCHED"
                                ? x.target.why
                                : `→ ${TARGET[x.target.kind]}`}
                        </span>
                      </td>
                      <td className="px-3 py-1.5 text-right whitespace-nowrap">{x.amount >= 0 ? `${formatINR(x.amount)} Dr` : `${formatINR(-x.amount)} Cr`}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </details>
          {canSetup && (
            <div className="flex flex-wrap items-end gap-2">
              <label className="text-xs text-[var(--muted)]">
                Books start here on
                <input type="date" className="input !py-1.5 mt-1 block" value={day} onChange={(e) => setDay(e.target.value)} />
              </label>
              <button type="button" className="btn btn-mor btn-sm" disabled={busy || !r.ready || !!r.errors.length} onClick={apply}>
                <Icon name="check" className="h-4 w-4" /> Use as the opening balances
              </button>
            </div>
          )}
          {canSetup && (
            <p className="text-xs text-[var(--muted)]">
              This replaces the opening balances entered so far (heads, banks, cash, taxes, and the stock when the sheet has it). Shops&apos; and suppliers&apos; balances come from their open
              bills, not from the sheet.
            </p>
          )}
        </div>
      )}
    </div>
  );
}

/** A10.3: our figures on a day against the old software's. */
export function ParallelRun({ today }: { today: string }) {
  const [file, setFile] = useState<File | null>(null);
  const [day, setDay] = useState(today);
  const [r, setR] = useState<Parallel | null>(null);
  const [all, setAll] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function run() {
    if (!file) return setErr("Choose the sheet with the old software's figures");
    setErr(null);
    setBusy(true);
    try {
      const x = await upload<Parallel & { error?: string }>({ file, what: "parallel", day });
      if (x.error) throw new Error(x.error);
      setR(x);
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  function csv() {
    if (!r) return;
    const q = (v: string) => (/[",\r\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);
    const lines = [["Report", "Name", "Here", "Old software", "Difference"].join(",")];
    for (const p of r.parts) for (const l of p.lines) lines.push([p.title, l.name, l.here === null ? "" : (l.here / 100).toFixed(2), l.old === null ? "" : (l.old / 100).toFixed(2), (l.diff / 100).toFixed(2)].map((x) => q(String(x))).join(","));
    const url = URL.createObjectURL(new Blob(["﻿" + lines.join("\r\n")], { type: "text/csv" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = `parallel-run-${r.day}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-end gap-2">
        <label className="text-xs text-[var(--muted)]">
          Figures as on
          <input type="date" className="input !py-1.5 mt-1 block" value={day} max={today} onChange={(e) => setDay(e.target.value)} />
        </label>
        <label className="text-xs text-[var(--muted)] min-w-0 flex-1 basis-56">
          The old software&apos;s figures (CSV or Excel)
          <input type="file" accept=".csv,.xlsx" className="input !py-1.5 mt-1 block w-full" onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
        </label>
        <button type="button" className="btn btn-mor btn-sm" disabled={busy || !file} onClick={run}>
          Compare
        </button>
        <a className="btn btn-quiet btn-sm" href="/api/admin/books/switch?template=parallel">
          Sheet to fill in
        </a>
      </div>
      <p className="text-xs text-[var(--muted)]">
        Columns: report (trial balance, debtors, creditors or stock), name, and debit / credit or amount. Put in only the reports you want to compare. Names are matched as written, so use the
        same shop, supplier and product names.
      </p>
      {busy && <p className="text-sm text-[var(--muted)]">Comparing…</p>}
      {err && <p className="rounded-lg bg-[#fdecea] px-3 py-2 text-sm text-[#a8281e]">{err}</p>}
      {r && (
        <div className="space-y-3">
          <Errors list={r.errors} />
          <p className={`rounded-lg px-3 py-2 text-sm ${r.agrees ? "bg-[#e3f4ec] text-[#1d6b47]" : "bg-[#fff4e0] text-[#7a4b00]"}`}>
            {r.agrees ? `Everything sent agrees on ${showDay(r.day)}.` : `Some figures differ on ${showDay(r.day)}: the lines that differ are first.`}
          </p>
          <div className="flex flex-wrap gap-2">
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" className="h-4 w-4" checked={all} onChange={(e) => setAll(e.target.checked)} /> Show lines that agree too
            </label>
            <button type="button" className="btn btn-quiet btn-sm ml-auto" onClick={csv}>
              CSV
            </button>
          </div>
          {r.parts
            .filter((p) => p.sent)
            .map((p) => {
              const off = p.lines.filter((l) => l.diff !== 0);
              const show = all ? p.lines : off;
              return (
                <section key={p.key} className="rounded-xl border border-[var(--line)] overflow-hidden">
                  <h4 className="px-3 py-2 text-sm font-semibold flex flex-wrap justify-between gap-2">
                    <span>{p.title}</span>
                    <span className={off.length ? "text-[#b26a00]" : "text-[#1d6b47]"}>{off.length ? `${off.length} differ` : "All agree"}</span>
                  </h4>
                  <div className="overflow-x-auto">
                    <table className="w-full min-w-[28rem] text-sm tabular-nums">
                      <thead className="text-xs text-[var(--muted)]">
                        <tr className="border-t border-[var(--line)]">
                          <th className="text-left font-medium px-3 py-1.5">Name</th>
                          <th className="text-right font-medium px-2 py-1.5">Here</th>
                          <th className="text-right font-medium px-2 py-1.5">Old</th>
                          <th className="text-right font-medium px-3 py-1.5">Difference</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-[var(--line)]">
                        {show.slice(0, 200).map((l) => (
                          <tr key={l.name}>
                            <td className="px-3 py-1.5">{l.name}</td>
                            <td className="px-2 py-1.5 text-right whitespace-nowrap">{l.here === null ? "Not here" : signed(l.here)}</td>
                            <td className="px-2 py-1.5 text-right whitespace-nowrap">{l.old === null ? "Not in sheet" : signed(l.old)}</td>
                            <td className={`px-3 py-1.5 text-right whitespace-nowrap ${l.diff ? "text-[#a8281e] font-semibold" : ""}`}>{l.diff ? signed(l.diff) : "–"}</td>
                          </tr>
                        ))}
                        <tr className="font-semibold">
                          <td className="px-3 py-1.5">Total</td>
                          <td className="px-2 py-1.5 text-right whitespace-nowrap">{signed(p.here)}</td>
                          <td className="px-2 py-1.5 text-right whitespace-nowrap">{signed(p.old)}</td>
                          <td className="px-3 py-1.5 text-right whitespace-nowrap">{p.here - p.old ? signed(p.here - p.old) : "–"}</td>
                        </tr>
                      </tbody>
                    </table>
                  </div>
                  {show.length > 200 && <p className="px-3 py-2 text-xs text-[var(--muted)]">First 200 of {show.length}; all are in the CSV.</p>}
                </section>
              );
            })}
        </div>
      )}
    </div>
  );
}
