"use client";

import { useState } from "react";
import Link from "next/link";
import Icon from "@/components/Icon";
import StockNav from "@/components/stock/StockNav";
import { ActiveChip, ErrorBox, Field, Flash, Sheet, Toggle, errText, send, useFetch } from "@/components/admin/AdminKit";

type Supplier = {
  id: string;
  name: string;
  contactName: string | null;
  phone: string | null;
  email: string | null;
  gstin: string | null;
  address: string | null;
  active: boolean;
  _count: { products: number; purchaseOrders: number };
};

const plural = (n: number, w: string, many = `${w}s`) => `${n} ${n === 1 ? w : many}`;

export default function SuppliersPage() {
  const { data, error, reload } = useFetch<{ suppliers: Supplier[] }>("/api/suppliers");
  const [editing, setEditing] = useState<Supplier | "new" | null>(null);
  const [q, setQ] = useState("");
  const [flash, setFlash] = useState<string | null>(null);

  const all = data?.suppliers ?? [];
  const query = q.trim().toLowerCase();
  const list = query
    ? all.filter((s) => `${s.name} ${s.contactName ?? ""} ${s.phone ?? ""} ${s.gstin ?? ""}`.toLowerCase().includes(query))
    : all;
  const active = list.filter((s) => s.active);
  const off = list.filter((s) => !s.active);

  function saved(msg: string) {
    setEditing(null);
    setFlash(msg);
    setTimeout(() => setFlash(null), 5000);
    reload();
  }

  return (
    <div className="space-y-5 pb-28">
      <div className="space-y-3">
        <div className="page-head">
          <div className="min-w-0">
            <p className="page-kick">Stock</p>
            <h1 className="page-title">Suppliers</h1>
            <p className="page-sub">The companies you buy from.</p>
          </div>
          <button type="button" className="btn btn-kesar btn-sm !min-h-[44px]" onClick={() => setEditing("new")}>
            <Icon name="plus" className="h-4 w-4" /> Add supplier
          </button>
        </div>
        <StockNav />
      </div>

      {error && <ErrorBox message={error} onRetry={reload} />}
      {!data && !error && <p className="text-sm text-[var(--muted)]">Loading…</p>}
      <Flash text={flash} />

      {data && all.length === 0 && (
        <div className="card p-6 text-center space-y-2">
          <p className="text-sm font-semibold">No suppliers yet</p>
          <p className="text-sm text-[var(--muted)]">Add the companies you buy from, then set the usual supplier on each product.</p>
          <button type="button" className="btn btn-kesar btn-sm" onClick={() => setEditing("new")}>
            <Icon name="plus" className="h-4 w-4" /> Add supplier
          </button>
        </div>
      )}

      {data && all.length > 0 && (
        <>
          {all.length > 6 && (
            <div className="relative sm:max-w-sm">
              <Icon name="search" className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-[var(--muted)]" />
              <input className="input !pl-9" type="search" placeholder="Search suppliers" value={q} onChange={(e) => setQ(e.target.value)} />
            </div>
          )}
          {list.length === 0 && <p className="card p-6 text-center text-sm text-[var(--muted)]">No supplier matches &ldquo;{q}&rdquo;.</p>}
          {active.length > 0 && (
            <div className="grid gap-3 sm:grid-cols-2">
              {active.map((s) => (
                <SupplierCard key={s.id} s={s} onEdit={() => setEditing(s)} />
              ))}
            </div>
          )}
          {off.length > 0 && (
            <section className="space-y-2">
              <p className="text-xs font-extrabold uppercase tracking-[0.1em] text-[var(--ink-2)]">Turned off</p>
              <div className="grid gap-3 sm:grid-cols-2">
                {off.map((s) => (
                  <SupplierCard key={s.id} s={s} onEdit={() => setEditing(s)} />
                ))}
              </div>
            </section>
          )}
        </>
      )}

      {editing && (
        <SupplierSheet
          supplier={editing === "new" ? null : editing}
          onClose={() => setEditing(null)}
          onSaved={saved}
        />
      )}
    </div>
  );
}

