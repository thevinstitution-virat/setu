"use client";

import Link from "next/link";
import { Suspense, useMemo, useRef, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import Icon from "@/components/Icon";
import { formatINR } from "@/lib/money";
import {
  ActiveChip,
  ErrorBox,
  Field,
  Flash,
  ImageField,
  MarginText,
  MultiPick,
  Sheet,
  TabBar,
  Thumb,
  Toggle,
  areaOptions,
  errText,
  groupOptions,
  isoToLocal,
  localToIso,
  margin,
  readInt,
  readRupees,
  rupeeText,
  send,
  shortDate,
  uploadImage,
  useFetch,
  type GroupRow,
  type Option,
  type RegionRow,
} from "@/components/admin/AdminKit";

// Same list as GST_RATES in src/lib/catalogue-api.ts (server file — not imported here).
const GST_RATES = [0, 0.1, 0.25, 1, 1.5, 3, 5, 6, 7.5, 12, 18, 28, 40];

type Product = {
  id: string;
  name: string;
  nameHi: string | null;
  aliases: string | null;
  description: string | null;
  sku: string;
  categoryId: string;
  category: { id: string; name: string };
  brandId: string | null;
  brand: { id: string; name: string } | null;
  hsnCode: string | null;
  unit: string;
  caseUnit: string | null;
  caseSize: number | null;
  moq: number;
  price: number;
  mrp: number;
  gstRate: number;
  specialOffer: string | null;
  images: string[];
  visibleAreaIds: string[];
  visibleGroupIds: string[];
  sort: number;
  active: boolean;
  reorderLevel?: number | null;
  reorderQty?: number | null;
  supplierId?: string | null;
  trackExpiry?: boolean;
};

type Category = { id: string; name: string; parentId: string | null; imageKey: string | null; sort: number; active: boolean; _count: { products: number } };
type Brand = { id: string; name: string; logoKey: string | null; sort: number; active: boolean; _count: { products: number } };
type Hsn = { id: string; code: string; description: string | null; gstRate: number; products: number };
type LinkType = "product" | "brand" | "category" | "scheme" | "url";
type Banner = {
  id: string;
  title: string;
  subtitle: string | null;
  imageKey: string | null;
  linkType: LinkType | null;
  linkId: string | null;
  areaIds: string[];
  groupIds: string[];
  startsAt: string | null;
  endsAt: string | null;
  sort: number;
  active: boolean;
};
type SchemeLite = { id: string; name: string; summary: string; active: boolean };

const TABS = [
  { key: "products", label: "Products" },
  { key: "categories", label: "Categories" },
  { key: "brands", label: "Brands" },
  { key: "hsn", label: "HSN codes" },
  { key: "banners", label: "Banners" },
] as const;
type Tab = (typeof TABS)[number]["key"];

// ───────────────────────────── helpers ─────────────────────────────

/** "Parent › Child" for every category id. */
function categoryLabels(cats: Category[]) {
  const byId = new Map(cats.map((c) => [c.id, c]));
  const out = new Map<string, string>();
  for (const c of cats) {
    const names = [c.name];
    let p = c.parentId ? byId.get(c.parentId) : undefined;
    for (let n = 0; p && n < 10; n++) {
      names.unshift(p.name);
      p = p.parentId ? byId.get(p.parentId) : undefined;
    }
    out.set(c.id, names.join(" › "));
  }
  return out;
}

/** The category and every category under it. */
function withDescendants(cats: Category[], id: string) {
  const kids = new Map<string, string[]>();
  for (const c of cats) if (c.parentId) kids.set(c.parentId, [...(kids.get(c.parentId) ?? []), c.id]);
  const out = new Set<string>();
  const stack = [id];
  while (stack.length) {
    const x = stack.pop()!;
    if (out.has(x)) continue;
    out.add(x);
    stack.push(...(kids.get(x) ?? []));
  }
  return out;
}

const intOr = (s: string, d: number) => {
  const n = readInt(s);
  return typeof n === "number" ? n : d;
};

// ───────────────────────────── page ─────────────────────────────

export default function ProductsPage() {
  return (
    <Suspense fallback={<p className="text-sm text-[var(--muted)]">Loading…</p>}>
      <Catalogue />
    </Suspense>
  );
}

function Catalogue() {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const raw = params.get("tab");
  const tab: Tab = TABS.some((t) => t.key === raw) ? (raw as Tab) : "products";

  function pick(t: Tab) {
    router.replace(t === "products" ? pathname : `${pathname}?tab=${t}`, { scroll: false });
  }

  return (
    <div className="space-y-5">
      <div className="page-head">
        <div className="min-w-0">
          <p className="page-kick">Catalogue</p>
          <h1 className="page-title">Products</h1>
          <p className="page-sub">What retailers can order, how it is grouped, its GST, and the banners on their home screen.</p>
        </div>
        <Link href="/admin/products/assist" className="btn btn-quiet btn-sm">
          <Icon name="sparkle" className="h-4 w-4" /> Catalogue assist
        </Link>
      </div>
      <TabBar tabs={TABS} value={tab} onChange={pick} />
      {tab === "products" && <ProductsTab />}
      {tab === "categories" && <CategoriesTab />}
      {tab === "brands" && <BrandsTab />}
      {tab === "hsn" && <HsnTab />}
      {tab === "banners" && <BannersTab />}
    </div>
  );
}

// ───────────────────────────── Products ─────────────────────────────

function ProductsTab() {
  const products = useFetch<{ products: Product[] }>("/api/products");
  const cats = useFetch<{ categories: Category[] }>("/api/admin/categories");
  const brands = useFetch<{ brands: Brand[] }>("/api/admin/brands");
  const hsn = useFetch<{ codes: Hsn[] }>("/api/admin/hsn");
  const regions = useFetch<{ regions: RegionRow[] }>("/api/areas");
  const groups = useFetch<{ groups: GroupRow[] }>("/api/admin/groups");

  const [q, setQ] = useState("");
  const [cat, setCat] = useState("");
  const [brand, setBrand] = useState("");
  const [showInactive, setShowInactive] = useState(false);
  const [editing, setEditing] = useState<Product | "new" | null>(null);
  const [flash, setFlash] = useState<string | null>(null);

  const categories = useMemo(() => cats.data?.categories ?? [], [cats.data]);
  const labels = useMemo(() => categoryLabels(categories), [categories]);
  const catSet = useMemo(() => (cat ? withDescendants(categories, cat) : null), [cat, categories]);

  const all = useMemo(() => products.data?.products ?? [], [products.data]);
  const shown = useMemo(() => {
    const query = q.trim().toLowerCase();
    return all.filter((p) => {
      if (!showInactive && !p.active) return false;
      if (catSet && !catSet.has(p.categoryId)) return false;
      if (brand === "none" ? p.brandId !== null : brand && p.brandId !== brand) return false;
      if (!query) return true;
      return [p.name, p.nameHi, p.sku, p.aliases, p.brand?.name, p.category.name, p.hsnCode]
        .filter(Boolean)
        .join(" ")
        .toLowerCase()
        .includes(query);
    });
  }, [all, q, catSet, brand, showInactive]);
  const inactive = all.filter((p) => !p.active).length;

  const error = products.error ?? cats.error;
  const sortedCats = [...categories].sort((a, b) => (labels.get(a.id) ?? "").localeCompare(labels.get(b.id) ?? ""));

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm text-[var(--ink-2)]">
          {products.data ? (
            <>
              <span className="font-bold">{all.length - inactive}</span> active
              {inactive > 0 && ` · ${inactive} inactive`}
            </>
          ) : (
            "Loading…"
          )}
        </p>
        <button
          type="button"
          className="btn btn-kesar btn-sm"
          disabled={!cats.data}
          onClick={() => {
            setFlash(null);
            setEditing("new");
          }}
        >
          <Icon name="plus" className="h-4 w-4" /> Add product
        </button>
      </div>
      {cats.data && categories.length === 0 && (
        <p className="card p-4 text-sm text-[var(--ink-2)]">Add a category first (Categories tab) — every product needs one.</p>
      )}

      <div className="grid gap-2 sm:grid-cols-[1fr_auto_auto]">
        <input className="input" type="search" placeholder="Search name, Hindi name, SKU, search words" value={q} onChange={(e) => setQ(e.target.value)} />
        <select className="input sm:!w-48" value={cat} onChange={(e) => setCat(e.target.value)} aria-label="Category">
          <option value="">All categories</option>
          {sortedCats.map((c) => (
            <option key={c.id} value={c.id}>
              {labels.get(c.id)}
            </option>
          ))}
        </select>
        <select className="input sm:!w-44" value={brand} onChange={(e) => setBrand(e.target.value)} aria-label="Brand">
          <option value="">All brands</option>
          <option value="none">No brand</option>
          {(brands.data?.brands ?? []).map((b) => (
            <option key={b.id} value={b.id}>
              {b.name}
            </option>
          ))}
        </select>
      </div>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <Toggle checked={showInactive} onChange={setShowInactive} label="Show inactive products" />
        <Flash text={flash} />
      </div>

      {error && <ErrorBox message={error} onRetry={products.reload} />}

      {products.data && (
        <div className="card overflow-hidden">
          <table className="hidden md:table w-full text-sm">
            <thead>
              <tr className="text-left text-xs text-[var(--muted)] border-b border-[var(--line)]">
                <th className="px-4 py-3 font-semibold">Product</th>
                <th className="px-2 py-3 font-semibold">Category · brand</th>
                <th className="px-2 py-3 font-semibold text-right">Rate</th>
                <th className="px-2 py-3 font-semibold text-right">MRP</th>
                <th className="px-2 py-3 font-semibold text-right">GST</th>
                <th className="px-2 py-3 font-semibold text-right">Margin</th>
                <th className="px-4 py-3 font-semibold text-right">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[var(--line)]">
              {shown.map((p) => (
                <tr key={p.id} className="cursor-pointer hover:bg-black/[0.03]" onClick={() => setEditing(p)}>
                  <td className="px-4 py-2.5">
                    <div className="flex items-center gap-3 min-w-0">
                      <Thumb imageKey={p.images[0]} className="h-10 w-10" />
                      <div className="min-w-0">
                        <p className="font-bold truncate">{p.name}</p>
                        <p className="text-xs text-[var(--muted)] truncate">
                          {p.sku}
                          {p.nameHi && ` · ${p.nameHi}`}
                        </p>
                      </div>
                    </div>
                  </td>
                  <td className="px-2 py-2.5 text-[var(--ink-2)]">
                    {labels.get(p.categoryId) ?? p.category.name}
                    {p.brand && <span className="block text-xs text-[var(--muted)]">{p.brand.name}</span>}
                  </td>
                  <td className="px-2 py-2.5 text-right font-semibold whitespace-nowrap">
                    {formatINR(p.price)}
                    <span className="block text-xs font-normal text-[var(--muted)]">/ {p.unit}</span>
                  </td>
                  <td className="px-2 py-2.5 text-right whitespace-nowrap">{formatINR(p.mrp)}</td>
                  <td className="px-2 py-2.5 text-right">{p.gstRate}%</td>
                  <td className="px-2 py-2.5 text-right">
                    <MarginText value={margin(p.price, p.gstRate, p.mrp)} />
                  </td>
                  <td className="px-4 py-2.5 text-right">
                    <ActiveChip active={p.active} off="Inactive" />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>

          <div className="md:hidden divide-y divide-[var(--line)]">
            {shown.map((p) => (
              <button key={p.id} type="button" className="flex w-full gap-3 px-4 py-3 text-left" onClick={() => setEditing(p)}>
                <Thumb imageKey={p.images[0]} className="h-12 w-12" />
                <div className="min-w-0 flex-1">
                  <div className="flex items-start justify-between gap-2">
                    <p className="text-sm font-bold truncate">{p.name}</p>
                    <p className="text-sm font-bold shrink-0">{formatINR(p.price)}</p>
                  </div>
                  <p className="text-xs text-[var(--muted)] truncate">
                    {p.sku} · {p.category.name}
                    {p.brand && ` · ${p.brand.name}`}
                  </p>
                  <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs">
                    <span className="text-[var(--ink-2)]">MRP {formatINR(p.mrp)}</span>
                    <span className="text-[var(--ink-2)]">GST {p.gstRate}%</span>
                    <MarginText value={margin(p.price, p.gstRate, p.mrp)} />
                    {!p.active && <ActiveChip active={false} off="Inactive" />}
                  </div>
                </div>
              </button>
            ))}
          </div>
          {shown.length === 0 && (
            <p className="px-4 py-6 text-sm text-[var(--muted)]">{all.length ? "No product matches these filters." : "No products yet."}</p>
          )}
        </div>
      )}

      {editing && cats.data && (
        <ProductForm
          product={editing === "new" ? null : editing}
          categories={sortedCats}
          labels={labels}
          brands={brands.data?.brands ?? []}
          hsn={hsn.data?.codes ?? []}
          areaOpts={areaOptions(regions.data?.regions)}
          groupOpts={groupOptions(groups.data?.groups)}
          onClose={() => setEditing(null)}
          onSaved={(name, isNew) => {
            setEditing(null);
            setFlash(`${isNew ? "Added" : "Saved"} ${name}`);
            products.reload();
          }}
        />
      )}
    </div>
  );
}

type PForm = {
  name: string;
  nameHi: string;
  aliases: string;
  sku: string;
  categoryId: string;
  brandId: string;
  hsnCode: string;
  gstRate: string;
  unit: string;
  caseUnit: string;
  caseSize: string;
  moq: string;
  price: string;
  mrp: string;
  specialOffer: string;
  description: string;
  images: string[];
  visibleAreaIds: string[];
  visibleGroupIds: string[];
  sort: string;
  active: boolean;
  reorderLevel: string;
  reorderQty: string;
  supplierId: string;
  trackExpiry: boolean;
};

function toPForm(p: Product | null, firstCategory: string): PForm {
  return {
    name: p?.name ?? "",
    nameHi: p?.nameHi ?? "",
    aliases: p?.aliases ?? "",
    sku: p?.sku ?? "",
    categoryId: p?.categoryId ?? firstCategory,
    brandId: p?.brandId ?? "",
    hsnCode: p?.hsnCode ?? "",
    gstRate: String(p?.gstRate ?? 0),
    unit: p?.unit ?? "pc",
    caseUnit: p?.caseUnit ?? "",
    caseSize: p?.caseSize ? String(p.caseSize) : "",
    moq: String(p?.moq ?? 1),
    price: rupeeText(p?.price),
    mrp: rupeeText(p?.mrp),
    specialOffer: p?.specialOffer ?? "",
    description: p?.description ?? "",
    images: p?.images ?? [],
    visibleAreaIds: p?.visibleAreaIds ?? [],
    visibleGroupIds: p?.visibleGroupIds ?? [],
    sort: String(p?.sort ?? 0),
    active: p?.active ?? true,
    reorderLevel: p?.reorderLevel != null ? String(p.reorderLevel) : "",
    reorderQty: p?.reorderQty != null ? String(p.reorderQty) : "",
    supplierId: p?.supplierId ?? "",
    trackExpiry: p?.trackExpiry ?? false,
  };
}

function ProductForm({
  product,
  categories,
  labels,
  brands,
  hsn,
  areaOpts,
  groupOpts,
  onClose,
  onSaved,
}: {
  product: Product | null;
  categories: Category[];
  labels: Map<string, string>;
  brands: Brand[];
  hsn: Hsn[];
  areaOpts: Option[];
  groupOpts: Option[];
  onClose: () => void;
  onSaved: (name: string, isNew: boolean) => void;
}) {
  const [f, setF] = useState<PForm>(() => toPForm(product, categories.find((c) => c.active)?.id ?? ""));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const set = <K extends keyof PForm>(k: K, v: PForm[K]) => {
    setF((x) => ({ ...x, [k]: v }));
    setError(null);
  };

  const hsnRow = hsn.find((h) => h.code === f.hsnCode.trim()) ?? null;
  const gst = hsnRow ? hsnRow.gstRate : Number(f.gstRate);
  const rate = readRupees(f.price);
  const mrp = readRupees(f.mrp);
  const hint = typeof rate === "number" && typeof mrp === "number" && mrp > 0 ? margin(rate, gst, mrp) : null;
  const landed = typeof rate === "number" ? Math.round(rate * (1 + gst / 100)) : null;
  const gstOptions = GST_RATES.includes(Number(f.gstRate)) ? GST_RATES : [...GST_RATES, Number(f.gstRate)].sort((a, b) => a - b);

  function body(): Record<string, unknown> | string {
    if (!f.name.trim()) return "Name is required";
    if (!f.sku.trim()) return "SKU is required";
    if (!f.categoryId) return "Choose a category";
    if (!f.unit.trim()) return "Unit is required";
    if (rate === null || rate === "bad") return "Rate must be an amount in rupees";
    if (mrp === null || mrp === "bad") return "MRP must be an amount in rupees";
    if (f.hsnCode.trim() && !/^\d{4,8}$/.test(f.hsnCode.trim())) return "HSN code must be 4 to 8 digits";
    const hasUnit = !!f.caseUnit.trim();
    const size = readInt(f.caseSize, 2);
    if (hasUnit !== (size !== null)) return "Give both the case name and how many units are in it — or neither";
    if (size === "bad") return "A case must hold 2 to 10,000 units";
    const moq = readInt(f.moq, 1);
    if (moq === null || moq === "bad") return "Minimum order quantity must be at least 1";
    const sort = readInt(f.sort);
    if (sort === "bad") return "Sort must be a whole number";
    const reorderLevel = readInt(f.reorderLevel);
    if (reorderLevel === "bad") return "Reorder level must be a whole number";
    const reorderQty = readInt(f.reorderQty, 1);
    if (reorderQty === "bad") return "Reorder quantity must be a whole number above 0";
    return {
      name: f.name.trim(),
      nameHi: f.nameHi,
      aliases: f.aliases,
      sku: f.sku.trim(),
      categoryId: f.categoryId,
      brandId: f.brandId || null,
      hsnCode: f.hsnCode.trim() || null,
      gstRate: gst,
      unit: f.unit.trim(),
      caseUnit: hasUnit ? f.caseUnit.trim() : null,
      caseSize: size,
      moq,
      price: rate,
      mrp,
      specialOffer: f.specialOffer,
      description: f.description,
      // Only sent when changed, so other edits still save if the photo check on the server misbehaves.
      ...(JSON.stringify(f.images) !== JSON.stringify(product?.images ?? []) ? { images: f.images } : {}),
      visibleAreaIds: f.visibleAreaIds,
      visibleGroupIds: f.visibleGroupIds,
      sort: sort ?? 0,
      active: f.active,
      reorderLevel,
      reorderQty,
      supplierId: f.supplierId || null,
      trackExpiry: f.trackExpiry,
    };
  }

  async function save() {
    const b = body();
    if (typeof b === "string") {
      setError(b);
      return;
    }
    setBusy(true);
    try {
      if (product) await send(`/api/products/${product.id}`, "PATCH", b);
      else await send("/api/products", "POST", b);
      onSaved(f.name.trim(), !product);
    } catch (e) {
      setError(errText(e));
      setBusy(false);
    }
  }

  return (
    <Sheet
      title={product ? `Edit ${product.name}` : "Add product"}
      onClose={onClose}
      wide
      footer={
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="text-sm text-[#a8281e] min-w-0">{error}</p>
          <div className="flex gap-2 ml-auto">
            <button type="button" className="btn btn-quiet btn-sm" onClick={onClose} disabled={busy}>
              Cancel
            </button>
            <button type="button" className="btn btn-kesar btn-sm" onClick={save} disabled={busy}>
              {busy ? "Saving…" : product ? "Save product" : "Add product"}
            </button>
          </div>
        </div>
      }
    >
      <section className="space-y-3">
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Name">
            <input className="input" value={f.name} maxLength={120} onChange={(e) => set("name", e.target.value)} />
          </Field>
          <Field label="Hindi name" hint="Shown when the retailer uses Hindi; also searched.">
            <input className="input" lang="hi" value={f.nameHi} maxLength={120} onChange={(e) => set("nameHi", e.target.value)} />
          </Field>
          <Field label="SKU" hint="Letters, digits, . _ - /">
            <input className="input" value={f.sku} maxLength={40} autoCapitalize="characters" onChange={(e) => set("sku", e.target.value)} />
          </Field>
          <Field label="Search words" hint="Comma separated: local names, common misspellings.">
            <input className="input" value={f.aliases} maxLength={300} onChange={(e) => set("aliases", e.target.value)} />
          </Field>
          <Field label="Category">
            <select className="input" value={f.categoryId} onChange={(e) => set("categoryId", e.target.value)}>
              <option value="">Choose…</option>
              {categories.map((c) => (
                <option key={c.id} value={c.id}>
                  {labels.get(c.id)}
                  {c.active ? "" : " (off)"}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Brand (optional)">
            <select className="input" value={f.brandId} onChange={(e) => set("brandId", e.target.value)}>
              <option value="">No brand</option>
              {brands.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.name}
                  {b.active ? "" : " (off)"}
                </option>
              ))}
            </select>
          </Field>
        </div>
      </section>

      <section className="card p-4 space-y-3">
        <p className="font-heading font-bold">Rate and tax</p>
        <div className="grid gap-3 grid-cols-2">
          <Field label="Rate ₹ (before GST)">
            <input className="input" inputMode="decimal" value={f.price} onChange={(e) => set("price", e.target.value)} />
          </Field>
          <Field label="MRP ₹">
            <input className="input" inputMode="decimal" value={f.mrp} onChange={(e) => set("mrp", e.target.value)} />
          </Field>
          <Field label="HSN code" hint={hsnRow ? <span className="text-[var(--mint-text)] font-semibold">GST set by HSN: {hsnRow.gstRate}%</span> : f.hsnCode.trim() ? "Not in your HSN list — pick GST yourself." : undefined}>
            <input className="input" inputMode="numeric" maxLength={8} value={f.hsnCode} onChange={(e) => set("hsnCode", e.target.value.replace(/\D/g, ""))} />
          </Field>
          <Field label="GST %">
            <select className="input" value={hsnRow ? String(hsnRow.gstRate) : f.gstRate} disabled={!!hsnRow} onChange={(e) => set("gstRate", e.target.value)}>
              {(hsnRow && !gstOptions.includes(hsnRow.gstRate) ? [...gstOptions, hsnRow.gstRate] : gstOptions).map((g) => (
                <option key={g} value={String(g)}>
                  {g}%
                </option>
              ))}
            </select>
          </Field>
        </div>
        <div className="rounded-xl bg-ink/5 px-3 py-2 text-sm">
          {hint === null ? (
            <span className="text-[var(--muted)]">Enter the rate and MRP to see the retailer&apos;s margin.</span>
          ) : (
            <span>
              Retailer pays {formatINR(landed!)} with GST and sells at {formatINR(mrp as number)}: margin <MarginText value={hint} />
              {hint < 0 && <span className="text-[#a8281e]"> — the rate with GST is above MRP.</span>}
            </span>
          )}
        </div>
      </section>

      <section className="card p-4 space-y-3">
        <p className="font-heading font-bold">Packing and ordering</p>
        <div className="grid gap-3 grid-cols-2 sm:grid-cols-4">
          <Field label="Unit" hint="pc, pack, kg…">
            <input className="input" value={f.unit} maxLength={20} onChange={(e) => set("unit", e.target.value)} />
          </Field>
          <Field label="Case name" hint="e.g. box">
            <input className="input" value={f.caseUnit} maxLength={20} onChange={(e) => set("caseUnit", e.target.value)} />
          </Field>
          <Field label="Units per case">
            <input className="input" inputMode="numeric" value={f.caseSize} onChange={(e) => set("caseSize", e.target.value)} />
          </Field>
          <Field label="Minimum order" hint={`In ${f.unit || "units"}`}>
            <input className="input" inputMode="numeric" value={f.moq} onChange={(e) => set("moq", e.target.value)} />
          </Field>
        </div>
        <p className="text-xs text-[var(--muted)]">Fill both case fields or leave both empty.</p>
      </section>

      <StockFields f={f} set={set} supplierId={product?.supplierId ?? null} />

      <section className="space-y-3">
        <Field label="Special offer text (optional)" hint="Shown as a tag on the product, e.g. “Free tray on 2 boxes”.">
          <input className="input" value={f.specialOffer} maxLength={120} onChange={(e) => set("specialOffer", e.target.value)} />
        </Field>
        <Field label="Description (optional)">
          <textarea className="input min-h-24" value={f.description} maxLength={1000} onChange={(e) => set("description", e.target.value)} />
        </Field>
      </section>

      <section className="card p-4 space-y-3">
        <div>
          <p className="font-heading font-bold">Photos</p>
          <p className="text-xs text-[var(--muted)]">Up to 6. The first photo is the main one.</p>
        </div>
        <ProductPhotos value={f.images} onChange={(v) => set("images", v)} />
      </section>

      <section className="card p-4 space-y-3">
        <div>
          <p className="font-heading font-bold">Who can see it</p>
          <p className="text-xs text-[var(--muted)]">Leave both empty and every retailer sees it. Otherwise only these areas and groups do.</p>
        </div>
        <Field label="Areas">
          <MultiPick options={areaOpts} value={f.visibleAreaIds} onChange={(v) => set("visibleAreaIds", v)} placeholder="Search areas" emptyText="All areas" />
        </Field>
        <Field label="Retailer groups">
          <MultiPick options={groupOpts} value={f.visibleGroupIds} onChange={(v) => set("visibleGroupIds", v)} placeholder="Search groups" emptyText="All groups" />
        </Field>
      </section>

      <section className="grid gap-3 grid-cols-[8rem_1fr] items-end">
        <Field label="Sort" hint="Lower shows first">
          <input className="input" inputMode="numeric" value={f.sort} onChange={(e) => set("sort", e.target.value)} />
        </Field>
        <div className="pb-6">
          <Toggle checked={f.active} onChange={(v) => set("active", v)} label="Active" hint="Off hides it from every retailer." />
        </div>
      </section>
    </Sheet>
  );
}

/** Stock group of the product form: reorder level / quantity, usual supplier, expiry on receiving. */
function StockFields({
  f,
  set,
  supplierId,
}: {
  f: PForm;
  set: <K extends keyof PForm>(k: K, v: PForm[K]) => void;
  supplierId: string | null;
}) {
  const suppliers = useFetch<{ suppliers: { id: string; name: string; active: boolean }[] }>("/api/suppliers");
  const list = (suppliers.data?.suppliers ?? []).filter((s) => s.active || s.id === supplierId);
  const unit = f.unit.trim() || "units";
  return (
    <section className="card p-4 space-y-3">
      <div>
        <p className="font-heading font-bold">Stock</p>
        <p className="text-xs text-[var(--muted)]">Used when stock tracking is on.</p>
      </div>
      <div className="grid gap-3 grid-cols-2">
        <Field label="Reorder level" hint={`Flag it at or below this many ${unit}. Blank = never.`}>
          <input className="input" inputMode="numeric" value={f.reorderLevel} onChange={(e) => set("reorderLevel", e.target.value.replace(/\D/g, ""))} />
        </Field>
        <Field label="Reorder quantity" hint={`${unit} to order. Blank = up to twice the level.`}>
          <input className="input" inputMode="numeric" value={f.reorderQty} onChange={(e) => set("reorderQty", e.target.value.replace(/\D/g, ""))} />
        </Field>
      </div>
      <Field label="Usual supplier" hint={suppliers.error ? "Couldn't load suppliers." : undefined}>
        <select className="input" value={f.supplierId} disabled={!suppliers.data} onChange={(e) => set("supplierId", e.target.value)}>
          <option value="">{suppliers.data ? "No usual supplier" : suppliers.error ? "Not available" : "Loading…"}</option>
          {list.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
              {s.active ? "" : " (off)"}
            </option>
          ))}
        </select>
      </Field>
      <Toggle
        checked={f.trackExpiry}
        onChange={(v) => set("trackExpiry", v)}
        label="Expiry date needed when receiving"
        hint="For goods with a shelf life: each batch received needs its expiry date."
      />
    </section>
  );
}

function ProductPhotos({ value, onChange }: { value: string[]; onChange: (v: string[]) => void }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const input = useRef<HTMLInputElement>(null);

  async function add(files: FileList | null) {
    if (!files?.length) return;
    const room = 6 - value.length;
    const list = [...files].slice(0, room);
    setBusy(true);
    setError(files.length > room ? `Only ${room} more photo${room === 1 ? "" : "s"} fit — the rest were skipped.` : null);
    const keys = [...value];
    try {
      for (const f of list) {
        keys.push(await uploadImage(f, "product-image"));
        onChange([...keys]);
      }
    } catch (e) {
      setError(errText(e));
    } finally {
      setBusy(false);
      if (input.current) input.current.value = "";
    }
  }

  const move = (i: number, d: -1 | 1) => {
    const j = i + d;
    if (j < 0 || j >= value.length) return;
    const next = [...value];
    [next[i], next[j]] = [next[j], next[i]];
    onChange(next);
  };

  return (
    <div className="space-y-2">
      <div className="grid grid-cols-3 sm:grid-cols-6 gap-2">
        {value.map((k, i) => (
          <div key={k} className="space-y-1">
            <div className="relative">
              <Thumb imageKey={k} className="aspect-square w-full" />
              {i === 0 && <span className="chip chip-kesar absolute left-1 top-1 !py-0 !px-1.5 !text-[10.5px]">Main</span>}
            </div>
            <div className="flex justify-between gap-1">
              <button type="button" className="btn btn-quiet btn-xs !px-1.5 !min-h-7" disabled={i === 0} onClick={() => move(i, -1)} aria-label="Move earlier">
                <Icon name="chevronLeft" className="h-3.5 w-3.5" />
              </button>
              <button type="button" className="btn btn-danger btn-xs !px-1.5 !min-h-7" onClick={() => onChange(value.filter((x) => x !== k))} aria-label="Remove photo">
                <Icon name="x" className="h-3.5 w-3.5" />
              </button>
              <button type="button" className="btn btn-quiet btn-xs !px-1.5 !min-h-7" disabled={i === value.length - 1} onClick={() => move(i, 1)} aria-label="Move later">
                <Icon name="chevronRight" className="h-3.5 w-3.5" />
              </button>
            </div>
          </div>
        ))}
        {value.length < 6 && (
          <button
            type="button"
            className="aspect-square w-full rounded-xl border-2 border-dashed border-ink/15 text-[var(--muted)] grid place-items-center text-xs font-semibold"
            disabled={busy}
            onClick={() => input.current?.click()}
          >
            <span className="grid place-items-center gap-1">
              <Icon name="plus" className="h-5 w-5" />
              {busy ? "Uploading…" : "Add photo"}
            </span>
          </button>
        )}
      </div>
      <input ref={input} type="file" accept="image/jpeg,image/png,image/webp" multiple className="hidden" onChange={(e) => add(e.target.files)} />
      {error && <p className="text-xs text-[#a8281e]">{error}</p>}
    </div>
  );
}

// ───────────────────────────── Categories ─────────────────────────────

function CategoriesTab() {
  const { data, error, reload } = useFetch<{ categories: Category[] }>("/api/admin/categories");
  const [editing, setEditing] = useState<Category | "new" | null>(null);
  const [flash, setFlash] = useState<string | null>(null);
  const cats = useMemo(() => data?.categories ?? [], [data]);
  const labels = useMemo(() => categoryLabels(cats), [cats]);

  // Depth-first order: parents, then their children (sort, then name).
  const rows = useMemo(() => {
    const ids = new Set(cats.map((c) => c.id));
    const kids = new Map<string | null, Category[]>();
    for (const c of cats) {
      const p = c.parentId && ids.has(c.parentId) ? c.parentId : null;
      kids.set(p, [...(kids.get(p) ?? []), c]);
    }
    const out: { c: Category; depth: number }[] = [];
    const seen = new Set<string>();
    const walk = (p: string | null, depth: number) => {
      for (const c of (kids.get(p) ?? []).sort((a, b) => a.sort - b.sort || a.name.localeCompare(b.name))) {
        if (seen.has(c.id)) continue;
        seen.add(c.id);
        out.push({ c, depth });
        walk(c.id, depth + 1);
      }
    };
    walk(null, 0);
    return out;
  }, [cats]);

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm text-[var(--ink-2)]">Sub-categories sit under a parent. Schemes on a category also cover the ones under it.</p>
        <button type="button" className="btn btn-kesar btn-sm" disabled={!data} onClick={() => setEditing("new")}>
          <Icon name="plus" className="h-4 w-4" /> Add category
        </button>
      </div>
      <Flash text={flash} />
      {error && <ErrorBox message={error} onRetry={reload} />}
      {data && (
        <div className="card overflow-hidden divide-y divide-[var(--line)]">
          {rows.map(({ c, depth }) => (
            <button
              key={c.id}
              type="button"
              className="flex w-full items-center gap-3 px-4 py-2.5 text-left hover:bg-black/[0.03]"
              style={{ paddingLeft: `${16 + Math.min(depth, 4) * 20}px` }}
              onClick={() => setEditing(c)}
            >
              {depth > 0 && <span className="text-[var(--muted)] -ml-1">└</span>}
              <Thumb imageKey={c.imageKey} className="h-9 w-9" />
              <div className="min-w-0 flex-1">
                <p className={`text-sm font-bold truncate ${c.active ? "" : "text-[var(--muted)]"}`}>{c.name}</p>
                <p className="text-xs text-[var(--muted)]">
                  {c._count.products} product{c._count.products === 1 ? "" : "s"} · sort {c.sort}
                </p>
              </div>
              {!c.active && <ActiveChip active={false} />}
              <Icon name="edit" className="h-4 w-4 text-[var(--muted)] shrink-0" />
            </button>
          ))}
          {rows.length === 0 && <p className="px-4 py-6 text-sm text-[var(--muted)]">No categories yet.</p>}
        </div>
      )}
      {editing && (
        <CategoryForm
          category={editing === "new" ? null : editing}
          all={cats}
          labels={labels}
          onClose={() => setEditing(null)}
          onSaved={(name) => {
            setEditing(null);
            setFlash(`Saved ${name}`);
            reload();
          }}
        />
      )}
    </div>
  );
}

