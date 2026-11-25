"use client";

import { useMemo, useState } from "react";
import Icon from "@/components/Icon";
import { formatINR } from "@/lib/money";
import { describeScheme, type SchemeParams } from "@/lib/schemes";
import {
  ErrorBox,
  Field,
  Flash,
  MultiPick,
  SearchPick,
  Sheet,
  Toggle,
  areaOptions,
  errText,
  groupOptions,
  isoToLocal,
  localToIso,
  readInt,
  readRupees,
  retailerOptions,
  rupeeText,
  send,
  shortDate,
  useFetch,
  type GroupRow,
  type Option,
  type RegionRow,
  type RetailerRow,
} from "@/components/admin/AdminKit";

type SchemeType = "BUY_X_GET_Y" | "SLAB" | "PERCENT" | "FLAT";
type State = "running" | "upcoming" | "ended" | "budget_used" | "off";

type Scheme = {
  id: string;
  name: string;
  description: string | null;
  type: SchemeType;
  params: Record<string, unknown>;
  productIds: string[];
  brandIds: string[];
  categoryIds: string[];
  areaIds: string[];
  groupIds: string[];
  retailerIds: string[];
  couponCode: string | null;
  startsAt: string | null;
  endsAt: string | null;
  priority: number;
  stackable: boolean;
  budget: number | null;
  spent: number;
  maxUsesPerRetailer: number | null;
  active: boolean;
  summary: string;
  orders: number;
  freeQty: number;
  state: State;
};

type ProductLite = { id: string; name: string; sku: string; active: boolean };
type Named = { id: string; name: string; parentId?: string | null };

const TYPES: { key: SchemeType; label: string; hint: string }[] = [
  { key: "BUY_X_GET_Y", label: "Buy X get Y", hint: "Free goods for every X bought" },
  { key: "SLAB", label: "Slab", hint: "Bigger order, bigger discount" },
  { key: "PERCENT", label: "Percent off", hint: "A % off the items" },
  { key: "FLAT", label: "Flat ₹ off", hint: "Rupees off the order or per unit" },
];

const STATE: Record<State, { label: string; chip: string }> = {
  running: { label: "Running", chip: "chip-mint" },
  upcoming: { label: "Upcoming", chip: "chip-genda" },
  ended: { label: "Ended", chip: "" },
  budget_used: { label: "Budget used", chip: "chip-kesar" },
  off: { label: "Off", chip: "" },
};

const FILTERS = [
  { key: "all", label: "All" },
  { key: "running", label: "Running" },
  { key: "upcoming", label: "Upcoming" },
  { key: "done", label: "Ended / used" },
  { key: "off", label: "Off" },
] as const;
type Filter = (typeof FILTERS)[number]["key"];

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

// ───────────────────────────── form ─────────────────────────────

type SlabRow = { min: string; kind: "percent" | "amount"; value: string };
type SForm = {
  name: string;
  description: string;
  type: SchemeType | "";
  buyQty: string;
  getQty: string;
  freeMode: "same" | "other";
  freeProductId: string | null;
  maxSets: string;
  basis: "qty" | "value";
  slabs: SlabRow[];
  cap: string;
  percent: string;
  amount: string;
  perUnit: boolean;
  minQty: string;
  minValue: string;
  productIds: string[];
  brandIds: string[];
  categoryIds: string[];
  areaIds: string[];
  groupIds: string[];
  retailerIds: string[];
  couponCode: string;
  startsAt: string;
  endsAt: string;
  priority: string;
  stackable: boolean;
  budget: string;
  maxUses: string;
  active: boolean;
};

const num = (v: unknown) => (typeof v === "number" ? v : null);
const intText = (v: unknown) => (typeof v === "number" ? String(v) : "");