function SupplierCard({ s, onEdit }: { s: Supplier; onEdit: () => void }) {
  return (
    <div className={`card p-4 min-w-0 ${s.active ? "" : "opacity-70"}`}>
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="font-heading font-bold break-words">{s.name}</p>
          {(s.contactName || s.phone) && (
            <p className="text-sm text-[var(--ink-2)] break-words">
              {s.contactName}
              {s.contactName && s.phone ? " · " : ""}
              {s.phone && (
                <a href={`tel:${s.phone}`} className="font-semibold text-[var(--kesar-text)]">
                  {s.phone}
                </a>
              )}
            </p>
          )}
          {s.gstin && <p className="text-xs text-[var(--muted)] break-all">GSTIN {s.gstin}</p>}
        </div>
        <div className="flex items-center gap-1.5 shrink-0">
          {!s.active && <ActiveChip active={false} />}
          <button type="button" className="btn btn-quiet btn-sm !min-h-[40px]" onClick={onEdit} aria-label={`Edit ${s.name}`}>
            <Icon name="edit" className="h-4 w-4" />
            <span className="hidden sm:inline">Edit</span>
          </button>
        </div>
      </div>
      <div className="mt-3 flex flex-wrap gap-2 text-sm">
        <span className="chip !py-1">{plural(s._count.products, "product")}</span>
        {s._count.purchaseOrders > 0 ? (
          <Link href={`/admin/stock/purchase-orders?supplierId=${s.id}`} className="chip chip-kesar !py-1">
            {plural(s._count.purchaseOrders, "open order")}
          </Link>
        ) : (
          <span className="chip !py-1 text-[var(--muted)]">No open orders</span>
        )}
      </div>
    </div>
  );
}

function SupplierSheet({ supplier, onClose, onSaved }: { supplier: Supplier | null; onClose: () => void; onSaved: (msg: string) => void }) {
  const [name, setName] = useState(supplier?.name ?? "");
  const [contactName, setContactName] = useState(supplier?.contactName ?? "");
  const [phone, setPhone] = useState(supplier?.phone ?? "");
  const [email, setEmail] = useState(supplier?.email ?? "");
  const [gstin, setGstin] = useState(supplier?.gstin ?? "");
  const [address, setAddress] = useState(supplier?.address ?? "");
  const [active, setActive] = useState(supplier?.active ?? true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save() {
    if (name.trim().length < 2) return setError("Enter the supplier name");
    const body: Record<string, unknown> = {
      name: name.trim(),
      contactName: contactName.trim(),
      phone: phone.trim(),
      email: email.trim(),
      gstin: gstin.trim(),
      address: address.trim(),
    };
    if (supplier) body.active = active;
    setBusy(true);
    setError(null);
    try {
      if (supplier) {
        await send(`/api/suppliers/${supplier.id}`, "PATCH", body);
        onSaved(supplier.active && !active ? `${name.trim()} turned off.` : `${name.trim()} saved.`);
      } else {
        await send("/api/suppliers", "POST", body);
        onSaved(`${name.trim()} added.`);
      }
    } catch (e) {
      setError(errText(e));
      setBusy(false);
    }
  }

  return (
    <Sheet
      title={supplier ? `Edit ${supplier.name}` : "Add supplier"}
      onClose={onClose}
      footer={
        <div className="space-y-2">
          {error && <p className="text-sm text-[#a8281e]">{error}</p>}
          <div className="flex gap-2 justify-end">
            <button type="button" className="btn btn-quiet" onClick={onClose} disabled={busy}>
              Cancel
            </button>
            <button type="button" className="btn btn-kesar" onClick={save} disabled={busy}>
              {busy ? "Saving…" : supplier ? "Save" : "Add supplier"}
            </button>
          </div>
        </div>
      }
    >
      <Field label="Company name">
        <input className="input" maxLength={100} value={name} autoFocus={!supplier} onChange={(e) => setName(e.target.value)} />
      </Field>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Contact person">
          <input className="input" maxLength={80} value={contactName} onChange={(e) => setContactName(e.target.value)} />
        </Field>
        <Field label="Phone">
          <input
            className="input"
            inputMode="tel"
            autoComplete="off"
            maxLength={14}
            value={phone}
            onChange={(e) => setPhone(e.target.value.replace(/[^\d+\s]/g, ""))}
          />
        </Field>
      </div>
      <Field label="Email">
        <input className="input" type="email" autoComplete="off" maxLength={120} value={email} onChange={(e) => setEmail(e.target.value)} />
      </Field>
      <Field label="GSTIN" hint="15 characters. Prints on purchase orders.">
        <input
          className="input uppercase"
          autoCapitalize="characters"
          autoCorrect="off"
          spellCheck={false}
          maxLength={15}
          value={gstin}
          onChange={(e) => setGstin(e.target.value.toUpperCase().replace(/\s/g, ""))}
        />
      </Field>
      <Field label="Address">
        <textarea className="input min-h-[80px]" maxLength={300} value={address} onChange={(e) => setAddress(e.target.value)} />
      </Field>
      {supplier && (
        <div className="rounded-2xl border border-[var(--line)] bg-white p-3">
          <Toggle
            checked={active}
            onChange={setActive}
            label="Active"
            hint="Turned-off suppliers stay on old orders and receipts, but you can't order from them or receive goods from them."
          />
        </div>
      )}
    </Sheet>
  );
}