function CategoryForm({
  category,
  all,
  labels,
  onClose,
  onSaved,
}: {
  category: Category | null;
  all: Category[];
  labels: Map<string, string>;
  onClose: () => void;
  onSaved: (name: string) => void;
}) {
  const [name, setName] = useState(category?.name ?? "");
  const [parentId, setParentId] = useState(category?.parentId ?? "");
  const [imageKey, setImageKey] = useState<string | null>(category?.imageKey ?? null);
  const [sort, setSort] = useState(String(category?.sort ?? 0));
  const [active, setActive] = useState(category?.active ?? true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const blocked = category ? withDescendants(all, category.id) : new Set<string>();
  const parents = all.filter((c) => !blocked.has(c.id)).sort((a, b) => (labels.get(a.id) ?? "").localeCompare(labels.get(b.id) ?? ""));

  async function save() {
    if (!name.trim()) return setError("Name is required");
    const s = readInt(sort);
    if (s === "bad") return setError("Sort must be a whole number");
    setBusy(true);
    setError(null);
    const body = { name: name.trim(), parentId: parentId || null, imageKey, sort: s ?? 0, ...(category ? { active } : {}) };
    try {
      if (category) await send(`/api/admin/categories/${category.id}`, "PATCH", body);
      else await send("/api/admin/categories", "POST", body);
      onSaved(name.trim());
    } catch (e) {
      setError(errText(e));
      setBusy(false);
    }
  }

  return (
    <Sheet
      title={category ? `Edit ${category.name}` : "Add category"}
      onClose={onClose}
      footer={<SaveBar error={error} busy={busy} onCancel={onClose} onSave={save} label={category ? "Save category" : "Add category"} />}
    >
      <Field label="Name">
        <input className="input" value={name} maxLength={60} onChange={(e) => setName(e.target.value)} />
      </Field>
      <Field label="Sits under" hint="Leave as “Top level” for a main category.">
        <select className="input" value={parentId} onChange={(e) => setParentId(e.target.value)}>
          <option value="">Top level</option>
          {parents.map((c) => (
            <option key={c.id} value={c.id}>
              {labels.get(c.id)}
            </option>
          ))}
        </select>
      </Field>
      <Field label="Image">
        <ImageField value={imageKey} onChange={setImageKey} kind="category-image" maxSide={800} />
      </Field>
      <Field label="Sort" hint="Lower shows first" className="max-w-[10rem]">
        <input className="input" inputMode="numeric" value={sort} onChange={(e) => setSort(e.target.value)} />
      </Field>
      {category && <Toggle checked={active} onChange={setActive} label="Active" hint="Off hides this category from retailers. Its products stay as they are." />}
    </Sheet>
  );
}

function SaveBar({ error, busy, onCancel, onSave, label }: { error: string | null; busy: boolean; onCancel: () => void; onSave: () => void; label: string }) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-2">
      <p className="text-sm text-[#a8281e] min-w-0">{error}</p>
      <div className="flex gap-2 ml-auto">
        <button type="button" className="btn btn-quiet btn-sm" onClick={onCancel} disabled={busy}>
          Cancel
        </button>
        <button type="button" className="btn btn-kesar btn-sm" onClick={onSave} disabled={busy}>
          {busy ? "Saving…" : label}
        </button>
      </div>
    </div>
  );
}

