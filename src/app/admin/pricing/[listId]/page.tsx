"use client";

import { use, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import Icon from "@/components/Icon";
import { formatINR } from "@/lib/money";
import { ErrorBox, Field, Flash, MarginText, Toggle, errText, margin, readRupees, rupeeText, send, useFetch } from "@/components/admin/AdminKit";

type Row = {
  id: string;
  name: string;
  sku: string;
  unit: string;
  price: number;
  mrp: number;
  gstRate: number;
  category: { name: string };
  brand: { name: string } | null;
  listPrice: number | null;
  margin: number | null;
};
type Data = { list: { id: string; name: string; description: string | null; active: boolean; retailers: number }; products: Row[] };

const PAGE = 150;

export default function PriceListEditorPage({ params }: { params: Promise<{ listId: string }> }) {
  const { listId } = use(params);
  const { data, error, reload } = useFetch<Data>(`/api/admin/price-lists/${listId}`);
  const [flash, setFlash] = useState<string | null>(null);

  return (
    <div className="space-y-5 pb-24">
      <Link href="/admin/pricing" className="inline-flex items-center gap-1 text-sm font-semibold text-[var(--ink-2)]">
        <Icon name="chevronLeft" className="h-4 w-4" /> All price lists
      </Link>
      {error && <ErrorBox message={error} onRetry={reload} />}
      {!data && !error && <p className="text-sm text-[var(--muted)]">Loading…</p>}
      {data && <Editor
          key={JSON.stringify(data.list) + data.products.map((p) => p.listPrice).join()}
          data={data}
          flash={flash}
          setFlash={setFlash}
          onSaved={reload}
        />}
    </div>
  );
}

function Editor({
  data,
  flash,
  setFlash,
  onSaved,
}: {
  data: Data;
  flash: string | null;
  setFlash: (s: string | null) => void;
  onSaved: () => void;
}) {
  const { list, products } = data;
  const [name, setName] = useState(list.name);
  const [description, setDescription] = useState(list.description ?? "");
  const [active, setActive] = useState(list.active);
  const [draft, setDraft] = useState<Record<string, string>>(() => Object.fromEntries(products.map((p) => [p.id, rupeeText(p.listPrice)])));
  const [q, setQ] = useState("");
  const [cat, setCat] = useState("");
  const [onlyInList, setOnlyInList] = useState(false);
  const [pct, setPct] = useState("");
  const [limit, setLimit] = useState(PAGE);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const categories = useMemo(() => [...new Set(products.map((p) => p.category.name))].sort(), [products]);

  // Rows whose rate differs from what is saved.
  const changed = useMemo(() => {
    const out: { productId: string; price: number | null }[] = [];
    let bad: string | null = null;
    for (const p of products) {
      const v = readRupees(draft[p.id] ?? "");
      if (v === "bad") {
        bad ??= `${p.name}: the rate must be an amount in rupees`;
        continue;
      }
      if (v !== p.listPrice) out.push({ productId: p.id, price: v });
    }
    return { out, bad };
  }, [draft, products]);
  const metaDirty = name.trim() !== list.name || description.trim() !== (list.description ?? "") || active !== list.active;
  const dirty = metaDirty || changed.out.length > 0;

  useEffect(() => {
    if (!dirty) return;
    const warn = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);

  const shown = useMemo(() => {
    const query = q.trim().toLowerCase();
    return products.filter(
      (p) =>
        (!cat || p.category.name === cat) &&
        (!onlyInList || (draft[p.id] ?? "").trim() !== "") &&
        (!query || `${p.name} ${p.sku} ${p.brand?.name ?? ""} ${p.category.name}`.toLowerCase().includes(query))
    );
  }, [products, q, cat, onlyInList, draft]);
  const inList = products.filter((p) => (draft[p.id] ?? "").trim() !== "").length;

  const setRate = (id: string, v: string) => {
    setDraft((d) => ({ ...d, [id]: v }));
    setFlash(null);
    setError(null);
  };

  function applyPct() {
    const x = Number(pct);
    if (!Number.isFinite(x) || x < 0 || x >= 100) return setError("Enter a discount from 0 to 99.9%");
    setDraft((d) => {
      const next = { ...d };
      for (const p of shown) next[p.id] = rupeeText(Math.round(p.price * (1 - x / 100)));
      return next;
    });
    setError(null);
  }

  function clearShown() {
    setDraft((d) => {
      const next = { ...d };
      for (const p of shown) next[p.id] = "";
      return next;
    });
  }

  function undo() {
    setDraft(Object.fromEntries(products.map((p) => [p.id, rupeeText(p.listPrice)])));
    setName(list.name);
    setDescription(list.description ?? "");
    setActive(list.active);
    setError(null);
  }

  async function save() {
    if (changed.bad) return setError(changed.bad);
    if (!name.trim()) return setError("Name is required");
    setBusy(true);
    setError(null);
    try {
      const body: Record<string, unknown> = {};
      if (name.trim() !== list.name) body.name = name.trim();
      if (description.trim() !== (list.description ?? "")) body.description = description;
      if (active !== list.active) body.active = active;
      if (changed.out.length) body.items = changed.out;
      const res = await send<{ set: number; removed: number }>(`/api/admin/price-lists/${list.id}`, "PATCH", body);
      const bits = [res.set ? `${res.set} rate${res.set === 1 ? "" : "s"} set` : "", res.removed ? `${res.removed} removed` : ""].filter(Boolean);
      setFlash(bits.length ? `Saved: ${bits.join(", ")}.` : "Saved.");
      onSaved();
    } catch (e) {
      setError(errText(e));
      setBusy(false);
    }
  }

  return (
    <>
      <div>
        <p className="page-kick">Price list</p>
        <h1 className="page-title">{list.name}</h1>
        <p className="page-sub">
          {list.retailers} retailer{list.retailers === 1 ? "" : "s"} on this list · {inList} of {products.length} products have a rate here. A blank rate means the
          default rate applies.
        </p>
      </div>
      <Flash text={flash} />

      <section className="card p-4 space-y-3">
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Name">
            <input className="input" value={name} maxLength={60} onChange={(e) => setName(e.target.value)} />
          </Field>
          <Field label="Description">
            <input className="input" value={description} maxLength={200} onChange={(e) => setDescription(e.target.value)} />
          </Field>
        </div>
        <Toggle checked={active} onChange={setActive} label="Active" hint="Off: retailers on this list pay default rates until you switch it back on." />
      </section>

      <section className="card p-4 space-y-3">
        <p className="font-heading font-bold">Quick fill</p>
        <div className="flex flex-wrap items-end gap-2">
          <Field label="Default rate minus" className="w-32">
            <div className="relative">
              <input className="input !pr-7" inputMode="decimal" value={pct} placeholder="5" onChange={(e) => setPct(e.target.value)} />
              <span className="absolute right-3 top-1/2 -translate-y-1/2 text-sm text-[var(--muted)]">%</span>
            </div>
          </Field>
          <button type="button" className="btn btn-mor btn-sm !min-h-[44px]" disabled={!pct.trim() || !shown.length} onClick={applyPct}>
            Apply to {shown.length} shown
          </button>
          <button type="button" className="btn btn-quiet btn-sm !min-h-[44px]" disabled={!shown.length} onClick={clearShown}>
            Clear {shown.length} shown
          </button>
        </div>
        <p className="text-xs text-[var(--muted)]">Filter below first to fill just one category or brand. Nothing is saved until you press Save.</p>
      </section>

      <div className="space-y-2">
        <div className="grid gap-2 sm:grid-cols-[1fr_auto]">
          <input className="input" type="search" placeholder="Search product, SKU, brand" value={q} onChange={(e) => { setQ(e.target.value); setLimit(PAGE); }} />
          <select className="input sm:!w-52" value={cat} onChange={(e) => { setCat(e.target.value); setLimit(PAGE); }} aria-label="Category">
            <option value="">All categories</option>
            {categories.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
        </div>
        <Toggle checked={onlyInList} onChange={setOnlyInList} label="Only products with a rate in this list" />
      </div>

      <div className="card overflow-hidden">
        <table className="hidden md:table w-full text-sm">
          <thead>
            <tr className="text-left text-xs text-[var(--muted)] border-b border-[var(--line)]">
              <th className="px-4 py-3 font-semibold">Product</th>
              <th className="px-2 py-3 font-semibold text-right">Default rate</th>
              <th className="px-2 py-3 font-semibold w-36">This list ₹</th>
              <th className="px-2 py-3 font-semibold text-right">vs default</th>
              <th className="px-4 py-3 font-semibold text-right">Margin</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-[var(--line)]">
            {shown.slice(0, limit).map((p) => (
              <RateRow key={p.id} p={p} value={draft[p.id] ?? ""} onChange={(v) => setRate(p.id, v)} layout="table" />
            ))}
          </tbody>
        </table>
        <div className="md:hidden divide-y divide-[var(--line)]">
          {shown.slice(0, limit).map((p) => (
            <RateRow key={p.id} p={p} value={draft[p.id] ?? ""} onChange={(v) => setRate(p.id, v)} layout="card" />
          ))}
        </div>
        {shown.length === 0 && <p className="px-4 py-6 text-sm text-[var(--muted)]">No product matches.</p>}
        {shown.length > 0 && (
          <div className="flex items-center justify-between gap-2 px-4 py-3 border-t border-[var(--line)] text-xs text-[var(--muted)]">
            <span>
              Showing {Math.min(limit, shown.length)} of {shown.length}
            </span>
            {shown.length > limit && (
              <button type="button" className="btn btn-quiet btn-xs" onClick={() => setLimit((l) => l + PAGE)}>
                Show more
              </button>
            )}
          </div>
        )}
      </div>

      <div className="sticky bottom-[5.5rem] z-10 md:bottom-3">
        <div className="card p-3 flex flex-wrap items-center justify-between gap-2">
          <p className="text-sm min-w-0">
            {error ? (
              <span className="text-[#a8281e]">{error}</span>
            ) : dirty ? (
              <span className="text-[var(--ink-2)]">
                {changed.out.length ? `${changed.out.length} rate${changed.out.length === 1 ? "" : "s"} changed` : "Details changed"} — not saved yet.
              </span>
            ) : (
              <span className="text-[var(--muted)]">All changes saved.</span>
            )}
          </p>
          <div className="flex gap-2 ml-auto">
            {dirty && (
              <button type="button" className="btn btn-quiet btn-sm" disabled={busy} onClick={undo}>
                Undo
              </button>
            )}
            <button type="button" className="btn btn-kesar btn-sm" disabled={!dirty || busy} onClick={save}>
              {busy ? "Saving…" : dirty ? "Save" : "Saved"}
            </button>
          </div>
        </div>
      </div>
    </>
  );
}

function RateRow({ p, value, onChange, layout }: { p: Row; value: string; onChange: (v: string) => void; layout: "table" | "card" }) {
  const v = readRupees(value);
  const effective = typeof v === "number" ? v : p.price;
  const m = margin(effective, p.gstRate, p.mrp);
  const diff = typeof v === "number" && p.price > 0 ? Math.round(((v - p.price) / p.price) * 1000) / 10 : null;
  const changed = (typeof v === "number" ? v : v === null ? null : "bad") !== p.listPrice;
  const input = (
    <input
      className={`input !py-1.5 ${v === "bad" ? "!border-[#a8281e]" : ""}`}
      inputMode="decimal"
      value={value}
      placeholder={rupeeText(p.price)}
      aria-label={`Rate for ${p.name} in this list`}
      onChange={(e) => onChange(e.target.value)}
    />
  );
  const diffText =
    diff === null ? <span className="text-[var(--muted)]">default</span> : <span className={diff < 0 ? "text-[var(--mint-text)] font-semibold" : diff > 0 ? "text-[#a8281e] font-semibold" : ""}>{diff > 0 ? "+" : ""}{diff}%</span>;

  if (layout === "table") {
    return (
      <tr className={changed ? "bg-[var(--genda-tint)]/60" : ""}>
        <td className="px-4 py-2">
          <p className="font-bold">{p.name}</p>
          <p className="text-xs text-[var(--muted)]">
            {p.sku} · {p.category.name}
            {p.brand && ` · ${p.brand.name}`} · MRP {formatINR(p.mrp)} · GST {p.gstRate}%
          </p>
        </td>
        <td className="px-2 py-2 text-right whitespace-nowrap text-[var(--ink-2)]">
          {formatINR(p.price)}
          <span className="block text-xs text-[var(--muted)]">/ {p.unit}</span>
        </td>
        <td className="px-2 py-2">{input}</td>
        <td className="px-2 py-2 text-right text-xs">{diffText}</td>
        <td className="px-4 py-2 text-right">
          <MarginText value={m} />
        </td>
      </tr>
    );
  }
  return (
    <div className={`px-4 py-3 space-y-2 ${changed ? "bg-[var(--genda-tint)]/60" : ""}`}>
      <div className="min-w-0">
        <p className="text-sm font-bold truncate">{p.name}</p>
        <p className="text-xs text-[var(--muted)] truncate">
          {p.sku} · MRP {formatINR(p.mrp)} · GST {p.gstRate}%
        </p>
      </div>
      <div className="grid grid-cols-[1fr_7.5rem] items-center gap-3">
        <div className="text-xs space-y-0.5">
          <p className="text-[var(--ink-2)]">
            Default {formatINR(p.price)} / {p.unit}
          </p>
          <p>
            {diffText} · margin <MarginText value={m} />
          </p>
        </div>
        {input}
      </div>
    </div>
  );
}