function toForm(s: Scheme | null): SForm {
  const p = (s?.params ?? {}) as Record<string, unknown>;
  const basis = p.basis === "value" ? "value" : "qty";
  const slabs = Array.isArray(p.slabs)
    ? (p.slabs as Record<string, unknown>[]).map((x) => ({
        min: basis === "value" ? rupeeText(num(x.min)) : intText(x.min),
        kind: (typeof x.percent === "number" ? "percent" : "amount") as SlabRow["kind"],
        value: typeof x.percent === "number" ? String(x.percent) : rupeeText(num(x.amount)),
      }))
    : [{ min: "", kind: "percent" as const, value: "" }];
  return {
    name: s?.name ?? "",
    description: s?.description ?? "",
    type: s?.type ?? "",
    buyQty: intText(p.buyQty),
    getQty: intText(p.getQty) || (s ? "" : "1"),
    freeMode: typeof p.freeProductId === "string" && p.freeProductId ? "other" : "same",
    freeProductId: typeof p.freeProductId === "string" ? p.freeProductId : null,
    maxSets: intText(p.maxSets),
    basis,
    slabs,
    cap: rupeeText(num(p.cap)),
    percent: intText(p.percent),
    amount: rupeeText(num(p.amount)),
    perUnit: p.perUnit === true,
    minQty: intText(p.minQty),
    minValue: rupeeText(num(p.minValue)),
    productIds: s?.productIds ?? [],
    brandIds: s?.brandIds ?? [],
    categoryIds: s?.categoryIds ?? [],
    areaIds: s?.areaIds ?? [],
    groupIds: s?.groupIds ?? [],
    retailerIds: s?.retailerIds ?? [],
    couponCode: s?.couponCode ?? "",
    startsAt: isoToLocal(s?.startsAt),
    endsAt: isoToLocal(s?.endsAt),
    priority: String(s?.priority ?? 100),
    stackable: s?.stackable ?? true,
    budget: rupeeText(s?.budget),
    maxUses: intText(s?.maxUsesPerRetailer),
    active: s?.active ?? true,
  };
}

/** Optional whole number (blank = undefined). */
function optCount(s: string, label: string): number | undefined | string {
  const n = readInt(s, 1);
  if (n === "bad") return `${label} must be a whole number of at least 1`;
  return n ?? undefined;
}

/** Optional rupees (blank = undefined). */
function optMoney(s: string, label: string): number | undefined | string {
  const n = readRupees(s);
  if (n === "bad" || n === 0) return `${label} must be an amount above ₹0`;
  return n ?? undefined;
}

function toParams(f: SForm): SchemeParams | string {
  switch (f.type) {
    case "": return "Choose a scheme type";
    case "BUY_X_GET_Y": {
      const buy = readInt(f.buyQty, 1);
      const get = readInt(f.getQty, 1);
      if (typeof buy !== "number") return "Buy quantity must be a whole number of at least 1";
      if (typeof get !== "number") return "Free quantity must be a whole number of at least 1";
      if (f.freeMode === "other" && !f.freeProductId) return "Choose the free product";
      const sets = optCount(f.maxSets, "Most sets");
      if (typeof sets === "string") return sets;
      return { buyQty: buy, getQty: get, freeProductId: f.freeMode === "other" ? f.freeProductId : null, maxSets: sets ?? null };
    }
    case "SLAB": {
      if (!f.slabs.length) return "Add at least one slab";
      const slabs = [];
      for (const [i, r] of f.slabs.entries()) {
        const n = i + 1;
        const min = f.basis === "qty" ? readInt(r.min, 1) : readRupees(r.min);
        if (typeof min !== "number" || min < 1) return `Slab ${n}: enter the ${f.basis === "qty" ? "starting quantity (whole units)" : "starting order value in ₹"}`;
        if (r.kind === "percent") {
          const pct = Number(r.value);
          if (!r.value.trim() || !Number.isFinite(pct) || pct <= 0 || pct > 100) return `Slab ${n}: percent must be more than 0 and at most 100`;
          slabs.push({ min, percent: pct });
        } else {
          const amt = readRupees(r.value);
          if (typeof amt !== "number" || amt < 1) return `Slab ${n}: enter the rupees off`;
          slabs.push({ min, amount: amt });
        }
      }
      if (new Set(slabs.map((s) => s.min)).size !== slabs.length) return "Two slabs start at the same point";
      const cap = optMoney(f.cap, "Cap");
      if (typeof cap === "string") return cap;
      return { basis: f.basis, slabs: slabs.sort((a, b) => a.min - b.min), cap: cap ?? null };
    }
    case "PERCENT": {
      const pct = Number(f.percent);
      if (!f.percent.trim() || !Number.isFinite(pct) || pct <= 0 || pct > 100) return "Percent must be more than 0 and at most 100";
      const cap = optMoney(f.cap, "Cap");
      if (typeof cap === "string") return cap;
      const minQty = optCount(f.minQty, "Minimum quantity");
      if (typeof minQty === "string") return minQty;
      const minValue = optMoney(f.minValue, "Minimum value");
      if (typeof minValue === "string") return minValue;
      return { percent: pct, cap: cap ?? null, ...(minQty ? { minQty } : {}), ...(minValue ? { minValue } : {}) };
    }
    case "FLAT": {
      const amt = readRupees(f.amount);
      if (typeof amt !== "number" || amt < 1) return "Enter the rupees off";
      const minQty = optCount(f.minQty, "Minimum quantity");
      if (typeof minQty === "string") return minQty;
      const minValue = optMoney(f.minValue, "Minimum value");
      if (typeof minValue === "string") return minValue;
      return { amount: amt, perUnit: f.perUnit, ...(minQty ? { minQty } : {}), ...(minValue ? { minValue } : {}) };
    }
  }
}