// ───────────────────────────── Brands ─────────────────────────────

function BrandsTab() {
  const { data, error, reload } = useFetch<{ brands: Brand[] }>("/api/admin/brands");
  const [editing, setEditing] = useState<Brand | "new" | null>(null);
  const [flash, setFlash] = useState<string | null>(null);

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm text-[var(--ink-2)]">Retailers can browse and filter by brand.</p>
        <button type="button" className="btn btn-kesar btn-sm" onClick={() => setEditing("new")}>
          <Icon name="plus" className="h-4 w-4" /> Add brand
        </button>
      </div>
      <Flash text={flash} />
      {error && <ErrorBox message={error} onRetry={reload} />}
      {data && (
        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
          {data.brands.map((b) => (
            <button key={b.id} type="button" className="card p-3 flex items-center gap-3 text-left" onClick={() => setEditing(b)}>
              <Thumb imageKey={b.logoKey} className="h-12 w-12" />
              <div className="min-w-0 flex-1">
                <p className={`text-sm font-bold truncate ${b.active ? "" : "text-[var(--muted)]"}`}>{b.name}</p>
                <p className="text-xs text-[var(--muted)]">
                  {b._count.products} product{b._count.products === 1 ? "" : "s"} · sort {b.sort}
                </p>
              </div>
              {!b.active && <ActiveChip active={false} />}
            </button>
          ))}
          {data.brands.length === 0 && <p className="card p-4 text-sm text-[var(--muted)]">No brands yet.</p>}
        </div>
      )}
      {editing && (
        <BrandForm
          brand={editing === "new" ? null : editing}
          onClose={() => setEditing(null)}
          onSaved={(name) => {
            setEditing(null);
            setFlash(`Saved ${name}`);
            reload();
          }}
        />
      )}
    </div>
  );
}

