"use client";

import { Suspense, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import Icon from "@/components/Icon";
import { formatINR } from "@/lib/money";
import type { CatalogueProduct, OfferedScheme, PriceSource } from "@/lib/pricing";
import {
  ActiveChip,
  ErrorBox,
  Field,
  Flash,
  MarginText,
  MultiPick,
  SearchPick,
  Sheet,
  TabBar,
  errText,
  groupOptions,
  margin,
  readRupees,
  retailerOptions,
  rupeeText,
  send,
  shortDate,
  useFetch,
  type GroupRow,
  type RetailerRow,
} from "@/components/admin/AdminKit";

type PriceList = { id: string; name: string; description: string | null; active: boolean; _count: { items: number; retailers: number } };
type ProductLite = { id: string; name: string; sku: string; unit: string; price: number; mrp: number; gstRate: number; active: boolean };
type GroupDetail = { id: string; name: string; description: string | null; members: { id: string; outletName: string; area: { name: string } | null }[] };
type RetailerPricing = {
  id: string;
  outletName: string;
  priceListId: string | null;
  area: { id: string; name: string };
  groups: { id: string; name: string }[];
  prices: {
    productId: string;
    price: number;
    note: string | null;
    updatedAt: string;
    product: { name: string; sku: string; price: number; mrp: number; gstRate: number };
  }[];
};
type ViewAs = {
  retailer: { id: string; outletName: string; area: string; priceList: string | null };
  products: CatalogueProduct[];
  offers: OfferedScheme[];
};

const TABS = [
  { key: "lists", label: "Price lists" },
  { key: "groups", label: "Retailer groups" },
  { key: "retailers", label: "Retailer rates" },
] as const;
type Tab = (typeof TABS)[number]["key"];

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

export default function PricingPage() {
  return (
    <Suspense fallback={<p className="text-sm text-[var(--muted)]">Loading…</p>}>
      <Pricing />
    </Suspense>
  );
}

function Pricing() {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const raw = params.get("tab");
  const tab: Tab = TABS.some((t) => t.key === raw) ? (raw as Tab) : "lists";
  const retailerId = params.get("r");

  function go(t: Tab, r?: string | null) {
    const qs = new URLSearchParams();
    if (t !== "lists") qs.set("tab", t);
    if (r) qs.set("r", r);
    const s = qs.toString();
    router.replace(s ? `${pathname}?${s}` : pathname, { scroll: false });
  }

  return (
    <div className="space-y-5">
      <div>
        <p className="page-kick">Catalogue</p>
        <h1 className="page-title">Pricing</h1>
        <p className="page-sub">
          Each retailer pays their own special rate if you set one, else their price list&apos;s rate, else the product&apos;s default rate.
        </p>
      </div>
      <TabBar tabs={TABS} value={tab} onChange={(t) => go(t, t === "retailers" ? retailerId : null)} />
      {tab === "lists" && <ListsTab />}
      {tab === "groups" && <GroupsTab />}
      {tab === "retailers" && <RetailersTab retailerId={retailerId} onPick={(id) => go("retailers", id)} />}
    </div>
  );
}

// ───────────────────────────── Price lists ─────────────────────────────

function ListsTab() {
  const router = useRouter();
  const { data, error, reload } = useFetch<{ lists: PriceList[] }>("/api/admin/price-lists");
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [copyFrom, setCopyFrom] = useState("");
  const [busy, setBusy] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [open, setOpen] = useState(false);

  async function create(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) return setFormError("Name is required");
    setBusy(true);
    setFormError(null);
    try {
      const res = await send<{ list: { id: string } }>("/api/admin/price-lists", "POST", {
        name: name.trim(),
        description,
        copyFrom: copyFrom || undefined,
      });
      router.push(`/admin/pricing/${res.list.id}`);
    } catch (err) {
      setFormError(errText(err));
      setBusy(false);
    }
  }

  const lists = data?.lists ?? [];

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm text-[var(--ink-2)]">A price list is a set of rates you give a type of retailer, e.g. “Wholesale” or “Modern trade”.</p>
        {!open && (
          <button type="button" className="btn btn-kesar btn-sm" onClick={() => setOpen(true)}>
            <Icon name="plus" className="h-4 w-4" /> New price list
          </button>
        )}
      </div>

      {open && (
        <form onSubmit={create} className="card p-4 space-y-3">
          <p className="font-heading font-bold">New price list</p>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Name">
              <input className="input" value={name} maxLength={60} autoFocus onChange={(e) => setName(e.target.value)} />
            </Field>
            <Field label="Copy rates from (optional)">
              <select className="input" value={copyFrom} onChange={(e) => setCopyFrom(e.target.value)}>
                <option value="">Start empty (default rates)</option>
                {lists.map((l) => (
                  <option key={l.id} value={l.id}>
                    {l.name} ({plural(l._count.items, "rate")})
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Description (optional)" className="sm:col-span-2">
              <input className="input" value={description} maxLength={200} onChange={(e) => setDescription(e.target.value)} />
            </Field>
          </div>
          {formError && <p className="text-sm text-[#a8281e]">{formError}</p>}
          <div className="flex gap-2">
            <button type="submit" className="btn btn-kesar btn-sm" disabled={busy}>
              {busy ? "Creating…" : "Create and set rates"}
            </button>
            <button type="button" className="btn btn-quiet btn-sm" disabled={busy} onClick={() => setOpen(false)}>
              Cancel
            </button>
          </div>
        </form>
      )}

      {error && <ErrorBox message={error} onRetry={reload} />}
      {!data && !error && <p className="text-sm text-[var(--muted)]">Loading…</p>}
      {data && (
        <div className="card overflow-hidden divide-y divide-[var(--line)]">
          {lists.map((l) => (
            <Link key={l.id} href={`/admin/pricing/${l.id}`} className="flex items-center gap-3 px-4 py-3 hover:bg-black/[0.03]">
              <span className="icon-tile bg-[#e1eeec] text-mor">
                <Icon name="rupee" />
              </span>
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-1.5">
                  <p className="font-bold truncate">{l.name}</p>
                  {!l.active && <ActiveChip active={false} />}
                </div>
                <p className="text-xs text-[var(--muted)] truncate">
                  {plural(l._count.items, "product rate")} · {plural(l._count.retailers, "retailer")}
                  {l.description && ` · ${l.description}`}
                </p>
              </div>
              <Icon name="arrow" className="h-4 w-4 text-[var(--muted)] shrink-0" />
            </Link>
          ))}
          {lists.length === 0 && <p className="px-4 py-6 text-sm text-[var(--muted)]">No price lists yet. Every retailer pays the default rates.</p>}
        </div>
      )}
    </div>
  );
}

// ───────────────────────────── Groups ─────────────────────────────

function GroupsTab() {
  const groups = useFetch<{ groups: GroupRow[] }>("/api/admin/groups");
  const users = useFetch<{ retailers: RetailerRow[] }>("/api/admin/users");
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [busy, setBusy] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);
  const [flash, setFlash] = useState<string | null>(null);

  async function create(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) return setFormError("Name is required");
    setBusy(true);
    setFormError(null);
    try {
      const res = await send<{ group: { id: string } }>("/api/admin/groups", "POST", { name: name.trim(), description });
      setName("");
      setDescription("");
      groups.reload();
      setOpenId(res.group.id);
    } catch (err) {
      setFormError(errText(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-3">
      <p className="text-sm text-[var(--ink-2)]">
        Groups are lists of retailers you target together — for schemes, banners and who can see a product. A retailer can be in many groups.
      </p>
      <form onSubmit={create} className="card p-4 space-y-3">
        <p className="font-heading font-bold">New group</p>
        <div className="grid gap-3 sm:grid-cols-[1fr_1.4fr_auto] sm:items-end">
          <Field label="Name">
            <input className="input" value={name} maxLength={60} placeholder="e.g. Top 50 outlets" onChange={(e) => setName(e.target.value)} />
          </Field>
          <Field label="Description (optional)">
            <input className="input" value={description} maxLength={200} onChange={(e) => setDescription(e.target.value)} />
          </Field>
          <button type="submit" className="btn btn-kesar btn-sm !min-h-[44px]" disabled={busy}>
            {busy ? "Adding…" : "Add group"}
          </button>
        </div>
        {formError && <p className="text-sm text-[#a8281e]">{formError}</p>}
      </form>
      <Flash text={flash} />
      {groups.error && <ErrorBox message={groups.error} onRetry={groups.reload} />}
      {groups.data && (
        <div className="card overflow-hidden divide-y divide-[var(--line)]">
          {groups.data.groups.map((g) => (
            <button key={g.id} type="button" className="flex w-full items-center gap-3 px-4 py-3 text-left hover:bg-black/[0.03]" onClick={() => setOpenId(g.id)}>
              <span className="icon-tile bg-[var(--kesar-tint)] text-[var(--kesar-text)]">
                <Icon name="users" />
              </span>
              <div className="min-w-0 flex-1">
                <p className="font-bold truncate">{g.name}</p>
                <p className="text-xs text-[var(--muted)] truncate">
                  {plural(g._count.members, "retailer")}
                  {g.description && ` · ${g.description}`}
                </p>
              </div>
              <Icon name="edit" className="h-4 w-4 text-[var(--muted)] shrink-0" />
            </button>
          ))}
          {groups.data.groups.length === 0 && <p className="px-4 py-6 text-sm text-[var(--muted)]">No groups yet.</p>}
        </div>
      )}
      {openId && (
        <GroupSheet
          id={openId}
          retailers={users.data?.retailers ?? []}
          onClose={() => setOpenId(null)}
          onChanged={groups.reload}
          onDeleted={(n) => {
            setOpenId(null);
            setFlash(`Deleted group “${n}”`);
            groups.reload();
          }}
        />
      )}
    </div>
  );
}

function GroupSheet({
  id,
  retailers,
  onClose,
  onChanged,
  onDeleted,
}: {
  id: string;
  retailers: RetailerRow[];
  onClose: () => void;
  onChanged: () => void;
  onDeleted: (name: string) => void;
}) {
  const { data, error, reload } = useFetch<{ group: GroupDetail }>(`/api/admin/groups/${id}`);
  const g = data?.group;
  const [name, setName] = useState<string | null>(null);
  const [description, setDescription] = useState<string | null>(null);
  const [adding, setAdding] = useState<string[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [confirmDel, setConfirmDel] = useState(false);
  const [q, setQ] = useState("");

  const nameV = name ?? g?.name ?? "";
  const descV = description ?? g?.description ?? "";
  const metaDirty = !!g && (nameV.trim() !== g.name || descV.trim() !== (g.description ?? ""));
  const memberIds = new Set(g?.members.map((m) => m.id) ?? []);
  const options = retailerOptions(retailers.filter((r) => !memberIds.has(r.id)));

  async function patch(body: Record<string, unknown>, label: string, done: string) {
    setBusy(label);
    setMsg(null);
    try {
      await send(`/api/admin/groups/${id}`, "PATCH", body);
      setMsg({ ok: true, text: done });
      reload();
      onChanged();
      return true;
    } catch (e) {
      setMsg({ ok: false, text: errText(e) });
      return false;
    } finally {
      setBusy(null);
    }
  }

  async function remove() {
    setBusy("delete");
    setMsg(null);
    try {
      await send(`/api/admin/groups/${id}`, "DELETE");
      onDeleted(g?.name ?? "");
    } catch (e) {
      setMsg({ ok: false, text: errText(e) });
      setConfirmDel(false);
      setBusy(null);
    }
  }

  const query = q.trim().toLowerCase();
  const members = (g?.members ?? []).filter((m) => !query || `${m.outletName} ${m.area?.name ?? ""}`.toLowerCase().includes(query));

  return (
    <Sheet title={g ? g.name : "Group"} onClose={onClose}>
      {error && <ErrorBox message={error} onRetry={reload} />}
      {!g && !error && <p className="text-sm text-[var(--muted)]">Loading…</p>}
      {g && (
        <>
          {msg && (msg.ok ? <Flash text={msg.text} /> : <p className="text-sm text-[#a8281e]">{msg.text}</p>)}
          <section className="card p-4 space-y-3">
            <Field label="Name">
              <input className="input" value={nameV} maxLength={60} onChange={(e) => setName(e.target.value)} />
            </Field>
            <Field label="Description">
              <input className="input" value={descV} maxLength={200} onChange={(e) => setDescription(e.target.value)} />
            </Field>
            <button
              type="button"
              className="btn btn-mor btn-sm"
              disabled={!metaDirty || !nameV.trim() || busy !== null}
              onClick={async () => {
                if (await patch({ name: nameV.trim(), description: descV }, "meta", "Name saved")) {
                  setName(null);
                  setDescription(null);
                }
              }}
            >
              {busy === "meta" ? "Saving…" : "Save name"}
            </button>
          </section>

          <section className="card p-4 space-y-3">
            <p className="font-heading font-bold">Add retailers</p>
            <MultiPick options={options} value={adding} onChange={setAdding} placeholder="Search outlet, owner, phone or area" />
            <button
              type="button"
              className="btn btn-kesar btn-sm"
              disabled={!adding.length || busy !== null}
              onClick={async () => {
                if (await patch({ add: adding }, "add", `Added ${plural(adding.length, "retailer")}`)) setAdding([]);
              }}
            >
              {busy === "add" ? "Adding…" : adding.length ? `Add ${plural(adding.length, "retailer")}` : "Add"}
            </button>
          </section>

          <section className="space-y-2">
            <div className="flex items-center justify-between gap-2">
              <p className="font-heading font-bold">{plural(g.members.length, "member")}</p>
            </div>
            {g.members.length > 8 && <input className="input !py-2" type="search" placeholder="Search members" value={q} onChange={(e) => setQ(e.target.value)} />}
            <div className="card overflow-hidden divide-y divide-[var(--line)]">
              {members.map((m) => (
                <div key={m.id} className="flex items-center gap-3 px-4 py-2.5">
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-bold truncate">{m.outletName}</p>
                    <p className="text-xs text-[var(--muted)] truncate">{m.area?.name}</p>
                  </div>
                  <button
                    type="button"
                    className="btn btn-quiet btn-xs shrink-0"
                    disabled={busy !== null}
                    onClick={() => patch({ remove: [m.id] }, `rm-${m.id}`, `Removed ${m.outletName}`)}
                  >
                    {busy === `rm-${m.id}` ? "Removing…" : "Remove"}
                  </button>
                </div>
              ))}
              {members.length === 0 && <p className="px-4 py-4 text-sm text-[var(--muted)]">{query ? "No member matches." : "No retailers in this group yet."}</p>}
            </div>
          </section>

          <section className="pt-2 border-t border-[var(--line)] space-y-2">
            {confirmDel ? (
              <div className="rounded-xl bg-[#fde4e1] p-3 space-y-2">
                <p className="text-sm text-[#a8281e]">Delete “{g.name}”? Retailers stay; only the group goes.</p>
                <div className="flex gap-2">
                  <button type="button" className="btn btn-danger btn-sm !bg-white" disabled={busy !== null} onClick={remove}>
                    {busy === "delete" ? "Deleting…" : "Yes, delete group"}
                  </button>
                  <button type="button" className="btn btn-quiet btn-sm" onClick={() => setConfirmDel(false)}>
                    Keep
                  </button>
                </div>
              </div>
            ) : (
              <button type="button" className="btn btn-danger btn-sm" onClick={() => setConfirmDel(true)}>
                <Icon name="trash" className="h-4 w-4" /> Delete group
              </button>
            )}
          </section>
        </>
      )}
    </Sheet>
  );
}

// ───────────────────────────── Retailer rates ─────────────────────────────

function RetailersTab({ retailerId, onPick }: { retailerId: string | null; onPick: (id: string | null) => void }) {
  const users = useFetch<{ retailers: RetailerRow[] }>("/api/admin/users");
  const options = useMemo(() => retailerOptions(users.data?.retailers), [users.data]);

  return (
    <div className="space-y-4">
      <div className="card p-4 space-y-2">
        <p className="font-heading font-bold">Retailer</p>
        {users.error && <p className="text-sm text-[#a8281e]">{users.error}</p>}
        <SearchPick options={options} value={retailerId} onChange={onPick} placeholder={users.data ? "Search outlet, owner, phone or area" : "Loading retailers…"} />
        <p className="text-xs text-[var(--muted)]">Set their price list, groups and special rates, then check what they see.</p>
      </div>
      {retailerId && <RetailerPanel key={retailerId} id={retailerId} />}
    </div>
  );
}

type RateRow = { productId: string; name: string; sku: string; base: number; mrp: number; gstRate: number; price: string; note: string; orig: { price: number; note: string } | null };

function RetailerPanel({ id }: { id: string }) {
  const pricing = useFetch<{ retailer: RetailerPricing }>(`/api/admin/retailers/${id}/pricing`);
  const lists = useFetch<{ lists: PriceList[] }>("/api/admin/price-lists");
  const groups = useFetch<{ groups: GroupRow[] }>("/api/admin/groups");
  const products = useFetch<{ products: ProductLite[] }>("/api/products");
  const [version, setVersion] = useState(0);
  const [flash, setFlash] = useState<string | null>(null);

  const r = pricing.data?.retailer;

  if (pricing.error) return <ErrorBox message={pricing.error} onRetry={pricing.reload} />;
  if (!r) return <p className="text-sm text-[var(--muted)]">Loading…</p>;

  const saved = (text: string) => {
    pricing.reload();
    setVersion((v) => v + 1);
    setFlash(text);
  };

  return (
    <div className="space-y-4">
      <Flash text={flash} />
      <ListAndGroups key={`lg-${r.priceListId}-${r.groups.map((g) => g.id).join()}`} r={r} lists={lists.data?.lists ?? []} groups={groups.data?.groups ?? []} onSaved={saved} />
      <SpecialRates key={`sr-${r.prices.map((p) => `${p.productId}:${p.price}:${p.note}`).join()}`} r={r} products={products.data?.products ?? []} onSaved={saved} />
      <ViewAsPanel retailerId={id} version={version} />
    </div>
  );
}

function ListAndGroups({ r, lists, groups, onSaved }: { r: RetailerPricing; lists: PriceList[]; groups: GroupRow[]; onSaved: (text: string) => void }) {
  const [listId, setListId] = useState(r.priceListId ?? "");
  const [groupIds, setGroupIds] = useState(r.groups.map((g) => g.id));
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const origGroups = r.groups.map((g) => g.id).sort().join();
  const dirty = listId !== (r.priceListId ?? "") || [...groupIds].sort().join() !== origGroups;
  const gOpts = groupOptions(groups);
  // Keep names for groups the retailer is in even before the group list loads.
  for (const g of r.groups) if (!gOpts.some((o) => o.id === g.id)) gOpts.push({ id: g.id, label: g.name });

  async function save() {
    setBusy(true);
    setMsg(null);
    try {
      await send(`/api/admin/retailers/${r.id}/pricing`, "PATCH", { priceListId: listId || null, groupIds });
      onSaved(`Saved price list and groups for ${r.outletName}`);
    } catch (e) {
      setMsg({ ok: false, text: errText(e) });
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="card p-4 space-y-3">
      <div>
        <p className="font-heading font-bold">{r.outletName}</p>
        <p className="text-xs text-[var(--muted)]">{r.area.name}</p>
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Price list" hint="Rates in this list replace the default rate for this retailer.">
          <select className="input" value={listId} onChange={(e) => setListId(e.target.value)}>
            <option value="">None — default rates</option>
            {lists.map((l) => (
              <option key={l.id} value={l.id}>
                {l.name}
                {l.active ? "" : " (off — default rates apply)"}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Groups">
          <MultiPick options={gOpts} value={groupIds} onChange={setGroupIds} placeholder="Search groups" emptyText="In no group" />
        </Field>
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <button type="button" className="btn btn-mor btn-sm" disabled={!dirty || busy} onClick={save}>
          {busy ? "Saving…" : "Save list and groups"}
        </button>
        {msg && (msg.ok ? <Flash text={msg.text} /> : <p className="text-sm text-[#a8281e]">{msg.text}</p>)}
      </div>
    </section>
  );
}

function SpecialRates({ r, products, onSaved }: { r: RetailerPricing; products: ProductLite[]; onSaved: (text: string) => void }) {
  const [rows, setRows] = useState<RateRow[]>(() =>
    r.prices.map((p) => ({
      productId: p.productId,
      name: p.product.name,
      sku: p.product.sku,
      base: p.product.price,
      mrp: p.product.mrp,
      gstRate: p.product.gstRate,
      price: rupeeText(p.price),
      note: p.note ?? "",
      orig: { price: p.price, note: p.note ?? "" },
    }))
  );
  const [removed, setRemoved] = useState<string[]>([]);
  const [pick, setPick] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const taken = new Set(rows.map((x) => x.productId));
  const options = products.filter((p) => p.active && !taken.has(p.id)).map((p) => ({ id: p.id, label: p.name, sub: `${p.sku} · default ${formatINR(p.price)} / ${p.unit}` }));

  function add(id: string | null) {
    const p = products.find((x) => x.id === id);
    if (!p) return;
    setRows((rs) => [...rs, { productId: p.id, name: p.name, sku: p.sku, base: p.price, mrp: p.mrp, gstRate: p.gstRate, price: rupeeText(p.price), note: "", orig: null }]);
    setRemoved((rm) => rm.filter((x) => x !== p.id));
    setPick(null);
    setMsg(null);
  }

  const edit = (pid: string, k: "price" | "note", v: string) => {
    setRows((rs) => rs.map((x) => (x.productId === pid ? { ...x, [k]: v } : x)));
    setMsg(null);
  };

  const changes = (): { productId: string; price: number | null; note?: string }[] | string => {
    const out: { productId: string; price: number | null; note?: string }[] = removed.map((productId) => ({ productId, price: null }));
    for (const x of rows) {
      const p = readRupees(x.price);
      if (p === null || p === "bad") return `Enter a rate in rupees for ${x.name}, or remove it`;
      if (!x.orig || x.orig.price !== p || x.orig.note !== x.note.trim()) out.push({ productId: x.productId, price: p, note: x.note.trim() });
    }
    return out;
  };
  const c = changes();
  const dirty = typeof c === "string" || c.length > 0;

  async function save() {
    const list = changes();
    if (typeof list === "string") return setMsg({ ok: false, text: list });
    setBusy(true);
    setMsg(null);
    try {
      await send(`/api/admin/retailers/${r.id}/pricing`, "PATCH", { prices: list });
      onSaved(`Saved ${plural(list.length, "special rate change")} for ${r.outletName}`);
    } catch (e) {
      setMsg({ ok: false, text: errText(e) });
      setBusy(false);
    }
  }

  return (
    <section className="card p-4 space-y-3">
      <div>
        <p className="font-heading font-bold">Special rates</p>
        <p className="text-xs text-[var(--muted)]">Rates only for {r.outletName}. They win over the price list and the default rate.</p>
      </div>
      {rows.length > 0 && (
        <div className="divide-y divide-[var(--line)] rounded-xl border border-[var(--line)] bg-white/60">
          {rows.map((x) => {
            const p = readRupees(x.price);
            const m = typeof p === "number" ? margin(p, x.gstRate, x.mrp) : null;
            const diff = typeof p === "number" && x.base > 0 ? Math.round(((p - x.base) / x.base) * 1000) / 10 : null;
            const changed = !x.orig || x.orig.price !== p || x.orig.note !== x.note.trim();
            return (
              <div key={x.productId} className={`p-3 space-y-2 ${changed ? "bg-[var(--genda-tint)]/50" : ""}`}>
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="text-sm font-bold truncate">{x.name}</p>
                    <p className="text-xs text-[var(--muted)]">
                      {x.sku} · default {formatINR(x.base)} · MRP {formatINR(x.mrp)}
                    </p>
                  </div>
                  <button
                    type="button"
                    className="btn btn-quiet btn-xs !px-2 shrink-0"
                    aria-label={`Remove special rate for ${x.name}`}
                    onClick={() => {
                      setRows((rs) => rs.filter((y) => y.productId !== x.productId));
                      if (x.orig) setRemoved((rm) => [...rm, x.productId]);
                    }}
                  >
                    <Icon name="trash" className="h-3.5 w-3.5" />
                  </button>
                </div>
                <div className="grid grid-cols-[7rem_1fr] gap-2 items-center">
                  <input className="input !py-2" inputMode="decimal" aria-label="Special rate in rupees" value={x.price} onChange={(e) => edit(x.productId, "price", e.target.value)} />
                  <input className="input !py-2" placeholder="Note (why this rate)" maxLength={120} value={x.note} onChange={(e) => edit(x.productId, "note", e.target.value)} />
                </div>
                <p className="text-xs text-[var(--ink-2)]">
                  {diff !== null && (
                    <span className={diff < 0 ? "text-[var(--mint-text)] font-semibold" : diff > 0 ? "text-[#a8281e] font-semibold" : ""}>
                      {diff === 0 ? "Same as default" : `${diff > 0 ? "+" : ""}${diff}% vs default`}
                    </span>
                  )}{" "}
                  · margin <MarginText value={m} />
                </p>
              </div>
            );
          })}
        </div>
      )}
      {rows.length === 0 && <p className="text-sm text-[var(--muted)]">No special rates. They pay their price list or default rates.</p>}
      {removed.length > 0 && <p className="text-xs text-[var(--ink-2)]">{plural(removed.length, "special rate")} will be removed when you save.</p>}
      <Field label="Add a special rate">
        <SearchPick options={options} value={pick} onChange={add} placeholder="Search product" />
      </Field>
      <div className="flex flex-wrap items-center gap-3">
        <button type="button" className="btn btn-kesar btn-sm" disabled={!dirty || busy} onClick={save}>
          {busy ? "Saving…" : "Save special rates"}
        </button>
        {msg && (msg.ok ? <Flash text={msg.text} /> : <p className="text-sm text-[#a8281e]">{msg.text}</p>)}
      </div>
    </section>
  );
}

const SOURCE: Record<PriceSource, { label: string; chip: string }> = {
  retailer: { label: "Special rate", chip: "chip-kesar" },
  list: { label: "Price list", chip: "chip-mor" },
  default: { label: "Default", chip: "" },
};

function ViewAsPanel({ retailerId, version }: { retailerId: string; version: number }) {
  const [data, setData] = useState<ViewAs | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [q, setQ] = useState("");
  const [source, setSource] = useState<PriceSource | "">("");
  const [limit, setLimit] = useState(100);

  useEffect(() => {
    let live = true;
    fetch(`/api/catalogue?retailerId=${encodeURIComponent(retailerId)}`)
      .then(async (res) => {
        const d = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(d.error ?? "Could not load what this retailer sees");
        if (live) {
          setData(d);
          setError(null);
        }
      })
      .catch((e) => live && setError(errText(e)));
    return () => {
      live = false;
    };
  }, [retailerId, version]);

  const counts = useMemo(() => {
    const c: Record<PriceSource, number> = { retailer: 0, list: 0, default: 0 };
    for (const p of data?.products ?? []) c[p.priceSource] += 1;
    return c;
  }, [data]);

  const shown = useMemo(() => {
    const query = q.trim().toLowerCase();
    return (data?.products ?? []).filter(
      (p) => (!source || p.priceSource === source) && (!query || `${p.name} ${p.sku} ${p.search}`.toLowerCase().includes(query))
    );
  }, [data, q, source]);

  return (
    <section className="rounded-2xl border-2 border-mor/30 bg-white/50 p-4 space-y-3">
      <div className="flex items-start gap-3">
        <span className="icon-tile bg-mor text-white">
          <Icon name="eye" />
        </span>
        <div className="min-w-0">
          <p className="font-heading font-bold">View as this retailer</p>
          <p className="text-xs text-[var(--muted)]">
            Exactly the rates and offers their store shows right now. Products hidden from them by visibility rules are not listed.
          </p>
        </div>
      </div>
      {error && <p className="text-sm text-[#a8281e]">{error}</p>}
      {!data && !error && <p className="text-sm text-[var(--muted)]">Loading…</p>}
      {data && (
        <>
          <div className="flex flex-wrap gap-1.5 text-xs">
            <span className="chip">{data.retailer.outletName}</span>
            <span className="chip">{data.retailer.area}</span>
            <span className={`chip ${data.retailer.priceList ? "chip-mor" : ""}`}>Price list: {data.retailer.priceList ?? "none"}</span>
          </div>

          <div className="flex gap-2 overflow-x-auto pb-1">
            {(
              [
                ["", `All ${data.products.length}`],
                ["retailer", `Special rate ${counts.retailer}`],
                ["list", `Price list ${counts.list}`],
                ["default", `Default ${counts.default}`],
              ] as const
            ).map(([k, label]) => (
              <button
                key={k}
                type="button"
                onClick={() => setSource(k)}
                className={`shrink-0 rounded-full px-3 py-1.5 text-xs font-medium ${
                  source === k ? "bg-gradient-to-br from-mor to-[#0c3634] text-white" : "bg-black/5 text-foreground/60"
                }`}
              >
                {label}
              </button>
            ))}
          </div>
          <input className="input !py-2" type="search" placeholder="Search their products" value={q} onChange={(e) => setQ(e.target.value)} />

          <div className="card overflow-hidden">
            <table className="hidden md:table w-full text-sm">
              <thead>
                <tr className="text-left text-xs text-[var(--muted)] border-b border-[var(--line)]">
                  <th className="px-4 py-2.5 font-semibold">Product</th>
                  <th className="px-2 py-2.5 font-semibold text-right">Default</th>
                  <th className="px-2 py-2.5 font-semibold text-right">Their rate</th>
                  <th className="px-2 py-2.5 font-semibold">From</th>
                  <th className="px-4 py-2.5 font-semibold text-right">Margin</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[var(--line)]">
                {shown.slice(0, limit).map((p) => (
                  <tr key={p.id}>
                    <td className="px-4 py-2.5">
                      <p className="font-bold">{p.name}</p>
                      <p className="text-xs text-[var(--muted)]">
                        {p.sku} · MRP {formatINR(p.mrp)} · GST {p.gstRate}%
                      </p>
                    </td>
                    <td className={`px-2 py-2.5 text-right whitespace-nowrap ${p.price !== p.basePrice ? "line-through text-[var(--muted)]" : "text-[var(--ink-2)]"}`}>
                      {formatINR(p.basePrice)}
                    </td>
                    <td className="px-2 py-2.5 text-right font-bold whitespace-nowrap">
                      {formatINR(p.price)}
                      <span className="block text-xs font-normal text-[var(--muted)]">/ {p.unit}</span>
                    </td>
                    <td className="px-2 py-2.5">
                      <span className={`chip !py-0.5 !px-2 !text-[11.5px] ${SOURCE[p.priceSource].chip}`}>{SOURCE[p.priceSource].label}</span>
                    </td>
                    <td className="px-4 py-2.5 text-right">
                      <MarginText value={p.margin} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <div className="md:hidden divide-y divide-[var(--line)]">
              {shown.slice(0, limit).map((p) => (
                <div key={p.id} className="px-4 py-3">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="text-sm font-bold truncate">{p.name}</p>
                      <p className="text-xs text-[var(--muted)]">
                        {p.sku} · MRP {formatINR(p.mrp)}
                      </p>
                    </div>
                    <div className="text-right shrink-0">
                      <p className="text-sm font-bold">{formatINR(p.price)}</p>
                      {p.price !== p.basePrice && <p className="text-xs line-through text-[var(--muted)]">{formatINR(p.basePrice)}</p>}
                    </div>
                  </div>
                  <div className="mt-1 flex items-center gap-2 text-xs">
                    <span className={`chip !py-0.5 !px-2 !text-[11.5px] ${SOURCE[p.priceSource].chip}`}>{SOURCE[p.priceSource].label}</span>
                    <span>
                      margin <MarginText value={p.margin} />
                    </span>
                  </div>
                </div>
              ))}
            </div>
            {shown.length === 0 && <p className="px-4 py-5 text-sm text-[var(--muted)]">Nothing here.</p>}
            {shown.length > limit && (
              <div className="flex items-center justify-between gap-2 px-4 py-3 border-t border-[var(--line)] text-xs text-[var(--muted)]">
                <span>
                  Showing {limit} of {shown.length}
                </span>
                <button type="button" className="btn btn-quiet btn-xs" onClick={() => setLimit((l) => l + 100)}>
                  Show more
                </button>
              </div>
            )}
          </div>

          <div className="space-y-2">
            <p className="font-heading font-bold">Offers they get</p>
            {data.offers.length === 0 && <p className="text-sm text-[var(--muted)]">No schemes running for this retailer.</p>}
            {data.offers.map((o) => (
              <div key={o.id} className="card p-3 flex flex-wrap items-center gap-2">
                <span className="icon-tile bg-[var(--kesar-tint)] text-[var(--kesar-text)] !h-9 !w-9">
                  <Icon name="percent" />
                </span>
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-bold">{o.name}</p>
                  <p className="text-xs text-[var(--ink-2)]">
                    {o.summary}
                    {o.endsAt && ` · till ${shortDate(String(o.endsAt))}`}
                  </p>
                </div>
                {o.coupon && <span className="chip chip-genda">Needs coupon</span>}
              </div>
            ))}
          </div>
        </>
      )}
    </section>
  );
}