function toBody(f: SForm, isNew: boolean): Record<string, unknown> | string {
  if (!f.name.trim()) return "Name is required";
  const params = toParams(f);
  if (typeof params === "string") return params;
  const code = f.couponCode.trim().toUpperCase();
  if (code && !/^[A-Z0-9_-]{3,30}$/.test(code)) return "Coupon code: 3–30 letters, digits, - or _";
  if (f.startsAt && f.endsAt && f.startsAt > f.endsAt) return "The scheme ends before it starts";
  const priority = readInt(f.priority);
  if (priority === "bad" || (typeof priority === "number" && priority > 1000)) return "Priority must be 0 to 1000";
  const budget = readRupees(f.budget);
  if (budget === "bad") return "Budget must be an amount in rupees";
  const maxUses = readInt(f.maxUses, 1);
  if (maxUses === "bad") return "Uses per retailer must be a whole number of at least 1";
  return {
    name: f.name.trim(),
    description: f.description,
    ...(isNew ? { type: f.type } : {}),
    params,
    productIds: f.productIds,
    brandIds: f.brandIds,
    categoryIds: f.categoryIds,
    areaIds: f.areaIds,
    groupIds: f.groupIds,
    retailerIds: f.retailerIds,
    couponCode: code,
    startsAt: localToIso(f.startsAt),
    endsAt: localToIso(f.endsAt),
    priority: priority ?? 100,
    stackable: f.stackable,
    budget,
    maxUsesPerRetailer: maxUses,
    active: f.active,
  };
}

/** "Rice, Atta and 3 more" */
function names(ids: string[], opts: Option[], max = 3) {
  const n = ids.map((id) => opts.find((o) => o.id === id)?.label ?? "removed item");
  if (n.length <= max) return n.join(", ");
  return `${n.slice(0, max).join(", ")} and ${n.length - max} more`;
}

// ───────────────────────────── page ─────────────────────────────