function BrandForm({ brand, onClose, onSaved }: { brand: Brand | null; onClose: () => void; onSaved: (name: string) => void }) {
  const [name, setName] = useState(brand?.name ?? "");
  const [logoKey, setLogoKey] = useState<string | null>(brand?.logoKey ?? null);
  const [sort, setSort] = useState(String(brand?.sort ?? 0));
  const [active, setActive] = useState(brand?.active ?? true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save() {
    if (!name.trim()) return setError("Name is required");
    const s = readInt(sort);
    if (s === "bad") return setError("Sort must be a whole number");
    setBusy(true);
    setError(null);
    const body = { name: name.trim(), logoKey, sort: s ?? 0, ...(brand ? { active } : {}) };
    try {
      if (brand) await send(`/api/admin/brands/${brand.id}`, "PATCH", body);
      else await send("/api/admin/brands", "POST", body);
      onSaved(name.trim());
    } catch (e) {
      setError(errText(e));
      setBusy(false);
    }
  }

  return (
    <Sheet
      title={brand ? `Edit ${brand.name}` : "Add brand"}
      onClose={onClose}
      footer={<SaveBar error={error} busy={busy} onCancel={onClose} onSave={save} label={brand ? "Save brand" : "Add brand"} />}
    >
      <Field label="Name">
        <input className="input" value={name} maxLength={60} onChange={(e) => setName(e.target.value)} />
      </Field>
      <Field label="Logo" hint="A PNG with a clear background works best.">
        <ImageField value={logoKey} onChange={setLogoKey} kind="brand-logo" maxSide={600} />
      </Field>
      <Field label="Sort" hint="Lower shows first" className="max-w-[10rem]">
        <input className="input" inputMode="numeric" value={sort} onChange={(e) => setSort(e.target.value)} />
      </Field>
      {brand && <Toggle checked={active} onChange={setActive} label="Active" hint="Off hides the brand from retailers' brand list." />}
    </Sheet>
  );
}

// ───────────────────────────── HSN ─────────────────────────────

function HsnTab() {
  const { data, error, reload } = useFetch<{ codes: Hsn[] }>("/api/admin/hsn");
  const [code, setCode] = useState("");
  const [description, setDescription] = useState("");
  const [gstRate, setGstRate] = useState("18");
  const [editingCode, setEditingCode] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [flash, setFlash] = useState<string | null>(null);
  const [q, setQ] = useState("");

  function edit(h: Hsn | null) {
    setEditingCode(h?.code ?? null);
    setCode(h?.code ?? "");
    setDescription(h?.description ?? "");
    setGstRate(String(h?.gstRate ?? 18));
    setFormError(null);
  }

  async function save(e: React.FormEvent) {
    e.preventDefault();
    if (!/^\d{4,8}$/.test(code.trim())) return setFormError("HSN code must be 4 to 8 digits");
    setBusy(true);
    setFormError(null);
    try {
      const res = await send<{ code: Hsn; productsUpdated: number }>("/api/admin/hsn", "POST", {
        code: code.trim(),
        gstRate: Number(gstRate),
        description,
      });
      const n = res.productsUpdated;
      setFlash(`Saved HSN ${res.code.code} at ${res.code.gstRate}% GST. ${n === 0 ? "No products needed a change." : `${n} product${n === 1 ? "" : "s"} updated.`}`);
      edit(null);
      reload();
    } catch (err) {
      setFormError(errText(err));
    } finally {
      setBusy(false);
    }
  }

  const query = q.trim().toLowerCase();
  const codes = (data?.codes ?? []).filter((h) => !query || `${h.code} ${h.description ?? ""}`.toLowerCase().includes(query));

  return (
    <div className="space-y-3">
      <form onSubmit={save} className="card p-4 space-y-3">
        <div>
          <p className="font-heading font-bold">{editingCode ? `Change HSN ${editingCode}` : "Add an HSN code"}</p>
          <p className="text-xs text-[var(--muted)]">Every product with this code gets this GST rate, now and when you change it later.</p>
        </div>
        <div className="grid gap-3 grid-cols-2 sm:grid-cols-[9rem_1fr_8rem]">
          <Field label="Code">
            <input
              className="input"
              inputMode="numeric"
              maxLength={8}
              value={code}
              readOnly={!!editingCode}
              onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))}
            />
          </Field>
          <Field label="GST %" className="sm:order-3">
            <select className="input" value={gstRate} onChange={(e) => setGstRate(e.target.value)}>
              {GST_RATES.map((g) => (
                <option key={g} value={String(g)}>
                  {g}%
                </option>
              ))}
            </select>
          </Field>
          <Field label="Description (optional)" className="col-span-2 sm:col-span-1">
            <input className="input" maxLength={160} value={description} placeholder="e.g. Biscuits" onChange={(e) => setDescription(e.target.value)} />
          </Field>
        </div>
        {formError && <p className="text-sm text-[#a8281e]">{formError}</p>}
        <div className="flex gap-2">
          <button type="submit" className="btn btn-kesar btn-sm" disabled={busy}>
            {busy ? "Saving…" : editingCode ? "Save and update products" : "Add code"}
          </button>
          {editingCode && (
            <button type="button" className="btn btn-quiet btn-sm" onClick={() => edit(null)} disabled={busy}>
              Cancel
            </button>
          )}
        </div>
      </form>
      <Flash text={flash} />
      {error && <ErrorBox message={error} onRetry={reload} />}
      {data && (
        <>
          {data.codes.length > 8 && <input className="input" type="search" placeholder="Search code or description" value={q} onChange={(e) => setQ(e.target.value)} />}
          <div className="card overflow-hidden divide-y divide-[var(--line)]">
            {codes.map((h) => (
              <div key={h.id} className="flex items-center gap-3 px-4 py-2.5">
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-bold font-mono">{h.code}</p>
                  <p className="text-xs text-[var(--muted)] truncate">
                    {h.description || "No description"} · {h.products} product{h.products === 1 ? "" : "s"}
                  </p>
                </div>
                <span className="chip chip-mor shrink-0">{h.gstRate}%</span>
                <button type="button" className="btn btn-quiet btn-xs shrink-0" onClick={() => edit(h)}>
                  Edit
                </button>
              </div>
            ))}
            {codes.length === 0 && <p className="px-4 py-6 text-sm text-[var(--muted)]">{query ? "No code matches." : "No HSN codes yet."}</p>}
          </div>
        </>
      )}
    </div>
  );
}

