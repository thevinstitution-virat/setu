"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import Icon from "@/components/Icon";
import { errText, Field, send, Sheet } from "@/components/admin/AdminKit";
import { SUPPLIER_KINDS } from "@/lib/purchase-math";
import { STATES } from "@/lib/gst";

export type SupplierFields = {
  id: string | null;
  name: string;
  kind: string;
  gstin: string;
  stateCode: string;
  pan: string;
  contactName: string;
  phone: string;
  email: string;
  address: string;
  creditDays: string;
  bankName: string;
  bankIfsc: string;
  bankAccountNo: string;
  tdsSection: string;
  active: boolean;
};

export const blankSupplier: SupplierFields = { id: null, name: "", kind: "GOODS", gstin: "", stateCode: "", pan: "", contactName: "", phone: "", email: "", address: "", creditDays: "30", bankName: "", bankIfsc: "", bankAccountNo: "", tdsSection: "", active: true };

/** Add or edit a supplier: any kind (companies, services, others), tax and bank details for paying them. */
export default function SupplierEditor({ initial, buttonLabel, buttonClass = "btn btn-mor btn-xs" }: { initial: SupplierFields; buttonLabel: string; buttonClass?: string }) {
  const router = useRouter();
  const [form, setForm] = useState<SupplierFields | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const set = (p: Partial<SupplierFields>) => setForm((f) => (f ? { ...f, ...p } : f));

  async function save() {
    if (!form) return;
    setBusy(true);
    setErr(null);
    const body = {
      name: form.name,
      kind: form.kind,
      gstin: form.gstin,
      stateCode: form.stateCode,
      pan: form.pan,
      contactName: form.contactName,
      phone: form.phone,
      email: form.email,
      address: form.address,
      creditDays: Number(form.creditDays || 0),
      bankName: form.bankName,
      bankIfsc: form.bankIfsc,
      bankAccountNo: form.bankAccountNo,
      tdsSection: form.tdsSection,
      ...(form.id ? { active: form.active } : {}),
    };
    try {
      const r = await send<{ supplier: { id: string } }>(form.id ? `/api/admin/books/suppliers/${form.id}` : "/api/admin/books/suppliers", form.id ? "PATCH" : "POST", body);
      setForm(null);
      if (!form.id) router.push(`/admin/books/suppliers/${r.supplier.id}`);
      router.refresh();
    } catch (e) {
      setErr(errText(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <button type="button" className={buttonClass} onClick={() => { setErr(null); setForm({ ...initial }); }}>
        {initial.id ? <Icon name="edit" className="h-3.5 w-3.5" /> : <Icon name="plus" className="h-3.5 w-3.5" />} {buttonLabel}
      </button>
      {form && (
        <Sheet
          title={form.id ? `Edit ${initial.name}` : "Add a supplier"}
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
            <Field label="Name">
              <input className="input" value={form.name} maxLength={100} onChange={(e) => set({ name: e.target.value })} autoFocus />
            </Field>
            <Field label="What they supply" hint="Companies show in stock, products and company-wise reports; services suppliers only in the books.">
              <select className="input" value={form.kind} onChange={(e) => set({ kind: e.target.value })}>
                {Object.entries(SUPPLIER_KINDS).map(([k, label]) => (
                  <option key={k} value={k}>
                    {label}
                  </option>
                ))}
              </select>
            </Field>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="GSTIN" hint="Fills the state and PAN.">
                <input className="input uppercase" value={form.gstin} maxLength={15} onChange={(e) => set({ gstin: e.target.value.toUpperCase() })} />
              </Field>
              <Field label="State">
                <select className="input" value={form.stateCode} onChange={(e) => set({ stateCode: e.target.value })}>
                  <option value="">{form.gstin.length >= 2 ? "From the GSTIN" : "Pick the state"}</option>
                  {Object.entries(STATES).map(([c, n]) => (
                    <option key={c} value={c}>
                      {c}-{n}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="PAN">
                <input className="input uppercase" value={form.pan} maxLength={10} placeholder={form.gstin.length === 15 ? form.gstin.slice(2, 12) : ""} onChange={(e) => set({ pan: e.target.value.toUpperCase() })} />
              </Field>
              <Field label="Credit days" hint="Bills fall due this many days after their date.">
                <input className="input" inputMode="numeric" value={form.creditDays} onChange={(e) => set({ creditDays: e.target.value.replace(/\D/g, "") })} />
              </Field>
              <Field label="Contact person">
                <input className="input" value={form.contactName} maxLength={80} onChange={(e) => set({ contactName: e.target.value })} />
              </Field>
              <Field label="Phone">
                <input className="input" inputMode="tel" value={form.phone} maxLength={14} onChange={(e) => set({ phone: e.target.value })} />
              </Field>
            </div>
            <Field label="Email">
              <input className="input" type="email" value={form.email} maxLength={120} onChange={(e) => set({ email: e.target.value })} />
            </Field>
            <Field label="Address">
              <textarea className="input" rows={2} value={form.address} maxLength={300} onChange={(e) => set({ address: e.target.value })} />
            </Field>
            <p className="text-xs font-semibold text-[var(--muted)] uppercase tracking-wide">For paying them</p>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Bank">
                <input className="input" value={form.bankName} maxLength={80} onChange={(e) => set({ bankName: e.target.value })} />
              </Field>
              <Field label="IFSC">
                <input className="input uppercase" value={form.bankIfsc} maxLength={11} onChange={(e) => set({ bankIfsc: e.target.value.toUpperCase() })} />
              </Field>
              <Field label="Account number">
                <input className="input" inputMode="numeric" value={form.bankAccountNo} maxLength={18} onChange={(e) => set({ bankAccountNo: e.target.value.replace(/\D/g, "") })} />
              </Field>
              <Field label="TDS section" hint="Like 194C (contractors) or 194J (professionals). Blank if none.">
                <input className="input uppercase" value={form.tdsSection} maxLength={12} onChange={(e) => set({ tdsSection: e.target.value.toUpperCase() })} />
              </Field>
            </div>
            {form.id && (
              <label className="flex items-center gap-2 text-sm text-[var(--ink-2)]">
                <input type="checkbox" checked={form.active} onChange={(e) => set({ active: e.target.checked })} /> In use (untick to hide from lists)
              </label>
            )}
            {err && <p className="text-sm text-[#a8281e]">{err}</p>}
          </div>
        </Sheet>
      )}
    </>
  );
}