export default function SchemesPage() {
  const schemes = useFetch<{ schemes: Scheme[] }>("/api/admin/schemes");
  const products = useFetch<{ products: ProductLite[] }>("/api/products");
  const brands = useFetch<{ brands: Named[] }>("/api/admin/brands");
  const cats = useFetch<{ categories: Named[] }>("/api/admin/categories");
  const regions = useFetch<{ regions: RegionRow[] }>("/api/areas");
  const groups = useFetch<{ groups: GroupRow[] }>("/api/admin/groups");
  const users = useFetch<{ retailers: RetailerRow[] }>("/api/admin/users");
  const [editing, setEditing] = useState<Scheme | "new" | null>(null);
  const [filter, setFilter] = useState<Filter>("all");
  const [flash, setFlash] = useState<string | null>(null);

  const opts = useMemo(() => {
    const catList = cats.data?.categories ?? [];
    const byId = new Map(catList.map((c) => [c.id, c]));
    const catLabel = (c: Named) => {
      const parts = [c.name];
      let p = c.parentId ? byId.get(c.parentId) : undefined;
      for (let n = 0; p && n < 10; n++) {
        parts.unshift(p.name);
        p = p.parentId ? byId.get(p.parentId) : undefined;
      }
      return parts.join(" › ");
    };
    return {
      products: (products.data?.products ?? []).map((p) => ({ id: p.id, label: p.name, sub: `${p.sku}${p.active ? "" : " · inactive"}` })),
      brands: (brands.data?.brands ?? []).map((b) => ({ id: b.id, label: b.name })),
      categories: catList.map((c) => ({ id: c.id, label: catLabel(c) })),
      areas: areaOptions(regions.data?.regions),
      groups: groupOptions(groups.data?.groups),
      retailers: retailerOptions(users.data?.retailers),
    };
  }, [products.data, brands.data, cats.data, regions.data, groups.data, users.data]);

  const all = useMemo(() => schemes.data?.schemes ?? [], [schemes.data]);
  const count = (f: Filter) =>
    all.filter((s) => (f === "all" ? true : f === "done" ? s.state === "ended" || s.state === "budget_used" : s.state === f)).length;
  const shown = all.filter((s) => (filter === "all" ? true : filter === "done" ? s.state === "ended" || s.state === "budget_used" : s.state === filter));

  return (
    <div className="space-y-5">
      <div className="page-head">
        <div>
          <p className="page-kick">Catalogue</p>
          <h1 className="page-title">Schemes</h1>
          <p className="page-sub">Trade offers worked out on the retailer&apos;s cart: free goods, slabs, percent or rupees off.</p>
        </div>
        <button
          type="button"
          className="btn btn-kesar btn-sm"
          onClick={() => {
            setFlash(null);
            setEditing("new");
          }}
        >
          <Icon name="plus" className="h-4 w-4" /> New scheme
        </button>
      </div>

      <div className="flex gap-2 overflow-x-auto pb-1">
        {FILTERS.map((f) => (
          <button
            key={f.key}
            type="button"
            onClick={() => setFilter(f.key)}
            className={`shrink-0 rounded-full px-3 py-1.5 text-xs font-medium ${
              filter === f.key ? "bg-gradient-to-br from-mor to-[var(--mor-mid)] text-white" : "bg-black/5 text-foreground/60"
            }`}
          >
            {f.label}
            {schemes.data && <span className="ml-1 opacity-70">{count(f.key)}</span>}
          </button>
        ))}
      </div>
      <Flash text={flash} />
      {schemes.error && <ErrorBox message={schemes.error} onRetry={schemes.reload} />}
      {!schemes.data && !schemes.error && <p className="text-sm text-[var(--muted)]">Loading…</p>}

      {schemes.data && (
        <div className="space-y-2">
          {shown.map((s) => (
            <SchemeCard key={s.id} s={s} onOpen={() => setEditing(s)} />
          ))}
          {shown.length === 0 && (
            <p className="card p-5 text-sm text-[var(--muted)]">{all.length ? "No scheme in this filter." : "No schemes yet. Press “New scheme” to make one."}</p>
          )}
        </div>
      )}

      {editing && (
        <SchemeForm
          scheme={editing === "new" ? null : editing}
          opts={opts}
          onClose={() => setEditing(null)}
          onSaved={(name, isNew) => {
            setEditing(null);
            setFlash(`${isNew ? "Created" : "Saved"} “${name}”`);
            schemes.reload();
          }}
        />
      )}
    </div>
  );
}

function SchemeCard({ s, onOpen }: { s: Scheme; onOpen: () => void }) {
  const used = s.budget ? Math.min(100, Math.round((s.spent / s.budget) * 100)) : 0;
  return (
    <button type="button" onClick={onOpen} className="card p-4 w-full text-left space-y-2 hover:bg-white/80">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-1.5">
            <p className="font-bold">{s.name}</p>
            <span className={`chip !py-0.5 !px-2 !text-[11.5px] ${STATE[s.state].chip}`}>{STATE[s.state].label}</span>
            {s.couponCode && <span className="chip chip-genda !py-0.5 !px-2 !text-[11.5px] font-mono">{s.couponCode}</span>}
          </div>
          <p className="text-sm text-[var(--ink-2)] mt-0.5 break-words">{s.summary}</p>
        </div>
        <Icon name="edit" className="h-4 w-4 text-[var(--muted)] shrink-0 mt-1" />
      </div>
      <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-[var(--muted)]">
        <span>Priority {s.priority}</span>
        <span>
          {plural(s.orders, "order")}
          {s.freeQty > 0 && ` · ${s.freeQty} free units`}
        </span>
        <span>
          {s.startsAt ? shortDate(s.startsAt) : "Any time"} → {s.endsAt ? shortDate(s.endsAt) : "no end"}
        </span>
        {!s.stackable && <span>Doesn&apos;t stack</span>}
      </div>
      <div className="text-xs">
        {s.budget !== null ? (
          <div className="space-y-1">
            <p className="text-[var(--ink-2)]">
              Spent <span className="font-bold">{formatINR(s.spent, { whole: true })}</span> of {formatINR(s.budget, { whole: true })} budget
            </p>
            <div className="h-1.5 w-full max-w-xs overflow-hidden rounded-full bg-black/5">
              <div className="h-full rounded-full" style={{ width: `${used}%`, background: used >= 100 ? "var(--kesar)" : "var(--mint)" }} />
            </div>
          </div>
        ) : (
          <p className="text-[var(--ink-2)]">
            Spent <span className="font-bold">{formatINR(s.spent, { whole: true })}</span> · no budget cap
          </p>
        )}
      </div>
    </button>
  );
}