// ───────────────────────────── Banners ─────────────────────────────

const LINK_LABEL: Record<LinkType, string> = {
  product: "Product",
  brand: "Brand",
  category: "Category",
  scheme: "Scheme",
  url: "Web link",
};

function BannersTab() {
  const banners = useFetch<{ banners: Banner[] }>("/api/admin/banners");
  const products = useFetch<{ products: Product[] }>("/api/products");
  const cats = useFetch<{ categories: Category[] }>("/api/admin/categories");
  const brands = useFetch<{ brands: Brand[] }>("/api/admin/brands");
  const schemes = useFetch<{ schemes: SchemeLite[] }>("/api/admin/schemes");
  const regions = useFetch<{ regions: RegionRow[] }>("/api/areas");
  const groups = useFetch<{ groups: GroupRow[] }>("/api/admin/groups");
  const [editing, setEditing] = useState<Banner | "new" | null>(null);
  const [confirmDel, setConfirmDel] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [rowError, setRowError] = useState<{ id: string; message: string } | null>(null);
  const [flash, setFlash] = useState<string | null>(null);
  const [now] = useState(() => Date.now());

  const labels = useMemo(() => categoryLabels(cats.data?.categories ?? []), [cats.data]);
  const targets = useMemo(() => {
    const t: Record<Exclude<LinkType, "url">, Option[]> = {
      product: (products.data?.products ?? []).filter((p) => p.active).map((p) => ({ id: p.id, label: p.name, sub: p.sku })),
      brand: (brands.data?.brands ?? []).map((b) => ({ id: b.id, label: b.name })),
      category: (cats.data?.categories ?? []).map((c) => ({ id: c.id, label: labels.get(c.id) ?? c.name })),
      scheme: (schemes.data?.schemes ?? []).map((s) => ({ id: s.id, label: s.name, sub: s.summary })),
    };
    return t;
  }, [products.data, brands.data, cats.data, schemes.data, labels]);
  const areaOpts = useMemo(() => areaOptions(regions.data?.regions), [regions.data]);
  const groupOpts = useMemo(() => groupOptions(groups.data?.groups), [groups.data]);

  function linkText(b: Banner) {
    if (!b.linkType) return "No link";
    if (b.linkType === "url") return b.linkId ?? "Web link";
    const name = targets[b.linkType].find((o) => o.id === b.linkId)?.label;
    return `${LINK_LABEL[b.linkType]}: ${name ?? "removed"}`;
  }
  function whoText(b: Banner) {
    if (!b.areaIds.length && !b.groupIds.length) return "Everyone";
    const names = [
      ...b.areaIds.map((id) => areaOpts.find((o) => o.id === id)?.label),
      ...b.groupIds.map((id) => groupOpts.find((o) => o.id === id)?.label),
    ].filter(Boolean);
    return names.join(", ") || "Selected retailers";
  }
  function windowText(b: Banner) {
    if (!b.startsAt && !b.endsAt) return "Always";
    return `${b.startsAt ? shortDate(b.startsAt) : "Now"} → ${b.endsAt ? shortDate(b.endsAt) : "no end"}`;
  }

  async function remove(b: Banner) {
    setBusyId(b.id);
    setRowError(null);
    try {
      await send(`/api/admin/banners/${b.id}`, "DELETE");
      setConfirmDel(null);
      setFlash(`Deleted “${b.title}”`);
      banners.reload();
    } catch (e) {
      setRowError({ id: b.id, message: errText(e) });
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm text-[var(--ink-2)]">Banners slide across the top of the retailer&apos;s store.</p>
        <button type="button" className="btn btn-kesar btn-sm" onClick={() => setEditing("new")}>
          <Icon name="plus" className="h-4 w-4" /> Add banner
        </button>
      </div>
      <Flash text={flash} />
      {banners.error && <ErrorBox message={banners.error} onRetry={banners.reload} />}
      {banners.data && (
        <div className="space-y-2">
          {banners.data.banners.map((b) => {
            const ended = b.endsAt && Date.parse(b.endsAt) < now;
            const upcoming = b.startsAt && Date.parse(b.startsAt) > now;
            return (
              <div key={b.id} className="card p-3 space-y-2">
                <div className="flex flex-col gap-3 sm:flex-row">
                  <Thumb imageKey={b.imageKey} className="h-24 w-full sm:h-20 sm:w-36" />
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-1.5">
                      <p className="font-bold truncate">{b.title}</p>
                      {!b.active ? (
                        <ActiveChip active={false} />
                      ) : ended ? (
                        <span className="chip !py-0.5 !px-2 !text-[11.5px]">Ended</span>
                      ) : upcoming ? (
                        <span className="chip chip-genda !py-0.5 !px-2 !text-[11.5px]">Upcoming</span>
                      ) : (
                        <span className="chip chip-mint !py-0.5 !px-2 !text-[11.5px]">Showing</span>
                      )}
                    </div>
                    {b.subtitle && <p className="text-sm text-[var(--ink-2)] truncate">{b.subtitle}</p>}
                    <p className="text-xs text-[var(--muted)] mt-1 break-words">
                      {linkText(b)} · {whoText(b)} · {windowText(b)} · sort {b.sort}
                    </p>
                  </div>
                  <div className="flex gap-2 sm:flex-col sm:items-end shrink-0">
                    <button type="button" className="btn btn-quiet btn-xs" onClick={() => setEditing(b)}>
                      Edit
                    </button>
                    {confirmDel === b.id ? (
                      <>
                        <button type="button" className="btn btn-danger btn-xs" disabled={busyId === b.id} onClick={() => remove(b)}>
                          {busyId === b.id ? "Deleting…" : "Yes, delete"}
                        </button>
                        <button type="button" className="btn btn-quiet btn-xs" onClick={() => setConfirmDel(null)}>
                          Keep
                        </button>
                      </>
                    ) : (
                      <button type="button" className="btn btn-quiet btn-xs" onClick={() => setConfirmDel(b.id)}>
                        <Icon name="trash" className="h-3.5 w-3.5" /> Delete
                      </button>
                    )}
                  </div>
                </div>
                {confirmDel === b.id && <p className="text-xs text-[#a8281e]">This removes the banner for good. Switch it off instead to keep it for later.</p>}
                {rowError?.id === b.id && <p className="text-sm text-[#a8281e]">{rowError.message}</p>}
              </div>
            );
          })}
          {banners.data.banners.length === 0 && <p className="card p-4 text-sm text-[var(--muted)]">No banners yet.</p>}
        </div>
      )}
      {editing && (
        <BannerForm
          banner={editing === "new" ? null : editing}
          targets={targets}
          areaOpts={areaOpts}
          groupOpts={groupOpts}
          onClose={() => setEditing(null)}
          onSaved={(title) => {
            setEditing(null);
            setFlash(`Saved “${title}”`);
            banners.reload();
          }}
        />
      )}
    </div>
  );
}

function BannerForm({
  banner,
  targets,
  areaOpts,
  groupOpts,
  onClose,
  onSaved,
}: {
  banner: Banner | null;
  targets: Record<Exclude<LinkType, "url">, Option[]>;
  areaOpts: Option[];
  groupOpts: Option[];
  onClose: () => void;
  onSaved: (title: string) => void;
}) {
  const [title, setTitle] = useState(banner?.title ?? "");
  const [subtitle, setSubtitle] = useState(banner?.subtitle ?? "");
  const [imageKey, setImageKey] = useState<string | null>(banner?.imageKey ?? null);
  const [linkType, setLinkType] = useState<LinkType | "">(banner?.linkType ?? "");
  const [linkId, setLinkId] = useState(banner?.linkId ?? "");
  const [areaIds, setAreaIds] = useState<string[]>(banner?.areaIds ?? []);
  const [groupIds, setGroupIds] = useState<string[]>(banner?.groupIds ?? []);
  const [startsAt, setStartsAt] = useState(isoToLocal(banner?.startsAt));
  const [endsAt, setEndsAt] = useState(isoToLocal(banner?.endsAt));
  const [sort, setSort] = useState(String(banner?.sort ?? 0));
  const [active, setActive] = useState(banner?.active ?? true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save() {
    if (!title.trim()) return setError("Title is required");
    if (linkType === "url" && !/^https:\/\/\S+$/.test(linkId.trim())) return setError("Web links must start with https://");
    if (linkType && linkType !== "url" && !linkId) return setError(`Choose the ${LINK_LABEL[linkType].toLowerCase()} to open`);
    if (startsAt && endsAt && startsAt > endsAt) return setError("The banner ends before it starts");
    setBusy(true);
    setError(null);
    const body = {
      title: title.trim(),
      subtitle,
      imageKey,
      linkType: linkType || null,
      linkId: linkType ? linkId.trim() : null,
      areaIds,
      groupIds,
      startsAt: localToIso(startsAt),
      endsAt: localToIso(endsAt),
      sort: intOr(sort, 0),
      active,
    };
    try {
      if (banner) await send(`/api/admin/banners/${banner.id}`, "PATCH", body);
      else await send("/api/admin/banners", "POST", body);
      onSaved(title.trim());
    } catch (e) {
      setError(errText(e));
      setBusy(false);
    }
  }

  return (
    <Sheet
      title={banner ? "Edit banner" : "Add banner"}
      onClose={onClose}
      footer={<SaveBar error={error} busy={busy} onCancel={onClose} onSave={save} label={banner ? "Save banner" : "Add banner"} />}
    >
      <Field label="Title">
        <input className="input" value={title} maxLength={80} onChange={(e) => setTitle(e.target.value)} />
      </Field>
      <Field label="Subtitle (optional)">
        <input className="input" value={subtitle} maxLength={160} onChange={(e) => setSubtitle(e.target.value)} />
      </Field>
      <Field label="Image" hint="Wide pictures (about 3:1) look best.">
        <ImageField value={imageKey} onChange={setImageKey} kind="banner" maxSide={1600} wide />
      </Field>

      <section className="card p-4 space-y-3">
        <p className="font-heading font-bold">When tapped, open</p>
        <select
          className="input"
          value={linkType}
          onChange={(e) => {
            setLinkType(e.target.value as LinkType | "");
            setLinkId("");
          }}
        >
          <option value="">Nothing (just a banner)</option>
          {(Object.keys(LINK_LABEL) as LinkType[]).map((k) => (
            <option key={k} value={k}>
              {LINK_LABEL[k]}
            </option>
          ))}
        </select>
        {linkType === "url" && (
          <input className="input" placeholder="https://" value={linkId} autoCapitalize="none" onChange={(e) => setLinkId(e.target.value)} />
        )}
        {linkType && linkType !== "url" && (
          <select className="input" value={linkId} onChange={(e) => setLinkId(e.target.value)}>
            <option value="">Choose…</option>
            {targets[linkType].map((o) => (
              <option key={o.id} value={o.id}>
                {o.label}
                {o.sub ? ` — ${o.sub}` : ""}
              </option>
            ))}
          </select>
        )}
      </section>

      <section className="card p-4 space-y-3">
        <div>
          <p className="font-heading font-bold">Who sees it</p>
          <p className="text-xs text-[var(--muted)]">Leave both empty for every retailer.</p>
        </div>
        <Field label="Areas">
          <MultiPick options={areaOpts} value={areaIds} onChange={setAreaIds} placeholder="Search areas" emptyText="All areas" />
        </Field>
        <Field label="Retailer groups">
          <MultiPick options={groupOpts} value={groupIds} onChange={setGroupIds} placeholder="Search groups" emptyText="All groups" />
        </Field>
      </section>

      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Starts" hint="Blank = from now">
          <input className="input" type="datetime-local" value={startsAt} onChange={(e) => setStartsAt(e.target.value)} />
        </Field>
        <Field label="Ends" hint="Blank = no end">
          <input className="input" type="datetime-local" value={endsAt} onChange={(e) => setEndsAt(e.target.value)} />
        </Field>
      </div>
      <div className="grid gap-3 grid-cols-[8rem_1fr] items-end">
        <Field label="Sort" hint="Lower shows first">
          <input className="input" inputMode="numeric" value={sort} onChange={(e) => setSort(e.target.value)} />
        </Field>
        <div className="pb-6">
          <Toggle checked={active} onChange={setActive} label="Active" />
        </div>
      </div>
    </Sheet>
  );
}
