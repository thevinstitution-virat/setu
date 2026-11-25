"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import Icon from "@/components/Icon";
import { errText, Field, readRupees, rupeeText, send, Sheet } from "@/components/admin/AdminKit";
import { drcr } from "@/components/books/fmt";

export type BankView = {
  id: string;
  name: string;
  kind: string;
  bankName: string | null;
  last4: string | null;
  ifsc: string | null;
  branch: string | null;
  odLimit: number | null;
  isDefault: boolean;
  active: boolean;
  balance: number;
  ledgerHref: string;
};

type Form = { id: string | null; name: string; kind: string; bankName: string; last4: string; ifsc: string; branch: string; odLimit: string; makeDefault: boolean };

const blank: Form = { id: null, name: "", kind: "CURRENT", bankName: "", last4: "", ifsc: "", branch: "", odLimit: "", makeDefault: false };

/** Any number of bank accounts: add, edit, pick the default, close and open again. */
export default function BanksManager({ banks, kinds, canSetup }: { banks: BankView[]; kinds: Record<string, string>; canSetup: boolean }) {
  const router = useRouter();
  const [form, setForm] = useState<Form | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [rowErr, setRowErr] = useState<{ id: string; text: string } | null>(null);

  async function run(fn: () => Promise<unknown>, rowId?: string) {
    setBusy(true);
    setErr(null);
    setRowErr(null);
    try {
      await fn();
      setForm(null);
      router.refresh();
    } catch (e) {
      if (rowId) setRowErr({ id: rowId, text: errText(e) });
      else setErr(errText(e));
    } finally {
      setBusy(false);
    }
  }

  function save() {
    if (!form) return;
    const limit = form.kind === "OD" || form.kind === "CC" ? readRupees(form.odLimit) : null;
    if (limit === "bad") return setErr("Write the limit in rupees");
    const body = { name: form.name, kind: form.kind, bankName: form.bankName, last4: form.last4, ifsc: form.ifsc, branch: form.branch, odLimit: limit };
    run(() => (form.id ? send(`/api/admin/books/banks/${form.id}`, "PATCH", body) : send("/api/admin/books/banks", "POST", { ...body, makeDefault: form.makeDefault })));
  }

  const total = banks.filter((b) => b.active).reduce((s, b) => s + b.balance, 0);

  return (
    <section className="card p-4 space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="font-heading font-bold text-[var(--ink)]">Bank accounts</h2>
          <p className="text-xs text-[var(--muted)] mt-0.5">In the books: {drcr(total)}. Money with no bank picked (cleared cheques, bank transfers, statement matches) goes to the default one.</p>
        </div>
        {canSetup && (
          <button type="button" className="btn btn-mor btn-xs" onClick={() => { setErr(null); setForm({ ...blank }); }}>
            <Icon name="plus" className="h-3.5 w-3.5" /> Add a bank account
          </button>
        )}
      </div>
      <ul className="grid gap-3 md:grid-cols-2">
        {banks.map((b) => (
          <li key={b.id} className={`rounded-xl border p-3 space-y-2 ${b.active ? "border-[var(--line)] bg-white/60" : "border-dashed border-[var(--line)] opacity-70"}`}>
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <p className="font-heading font-bold text-[var(--ink)] truncate">
                  {b.name} {b.isDefault && <span className="chip chip-mint !text-[10px] align-middle">Default</span>} {!b.active && <span className="chip !text-[10px] align-middle">Closed</span>}
                </p>
                <p className="text-xs text-[var(--muted)]">
                  {[kinds[b.kind], b.bankName, b.last4 ? `ending ${b.last4}` : null, b.ifsc, b.branch].filter(Boolean).join(" · ")}
                  {b.odLimit ? ` · limit ${drcr(b.odLimit).replace(" Dr", "")}` : ""}
                </p>
              </div>
              <Link href={b.ledgerHref} className="shrink-0 text-right">
                <span className="block text-sm font-bold tabular-nums text-[var(--ink)]">{drcr(b.balance)}</span>
                <span className="text-[11px] text-[var(--accent-text)]">Ledger</span>
              </Link>
            </div>
            {canSetup && (
              <div className="flex flex-wrap gap-1.5">
                <button
                  type="button"
                  className="btn btn-quiet btn-xs"
                  disabled={busy}
                  onClick={() => { setErr(null); setForm({ id: b.id, name: b.name, kind: b.kind, bankName: b.bankName ?? "", last4: b.last4 ?? "", ifsc: b.ifsc ?? "", branch: b.branch ?? "", odLimit: rupeeText(b.odLimit), makeDefault: false }); }}
                >
                  <Icon name="edit" className="h-3.5 w-3.5" /> Edit
                </button>
                {b.active && !b.isDefault && (
                  <button type="button" className="btn btn-quiet btn-xs" disabled={busy} onClick={() => run(() => send(`/api/admin/books/banks/${b.id}`, "PATCH", { makeDefault: true }), b.id)}>
                    Make default
                  </button>
                )}
                {!b.isDefault && (
                  <button type="button" className="btn btn-quiet btn-xs" disabled={busy} onClick={() => run(() => send(`/api/admin/books/banks/${b.id}`, "PATCH", { active: !b.active }), b.id)}>
                    {b.active ? "Close" : "Open again"}
                  </button>
                )}
              </div>
            )}
            {rowErr?.id === b.id && <p className="text-xs text-[var(--risk-text)]">{rowErr.text}</p>}
          </li>
        ))}
      </ul>

      {form && (
        <Sheet
          title={form.id ? `Edit ${form.name || "bank account"}` : "Add a bank account"}
          onClose={() => setForm(null)}
          footer={
            <div className="flex items-center justify-end gap-2">
              <button type="button" className="btn btn-quiet btn-sm" onClick={() => setForm(null)}>
                Cancel
              </button>
              <button type="button" className="btn btn-mor btn-sm" disabled={busy || form.name.trim().length < 2} onClick={save}>
                {busy ? "Saving…" : "Save"}
              </button>
            </div>
          }
        >
          <div className="space-y-4">
            <Field label="Name in the books" hint="Like HDFC current, SBI CC, Axis savings.">
              <input className="input" value={form.name} maxLength={60} onChange={(e) => setForm({ ...form, name: e.target.value })} autoFocus />
            </Field>
            <Field label="Kind">
              <select className="input" value={form.kind} onChange={(e) => setForm({ ...form, kind: e.target.value })}>
                {Object.entries(kinds).map(([k, label]) => (
                  <option key={k} value={k}>
                    {label}
                  </option>
                ))}
              </select>
            </Field>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Bank">
                <input className="input" value={form.bankName} maxLength={80} onChange={(e) => setForm({ ...form, bankName: e.target.value })} />
              </Field>
              <Field label="Branch">
                <input className="input" value={form.branch} maxLength={80} onChange={(e) => setForm({ ...form, branch: e.target.value })} />
              </Field>
              <Field label="Account number: last 4 digits">
                <input className="input" inputMode="numeric" value={form.last4} maxLength={4} onChange={(e) => setForm({ ...form, last4: e.target.value.replace(/\D/g, "") })} />
              </Field>
              <Field label="IFSC">
                <input className="input uppercase" value={form.ifsc} maxLength={11} onChange={(e) => setForm({ ...form, ifsc: e.target.value.toUpperCase() })} />
              </Field>
            </div>
            {(form.kind === "OD" || form.kind === "CC") && (
              <Field label="Sanctioned limit (₹)">
                <input className="input" inputMode="decimal" value={form.odLimit} onChange={(e) => setForm({ ...form, odLimit: e.target.value })} />
              </Field>
            )}
            {!form.id && (
              <label className="flex items-center gap-2 text-sm text-[var(--ink-2)]">
                <input type="checkbox" checked={form.makeDefault} onChange={(e) => setForm({ ...form, makeDefault: e.target.checked })} /> Make this the default bank
              </label>
            )}
            {err && <p className="text-sm text-[var(--risk-text)]">{err}</p>}
          </div>
        </Sheet>
      )}
    </section>
  );
}