type Opts = { products: Option[]; brands: Option[]; categories: Option[]; areas: Option[]; groups: Option[]; retailers: Option[] };

function SchemeForm({ scheme, opts, onClose, onSaved }: { scheme: Scheme | null; opts: Opts; onClose: () => void; onSaved: (name: string, isNew: boolean) => void }) {
  const [f, setF] = useState<SForm>(() => toForm(scheme));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const set = <K extends keyof SForm>(k: K, v: SForm[K]) => {
    setF((x) => ({ ...x, [k]: v }));
    setError(null);
  };
  const setSlab = (i: number, patch: Partial<SlabRow>) => set("slabs", f.slabs.map((r, j) => (j === i ? { ...r, ...patch } : r)));

  const params = toParams(f);

  async function save() {
    const body = toBody(f, !scheme);
    if (typeof body === "string") return setError(body);
    setBusy(true);
    setError(null);
    try {
      if (scheme) await send(`/api/admin/schemes/${scheme.id}`, "PATCH", body);
      else await send("/api/admin/schemes", "POST", body);
      onSaved(f.name.trim(), !scheme);
    } catch (e) {
      setError(errText(e));
      setBusy(false);
    }
  }

  return (
    <Sheet
      title={scheme ? `Edit ${scheme.name}` : "New scheme"}
      onClose={onClose}
      wide
      footer={
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="text-sm text-[var(--risk-text)] min-w-0">{error}</p>
          <div className="flex gap-2 ml-auto">
            <button type="button" className="btn btn-quiet btn-sm" onClick={onClose} disabled={busy}>
              Cancel
            </button>
            <button type="button" className="btn btn-kesar btn-sm" onClick={save} disabled={busy}>
              {busy ? "Saving…" : scheme ? "Save scheme" : "Create scheme"}
            </button>
          </div>
        </div>
      }
    >
      <Preview f={f} params={params} opts={opts} />

      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Name" hint="Retailers see this name.">
          <input className="input" value={f.name} maxLength={80} placeholder="e.g. Diwali biscuit bonanza" onChange={(e) => set("name", e.target.value)} />
        </Field>
        <Field label="Description (optional)">
          <input className="input" value={f.description} maxLength={300} onChange={(e) => set("description", e.target.value)} />
        </Field>
      </div>

      <section className="space-y-2">
        <p className="text-sm font-medium text-[var(--ink-2)]">Type{scheme && " (fixed once created)"}</p>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2" role="radiogroup">
          {TYPES.map((t) => {
            const on = f.type === t.key;
            return (
              <button
                key={t.key}
                type="button"
                role="radio"
                aria-checked={on}
                disabled={!!scheme && !on}
                onClick={() => set("type", t.key)}
                className={`rounded-xl p-3 text-left transition border ${
                  on ? "bg-gradient-to-br from-mor to-[var(--mor-mid)] text-white border-transparent" : "bg-white/70 border-[var(--line)] disabled:opacity-40"
                }`}
              >
                <span className="block text-sm font-bold">{t.label}</span>
                <span className={`block text-[11.5px] ${on ? "text-white/75" : "text-[var(--muted)]"}`}>{t.hint}</span>
              </button>
            );
          })}
        </div>
      </section>

      {f.type === "BUY_X_GET_Y" && (
        <section className="card p-4 space-y-3">
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
            <Field label="Buy (units)">
              <input className="input" inputMode="numeric" value={f.buyQty} placeholder="10" onChange={(e) => set("buyQty", e.target.value)} />
            </Field>
            <Field label="Get free (units)">
              <input className="input" inputMode="numeric" value={f.getQty} placeholder="1" onChange={(e) => set("getQty", e.target.value)} />
            </Field>
            <Field label="Most sets per order" hint="Blank = no limit" className="col-span-2 sm:col-span-1">
              <input className="input" inputMode="numeric" value={f.maxSets} onChange={(e) => set("maxSets", e.target.value)} />
            </Field>
          </div>
          <div className="space-y-2">
            <p className="text-sm font-medium text-[var(--ink-2)]">Free product</p>
            <div className="flex rounded-2xl p-1 bg-ink/5 max-w-md" role="radiogroup">
              {(
                [
                  ["same", "Same product"],
                  ["other", "Another product"],
                ] as const
              ).map(([k, label]) => (
                <button
                  key={k}
                  type="button"
                  role="radio"
                  aria-checked={f.freeMode === k}
                  onClick={() => set("freeMode", k)}
                  className={`flex-1 rounded-xl py-2 text-sm font-bold ${f.freeMode === k ? "bg-gradient-to-br from-mor to-[var(--mor-mid)] text-white" : "text-[var(--ink-2)]"}`}
                >
                  {label}
                </button>
              ))}
            </div>
            {f.freeMode === "other" && (
              <SearchPick options={opts.products} value={f.freeProductId} onChange={(v) => set("freeProductId", v)} placeholder="Search the free product" />
            )}
            <p className="text-xs text-[var(--muted)]">
              {f.freeMode === "same"
                ? "Each product line earns its own free units of that product."
                : "Units of every product in scope add up; the free units are of this product."}
            </p>
          </div>
        </section>
      )}

      {f.type === "SLAB" && (
        <section className="card p-4 space-y-3">
          <div className="flex rounded-2xl p-1 bg-ink/5 max-w-md" role="radiogroup">
            {(
              [
                ["qty", "By quantity"],
                ["value", "By order value"],
              ] as const
            ).map(([k, label]) => (
              <button
                key={k}
                type="button"
                role="radio"
                aria-checked={f.basis === k}
                onClick={() => set("basis", k)}
                className={`flex-1 rounded-xl py-2 text-sm font-bold ${f.basis === k ? "bg-gradient-to-br from-mor to-[var(--mor-mid)] text-white" : "text-[var(--ink-2)]"}`}
              >
                {label}
              </button>
            ))}
          </div>
          <div className="space-y-2">
            {f.slabs.map((r, i) => (
              <div key={i} className="grid grid-cols-[1fr_auto_1fr_auto] items-end gap-2">
                <Field label={i === 0 ? (f.basis === "qty" ? "From units" : "From ₹") : ""}>
                  <input className="input !py-2" inputMode={f.basis === "qty" ? "numeric" : "decimal"} value={r.min} onChange={(e) => setSlab(i, { min: e.target.value })} />
                </Field>
                <select className="input !py-2 !w-auto" aria-label="Kind of discount" value={r.kind} onChange={(e) => setSlab(i, { kind: e.target.value as SlabRow["kind"] })}>
                  <option value="percent">% off</option>
                  <option value="amount">₹ off</option>
                </select>
                <input className="input !py-2" inputMode="decimal" aria-label={r.kind === "percent" ? "Percent off" : "Rupees off"} value={r.value} onChange={(e) => setSlab(i, { value: e.target.value })} />
                <button
                  type="button"
                  className="btn btn-quiet btn-xs !px-2 !min-h-[40px]"
                  aria-label="Remove slab"
                  disabled={f.slabs.length === 1}
                  onClick={() => set("slabs", f.slabs.filter((_, j) => j !== i))}
                >
                  <Icon name="x" className="h-3.5 w-3.5" />
                </button>
              </div>
            ))}
            <button
              type="button"
              className="btn btn-quiet btn-xs"
              disabled={f.slabs.length >= 20}
              onClick={() => set("slabs", [...f.slabs, { min: "", kind: f.slabs[f.slabs.length - 1]?.kind ?? "percent", value: "" }])}
            >
              <Icon name="plus" className="h-3.5 w-3.5" /> Add slab
            </button>
          </div>
          <Field label="Most discount per order ₹ (optional)" className="max-w-xs">
            <input className="input" inputMode="decimal" value={f.cap} onChange={(e) => set("cap", e.target.value)} />
          </Field>
          <p className="text-xs text-[var(--muted)]">
            The highest slab the order reaches applies. {f.basis === "qty" ? "Quantity counts base units of the items in scope." : "Value is the items in scope before GST."}
          </p>
        </section>
      )}

      {f.type === "PERCENT" && (
        <section className="card p-4 grid grid-cols-2 gap-3">
          <Field label="Percent off">
            <input className="input" inputMode="decimal" value={f.percent} placeholder="5" onChange={(e) => set("percent", e.target.value)} />
          </Field>
          <Field label="Most discount ₹" hint="Blank = no cap">
            <input className="input" inputMode="decimal" value={f.cap} onChange={(e) => set("cap", e.target.value)} />
          </Field>
          <Field label="Min. units" hint="Blank = none">
            <input className="input" inputMode="numeric" value={f.minQty} onChange={(e) => set("minQty", e.target.value)} />
          </Field>
          <Field label="Min. value ₹" hint="Before GST">
            <input className="input" inputMode="decimal" value={f.minValue} onChange={(e) => set("minValue", e.target.value)} />
          </Field>
        </section>
      )}

      {f.type === "FLAT" && (
        <section className="card p-4 space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <Field label="Rupees off">
              <input className="input" inputMode="decimal" value={f.amount} placeholder="50" onChange={(e) => set("amount", e.target.value)} />
            </Field>
            <div className="pt-7">
              <Toggle checked={f.perUnit} onChange={(v) => set("perUnit", v)} label="Per unit" hint="Off = once per order" />
            </div>
            <Field label="Min. units" hint="Blank = none">
              <input className="input" inputMode="numeric" value={f.minQty} onChange={(e) => set("minQty", e.target.value)} />
            </Field>
            <Field label="Min. value ₹" hint="Before GST">
              <input className="input" inputMode="decimal" value={f.minValue} onChange={(e) => set("minValue", e.target.value)} />
            </Field>
          </div>
        </section>
      )}

      <section className="card p-4 space-y-3">
        <div>
          <p className="font-heading font-bold">On which items</p>
          <p className="text-xs text-[var(--muted)]">Leave all three empty for the whole cart. Otherwise any item matching one of them counts.</p>
        </div>
        <Field label="Products">
          <MultiPick options={opts.products} value={f.productIds} onChange={(v) => set("productIds", v)} placeholder="Search products" />
        </Field>
        <Field label="Brands">
          <MultiPick options={opts.brands} value={f.brandIds} onChange={(v) => set("brandIds", v)} placeholder="Search brands" />
        </Field>
        <Field label="Categories" hint="Includes the categories under them.">
          <MultiPick options={opts.categories} value={f.categoryIds} onChange={(v) => set("categoryIds", v)} placeholder="Search categories" />
        </Field>
      </section>

      <section className="card p-4 space-y-3">
        <div>
          <p className="font-heading font-bold">For which retailers</p>
          <p className="text-xs text-[var(--muted)]">Leave all three empty for every retailer. Otherwise a retailer in any of them gets it.</p>
        </div>
        <Field label="Areas">
          <MultiPick options={opts.areas} value={f.areaIds} onChange={(v) => set("areaIds", v)} placeholder="Search areas" />
        </Field>
        <Field label="Retailer groups">
          <MultiPick options={opts.groups} value={f.groupIds} onChange={(v) => set("groupIds", v)} placeholder="Search groups" />
        </Field>
        <Field label="Specific retailers">
          <MultiPick options={opts.retailers} value={f.retailerIds} onChange={(v) => set("retailerIds", v)} placeholder="Search outlet, owner, phone" />
        </Field>
      </section>

      <section className="card p-4 space-y-3">
        <p className="font-heading font-bold">Rules</p>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Starts" hint="Blank = straight away">
            <input className="input" type="datetime-local" value={f.startsAt} onChange={(e) => set("startsAt", e.target.value)} />
          </Field>
          <Field label="Ends" hint="Blank = no end">
            <input className="input" type="datetime-local" value={f.endsAt} onChange={(e) => set("endsAt", e.target.value)} />
          </Field>
          <Field label="Coupon code (optional)" hint="Set = applies only when the retailer types this code.">
            <input
              className="input font-mono uppercase"
              value={f.couponCode}
              maxLength={30}
              autoCapitalize="characters"
              onChange={(e) => set("couponCode", e.target.value.toUpperCase().replace(/\s/g, ""))}
            />
          </Field>
          <Field label="Priority" hint="Lower runs first (0–1000).">
            <input className="input" inputMode="numeric" value={f.priority} onChange={(e) => set("priority", e.target.value)} />
          </Field>
          <Field label="Budget ₹ (optional)" hint="Stops once discounts + free goods reach this. Blank = no cap.">
            <input className="input" inputMode="decimal" value={f.budget} onChange={(e) => set("budget", e.target.value)} />
          </Field>
          <Field label="Uses per retailer (optional)" hint="Blank = no limit.">
            <input className="input" inputMode="numeric" value={f.maxUses} onChange={(e) => set("maxUses", e.target.value)} />
          </Field>
        </div>
        <Toggle
          checked={f.stackable}
          onChange={(v) => set("stackable", v)}
          label="Works with other schemes"
          hint="Off: no other scheme applies on the items this one covers — and it skips items an earlier scheme already used."
        />
        <Toggle checked={f.active} onChange={(v) => set("active", v)} label="Active" hint="Off pauses the scheme. Past orders keep what they got." />
      </section>
    </Sheet>
  );
}

function Preview({ f, params, opts }: { f: SForm; params: SchemeParams | string; opts: Opts }) {
  if (!f.type) {
    return <div className="rounded-2xl bg-ink/5 p-4 text-sm text-[var(--muted)]">Pick a type below to start. A plain-words preview will show here.</div>;
  }
  if (typeof params === "string") {
    return (
      <div className="rounded-2xl bg-ink/5 p-4 text-sm">
        <p className="font-bold">Preview</p>
        <p className="text-[var(--muted)] mt-1">{params}</p>
      </div>
    );
  }
  const freeName =
    f.type === "BUY_X_GET_Y" && f.freeMode === "other" && f.freeProductId ? opts.products.find((o) => o.id === f.freeProductId)?.label ?? null : null;
  const headline = describeScheme(f.type, params, freeName);
  const lines: string[] = [];

  if (f.type === "BUY_X_GET_Y") {
    const p = params as { buyQty: number; getQty: number; maxSets: number | null };
    lines.push(
      freeName
        ? `For every ${p.buyQty} units of the items below, the retailer gets ${p.getQty} ${freeName} free.`
        : `For every ${p.buyQty} units of a product, the retailer gets ${p.getQty} more of the same product free.`
    );
    if (p.maxSets) lines.push(`At most ${plural(p.maxSets, "set")} per order.`);
  } else if (f.type === "SLAB") {
    const p = params as { basis: "qty" | "value"; cap: number | null };
    lines.push(`The highest slab the order's ${p.basis === "qty" ? "units" : "value (before GST)"} reaches applies.`);
    if (p.cap) lines.push(`Never more than ${formatINR(p.cap, { whole: true })} off one order.`);
  } else if (f.type === "FLAT") {
    lines.push((params as { perUnit: boolean }).perUnit ? "Taken off for every unit of the items below." : "Taken off once per order.");
  }

  const scoped = f.productIds.length + f.brandIds.length + f.categoryIds.length;
  lines.push(
    scoped
      ? `On: ${[
          f.productIds.length ? names(f.productIds, opts.products) : "",
          f.brandIds.length ? `brand ${names(f.brandIds, opts.brands)}` : "",
          f.categoryIds.length ? `category ${names(f.categoryIds, opts.categories)}` : "",
        ]
          .filter(Boolean)
          .join("; ")}.`
      : "On: the whole cart."
  );
  const who = f.areaIds.length + f.groupIds.length + f.retailerIds.length;
  lines.push(
    who
      ? `For: ${[
          f.areaIds.length ? `retailers in ${names(f.areaIds, opts.areas)}` : "",
          f.groupIds.length ? `group ${names(f.groupIds, opts.groups)}` : "",
          f.retailerIds.length ? names(f.retailerIds, opts.retailers) : "",
        ]
          .filter(Boolean)
          .join("; ")}.`
      : "For: every retailer."
  );
  const start = localToIso(f.startsAt);
  const end = localToIso(f.endsAt);
  lines.push(
    start || end ? `Runs ${start ? `from ${shortDate(start, true)}` : "from now"} ${end ? `until ${shortDate(end, true)}` : "with no end date"}.` : "Runs from now, with no end date."
  );
  const code = f.couponCode.trim();
  if (code) lines.push(`Only when the retailer enters the code ${code}.`);
  const budget = readRupees(f.budget);
  if (typeof budget === "number" && budget > 0) lines.push(`Stops after giving ${formatINR(budget, { whole: true })} in discounts and free goods.`);
  const uses = readInt(f.maxUses, 1);
  if (typeof uses === "number") lines.push(`Each retailer can use it on ${plural(uses, "order")}.`);
  lines.push(f.stackable ? "Other schemes can also apply on the same items." : "No other scheme applies on the items this one covers.");

  return (
    <div className={`rounded-2xl p-4 space-y-1.5 ${f.active ? "panel-dark" : "bg-ink/10"}`}>
      <p className={`text-xs font-bold uppercase tracking-wider ${f.active ? "text-[var(--genda)]" : "text-[var(--muted)]"}`}>
        Preview{f.active ? "" : " · switched off"}
      </p>
      <p className="font-heading font-bold text-lg leading-snug break-words">{headline}</p>
      <ul className={`text-sm space-y-0.5 ${f.active ? "text-white/85" : "text-[var(--ink-2)]"}`}>
        {lines.map((l, i) => (
          <li key={i} className="break-words">
            {l}
          </li>
        ))}
      </ul>
    </div>
  );
}
