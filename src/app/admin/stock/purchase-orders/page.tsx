"use client";

import { use, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import Icon from "@/components/Icon";
import StockNav from "@/components/stock/StockNav";
import { formatINR } from "@/lib/money";
import {
  ErrorBox,
  Field,
  SearchPick,
  Sheet,
  TabBar,
  errText,
  readRupees,
  rupeeText,
  send,
  shortDate,
  useFetch,
  type Option,
} from "@/components/admin/AdminKit";

type PoStatus = "DRAFT" | "SENT" | "PARTLY_RECEIVED" | "RECEIVED" | "CANCELLED";

type PoRow = {
  id: string;
  number: string;
  status: PoStatus;
  supplier: { id: string; name: string };
  expectedDate: string | null;
  note: string | null;
  createdAt: string;
  sentAt: string | null;
  lines: number;
  units: number;
  received: number;
  value: number;
};

type Supplier = { id: string; name: string; active: boolean; _count: { products: number; purchaseOrders: number } };

type StockProduct = {
  id: string;
  name: string;
  sku: string;
  unit: string;
  caseUnit: string | null;
  caseSize: number | null;
  lastCost: number | null;
  available: number;
  supplier: { id: string; name: string } | null;
};

type PoDetail = {
  po: {
    id: string;
    number: string;
    status: PoStatus;
    supplierId: string;
    supplier: { id: string; name: string };
    expectedDate: string | null;
    note: string | null;
    lines: { id: string; productId: string; quantity: number; unitCost: number | null }[];
  };
};

const STATUS: Record<PoStatus, { label: string; chip: string }> = {
  DRAFT: { label: "Draft", chip: "chip" },
  SENT: { label: "Sent", chip: "chip chip-kesar" },
  PARTLY_RECEIVED: { label: "Part received", chip: "chip chip-genda" },
  RECEIVED: { label: "Received", chip: "chip chip-mint" },
  CANCELLED: { label: "Cancelled", chip: "chip st-cancelled" },
};

function PoChip({ status }: { status: PoStatus }) {
  return <span className={`${STATUS[status].chip} !py-0.5 !px-2 !text-[11.5px]`}>{STATUS[status].label}</span>;
}

/** @db.Date ISO ("2026-11-20T00:00:00.000Z") → "20 Nov 2026". */
const dayText = (iso: string | null) =>
  iso ? new Date(`${iso.slice(0, 10)}T00:00:00.000Z`).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" }) : "";

const one = (v: string | string[] | undefined) => (typeof v === "string" ? v : undefined);

const TABS = [
  { key: "open", label: "Open" },
  { key: "all", label: "All" },
] as const;

export default function PurchaseOrdersPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const sp = use(searchParams);
  const router = useRouter();
  const [tab, setTab] = useState<"open" | "all">("open");
  const [supplierId, setSupplierId] = useState(one(sp.supplierId) ?? "");
  const [sheet, setSheet] = useState<{ mode: "new"; supplierId?: string } | { mode: "edit"; id: string } | null>(() => {
    const edit = one(sp.edit);
    if (edit) return { mode: "edit", id: edit };
    if (one(sp.new) === "1") return { mode: "new", supplierId: one(sp.supplierId) };
    return null;
  });

  const query = new URLSearchParams();
  if (tab === "open") query.set("open", "1");
  if (supplierId) query.set("supplierId", supplierId);
  const { data, error, reload } = useFetch<{ orders: PoRow[] }>(`/api/purchase-orders?${query}`);
  const suppliers = useFetch<{ suppliers: Supplier[] }>("/api/suppliers");

  function closeSheet() {
    setSheet(null);
    try {
      window.history.replaceState(null, "", "/admin/stock/purchase-orders");
    } catch {
      /* address bar only */
    }
  }

  const orders = data?.orders ?? [];
  const supplierList = suppliers.data?.suppliers ?? [];

  return (
    <div className="space-y-5 pb-28">
      <div className="space-y-3">
        <div className="page-head">
          <div className="min-w-0">
            <p className="page-kick">Stock</p>
            <h1 className="page-title">Purchase orders</h1>
            <p className="page-sub">Orders you place with your suppliers.</p>
          </div>
          <button type="button" className="btn btn-kesar btn-sm !min-h-[44px]" onClick={() => setSheet({ mode: "new", supplierId: supplierId || undefined })}>
            <Icon name="plus" className="h-4 w-4" /> New purchase order
          </button>
        </div>
        <StockNav />
      </div>

      <div className="flex flex-col sm:flex-row sm:items-center gap-3">
        <div className="sm:w-56">
          <TabBar tabs={TABS} value={tab} onChange={setTab} />
        </div>
        {supplierList.length > 1 && (
          <select className="input sm:max-w-xs" aria-label="Supplier" value={supplierId} onChange={(e) => setSupplierId(e.target.value)}>
            <option value="">All suppliers</option>
            {supplierList.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
                {s.active ? "" : " (off)"}
              </option>
            ))}
          </select>
        )}
      </div>

      {error && <ErrorBox message={error} onRetry={reload} />}
      {!data && !error && <p className="text-sm text-[var(--muted)]">Loading…</p>}

      {data && orders.length === 0 && (
        <div className="card p-6 text-center space-y-2">
          <p className="text-sm font-semibold">{tab === "open" ? "No open purchase orders" : "No purchase orders yet"}</p>
          <p className="text-sm text-[var(--muted)]">
            Make one here, or draft them in one go from the{" "}
            <Link href="/admin/stock/reorder" className="font-semibold text-[var(--kesar-text)]">
              reorder list
            </Link>
            .
          </p>
        </div>
      )}

      {orders.length > 0 && (
        <div className="card overflow-hidden">
          <div className="hidden md:grid grid-cols-[minmax(0,1.2fr)_minmax(0,1.5fr)_7rem_8rem_7.5rem] gap-3 px-4 py-2 text-xs font-semibold text-[var(--muted)] border-b border-[var(--line)]">
            <span>Number</span>
            <span>Supplier</span>
            <span>Expected</span>
            <span className="text-right">Received</span>
            <span className="text-right">Value</span>
          </div>
          <ul className="divide-y divide-[var(--line)]">
            {orders.map((o) => (
              <li key={o.id}>
                <PoListRow o={o} />
              </li>
            ))}
          </ul>
        </div>
      )}

      {sheet?.mode === "new" && (
        <PoSheet
          initial={{ supplierId: sheet.supplierId ?? "", expectedDate: "", note: "", lines: [] }}
          onClose={closeSheet}
          onSaved={(id) => router.push(`/admin/stock/purchase-orders/${id}`)}
        />
      )}
      {sheet?.mode === "edit" && <EditLoader id={sheet.id} onClose={closeSheet} onSaved={(id) => router.push(`/admin/stock/purchase-orders/${id}`)} />}
    </div>
  );
}

function PoListRow({ o }: { o: PoRow }) {
  const receivedText = o.status === "DRAFT" || o.status === "SENT" ? `${o.units} ordered` : `${o.received} of ${o.units}`;
  return (
    <Link href={`/admin/stock/purchase-orders/${o.id}`} className="block px-4 py-3 hover:bg-black/[0.03] transition">
      {/* Phone */}
      <div className="md:hidden flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="flex flex-wrap items-center gap-1.5">
            <span className="font-semibold text-sm break-all">{o.number}</span>
            <PoChip status={o.status} />
          </p>
          <p className="text-sm truncate mt-0.5">{o.supplier.name}</p>
          <p className="text-xs text-[var(--muted)]">
            {shortDate(o.createdAt)}
            {o.expectedDate ? ` · expected ${dayText(o.expectedDate)}` : ""}
          </p>
        </div>
        <div className="text-right shrink-0">
          <p className="font-semibold text-sm">{o.value ? formatINR(o.value) : "—"}</p>
          <p className="text-[11px] text-[var(--muted)]">
            {o.lines} line{o.lines === 1 ? "" : "s"} · {receivedText}
          </p>
        </div>
      </div>
      {/* Desktop */}
      <div className="hidden md:grid grid-cols-[minmax(0,1.2fr)_minmax(0,1.5fr)_7rem_8rem_7.5rem] gap-3 items-center text-sm">
        <div className="min-w-0">
          <p className="font-semibold truncate">{o.number}</p>
          <PoChip status={o.status} />
        </div>
        <div className="min-w-0">
          <p className="truncate">{o.supplier.name}</p>
          <p className="text-xs text-[var(--muted)] truncate">
            Made {shortDate(o.createdAt)} · {o.lines} line{o.lines === 1 ? "" : "s"}
          </p>
        </div>
        <span className="text-[var(--ink-2)]">{o.expectedDate ? dayText(o.expectedDate) : "—"}</span>
        <span className="text-right text-[var(--ink-2)]">{receivedText}</span>
        <span className="text-right font-semibold">{o.value ? formatINR(o.value) : "—"}</span>
      </div>
    </Link>
  );
}

// ───────────────────────────── new / edit sheet ─────────────────────────────

/** One product per line (the server refuses a product twice), so productId is the key. */
type LineDraft = { productId: string; qty: string; cases: boolean; cost: string };
type Initial = { id?: string; number?: string; supplierId: string; expectedDate: string; note: string; lines: LineDraft[] };

function EditLoader({ id, onClose, onSaved }: { id: string; onClose: () => void; onSaved: (id: string) => void }) {
  const { data, error } = useFetch<PoDetail>(`/api/purchase-orders/${id}`);
  if (!data) {
    return (
      <Sheet title="Edit purchase order" onClose={onClose}>
        {error ? <p className="text-sm text-[#a8281e]">{error}</p> : <p className="text-sm text-[var(--muted)]">Loading…</p>}
      </Sheet>
    );
  }
  const { po } = data;
  if (po.status !== "DRAFT") {
    return (
      <Sheet title={`Edit ${po.number}`} onClose={onClose}>
        <p className="text-sm text-[var(--ink-2)]">Only a draft purchase order can be changed. This one is {STATUS[po.status].label.toLowerCase()}.</p>
      </Sheet>
    );
  }
  return (
    <PoSheet
      initial={{
        id: po.id,
        number: po.number,
        supplierId: po.supplierId,
        expectedDate: po.expectedDate ? po.expectedDate.slice(0, 10) : "",
        note: po.note ?? "",
        lines: po.lines.map((l) => ({ productId: l.productId, qty: String(l.quantity), cases: false, cost: rupeeText(l.unitCost) })),
      }}
      onClose={onClose}
      onSaved={onSaved}
    />
  );
}

function PoSheet({ initial, onClose, onSaved }: { initial: Initial; onClose: () => void; onSaved: (id: string) => void }) {
  const editing = !!initial.id;
  const suppliers = useFetch<{ suppliers: Supplier[] }>("/api/suppliers");
  const stock = useFetch<{ products: StockProduct[] }>("/api/stock");
  const [supplierId, setSupplierId] = useState(initial.supplierId);
  const [expectedDate, setExpectedDate] = useState(initial.expectedDate);
  const [note, setNote] = useState(initial.note);
  const [lines, setLines] = useState<LineDraft[]>(initial.lines);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const products = useMemo(() => stock.data?.products ?? [], [stock.data]);
  const byId = useMemo(() => new Map(products.map((p) => [p.id, p])), [products]);
  const activeSuppliers = (suppliers.data?.suppliers ?? []).filter((s) => s.active || s.id === supplierId);
  const supplierName = activeSuppliers.find((s) => s.id === supplierId)?.name;

  const options: Option[] = useMemo(() => {
    const taken = new Set(lines.map((l) => l.productId));
    const free = products.filter((p) => !taken.has(p.id));
    const mine = free.filter((p) => supplierId && p.supplier?.id === supplierId);
    const rest = free.filter((p) => !(supplierId && p.supplier?.id === supplierId));
    const opt = (p: StockProduct): Option => ({
      id: p.id,
      label: p.name,
      sub: [p.sku, `${p.available} ${p.unit} available`, p.supplier ? (p.supplier.id === supplierId ? "usual supplier" : p.supplier.name) : null]
        .filter(Boolean)
        .join(" · "),
    });
    return [...mine.map(opt), ...rest.map(opt)];
  }, [products, lines, supplierId]);

  function addProduct(id: string | null) {
    if (!id) return;
    const p = byId.get(id);
    setLines((ls) => [...ls, { productId: id, qty: "", cases: !!(p?.caseSize && p.caseSize > 1), cost: rupeeText(p?.lastCost) }]);
    setError(null);
  }
  const patch = (productId: string, d: Partial<LineDraft>) => {
    setLines((ls) => ls.map((l) => (l.productId === productId ? { ...l, ...d } : l)));
    setError(null);
  };

  // Totals and request lines.
  let problem: string | null = null;
  let total = 0;
  const body: { productId: string; quantity: number; unitCost: number | null }[] = [];
  for (const l of lines) {
    const p = byId.get(l.productId);
    const name = p?.name ?? "A product";
    const n = Number(l.qty);
    const quantity = l.cases && p?.caseSize ? n * p.caseSize : n;
    const cost = readRupees(l.cost);
    if (!l.qty.trim() || !Number.isInteger(n) || n <= 0) {
      problem ??= `${name}: enter the quantity`;
      continue;
    }
    if (cost === "bad") {
      problem ??= `${name}: cost must be in rupees`;
      continue;
    }
    total += quantity * (cost ?? 0);
    body.push({ productId: l.productId, quantity, unitCost: cost });
  }

  async function save() {
    if (!supplierId) return setError("Pick the supplier");
    if (!lines.length) return setError("Add at least one product");
    if (problem) return setError(problem);
    setBusy(true);
    setError(null);
    try {
      if (initial.id) {
        await send(`/api/purchase-orders/${initial.id}`, "PATCH", { expectedDate: expectedDate || null, note: note.trim() || null, lines: body });
        onSaved(initial.id);
      } else {
        const r = await send<{ result: { id: string } }>("/api/purchase-orders", "POST", {
          supplierId,
          expectedDate: expectedDate || null,
          note: note.trim() || null,
          lines: body,
        });
        onSaved(r.result.id);
      }
    } catch (e) {
      setError(errText(e));
      setBusy(false);
    }
  }

  const loading = !suppliers.data || !stock.data;
  const loadError = suppliers.error || stock.error;

  return (
    <Sheet
      wide
      title={editing ? `Edit ${initial.number}` : "New purchase order"}
      onClose={onClose}
      footer={
        <div className="space-y-2">
          <div className="flex items-center justify-between gap-2 text-sm">
            <span className="text-[var(--muted)]">
              {lines.length} product{lines.length === 1 ? "" : "s"} · before GST
            </span>
            <span className="font-heading font-bold text-lg">{formatINR(total)}</span>
          </div>
          {error && <p className="text-sm text-[#a8281e]">{error}</p>}
          <div className="flex gap-2 justify-end">
            <button type="button" className="btn btn-quiet" onClick={onClose} disabled={busy}>
              Cancel
            </button>
            <button type="button" className="btn btn-kesar" onClick={save} disabled={busy || loading}>
              {busy ? "Saving…" : editing ? "Save draft" : "Save as draft"}
            </button>
          </div>
        </div>
      }
    >
      {loadError && <p className="text-sm text-[#a8281e]">{loadError}</p>}
      {loading && !loadError && <p className="text-sm text-[var(--muted)]">Loading…</p>}
      {!loading && (
        <>
          {editing ? (
            <div>
              <p className="text-sm font-medium text-[var(--ink-2)] mb-1">Supplier</p>
              <p className="text-sm font-bold">{supplierName ?? "Supplier"}</p>
            </div>
          ) : activeSuppliers.length === 0 ? (
            <div className="rounded-2xl bg-[var(--genda-tint)] p-3 text-sm text-[var(--genda-text)]">
              Add a supplier first.{" "}
              <Link href="/admin/stock/suppliers" className="font-bold underline">
                Suppliers
              </Link>
            </div>
          ) : (
            <Field label="Supplier">
              <select className="input" value={supplierId} onChange={(e) => setSupplierId(e.target.value)}>
                <option value="">Pick a supplier</option>
                {activeSuppliers.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </select>
            </Field>
          )}
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Expected by" hint="Optional">
              <input className="input" type="date" value={expectedDate} onChange={(e) => setExpectedDate(e.target.value)} />
            </Field>
            <Field label="Note for the supplier" hint="Optional. Prints on the order.">
              <input className="input" maxLength={500} value={note} onChange={(e) => setNote(e.target.value)} />
            </Field>
          </div>

          <div className="space-y-2">
            <p className="text-sm font-medium text-[var(--ink-2)]">Products</p>
            {lines.length > 0 && (
              <ul className="space-y-2">
                {lines.map((l) => (
                  <PoLineEditor
                    key={l.productId}
                    l={l}
                    p={byId.get(l.productId)}
                    onPatch={(d) => patch(l.productId, d)}
                    onRemove={() => setLines((ls) => ls.filter((x) => x.productId !== l.productId))}
                  />
                ))}
              </ul>
            )}
            <SearchPick
              options={options}
              value={null}
              onChange={addProduct}
              placeholder={lines.length ? "Add another product" : supplierId ? "Search products (this supplier's first)" : "Search products"}
            />
          </div>
        </>
      )}
    </Sheet>
  );
}

function PoLineEditor({ l, p, onPatch, onRemove }: { l: LineDraft; p: StockProduct | undefined; onPatch: (d: Partial<LineDraft>) => void; onRemove: () => void }) {
  const caseSize = p?.caseSize && p.caseSize > 1 ? p.caseSize : null;
  const n = Number(l.qty);
  const units = l.cases && caseSize && Number.isInteger(n) ? n * caseSize : Number.isInteger(n) ? n : 0;
  const cost = readRupees(l.cost);
  const amount = typeof cost === "number" && units > 0 ? units * cost : 0;
  const unit = p?.unit ?? "units";
  return (
    <li className="rounded-2xl border border-[var(--line)] bg-white p-3 space-y-2">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="text-sm font-bold break-words">{p?.name ?? "Product"}</p>
          <p className="text-xs text-[var(--muted)]">
            {p?.sku}
            {p ? ` · ${p.available} ${unit} available` : ""}
          </p>
        </div>
        <button type="button" className="btn btn-quiet btn-xs !px-2 !min-h-[40px] !min-w-[40px] shrink-0" aria-label={`Remove ${p?.name ?? "line"}`} onClick={onRemove}>
          <Icon name="x" className="h-4 w-4" />
        </button>
      </div>
      <div className="grid gap-2 sm:grid-cols-2">
        <div className="min-w-0">
          <span className="block text-xs font-medium text-[var(--ink-2)] mb-1">Quantity</span>
          <div className="flex gap-2">
            <input
              className="input text-right min-w-0 flex-1"
              inputMode="numeric"
              placeholder="0"
              aria-label={`Quantity of ${p?.name ?? "product"}`}
              value={l.qty}
              onChange={(e) => onPatch({ qty: e.target.value.replace(/\D/g, "") })}
            />
            {caseSize && (
              <UnitSwitch
                cases={l.cases}
                unit={unit}
                caseUnit={p?.caseUnit ?? "case"}
                onChange={(c) => {
                  if (c === l.cases) return;
                  const v = Number(l.qty);
                  const next = !l.qty || !Number.isInteger(v) ? l.qty : c ? (v % caseSize === 0 ? String(v / caseSize) : "") : String(v * caseSize);
                  onPatch({ cases: c, qty: next });
                }}
              />
            )}
          </div>
          <p className="text-[11px] text-[var(--muted)] mt-0.5">
            {l.cases && caseSize ? `= ${units} ${unit} (${caseSize} a ${p?.caseUnit ?? "case"})` : caseSize ? `${unit} (${caseSize} a ${p?.caseUnit ?? "case"})` : unit}
          </p>
        </div>
        <div className="min-w-0">
          <span className="block text-xs font-medium text-[var(--ink-2)] mb-1">Cost per {unit} (₹, before GST)</span>
          <input
            className="input text-right"
            inputMode="decimal"
            placeholder="₹0"
            aria-label={`Cost per ${unit} of ${p?.name ?? "product"}`}
            value={l.cost}
            onChange={(e) => onPatch({ cost: e.target.value.replace(/[^\d.]/g, "") })}
          />
          {amount > 0 && <p className="text-[11px] text-[var(--muted)] mt-0.5 text-right">Line {formatINR(amount)}</p>}
        </div>
      </div>
    </li>
  );
}

function UnitSwitch({ cases, unit, caseUnit, onChange }: { cases: boolean; unit: string; caseUnit: string; onChange: (cases: boolean) => void }) {
  return (
    <span className="inline-flex shrink-0 rounded-xl bg-ink/5 p-1 text-xs font-bold" role="group" aria-label="Count in">
      {[
        { c: false, label: unit },
        { c: true, label: caseUnit },
      ].map((o) => (
        <button
          key={String(o.c)}
          type="button"
          aria-pressed={cases === o.c}
          onClick={() => onChange(o.c)}
          className={`min-h-[36px] min-w-[44px] rounded-lg px-2 max-w-[5.5rem] truncate ${cases === o.c ? "bg-white shadow text-[var(--ink)]" : "text-[var(--muted)]"}`}
        >
          {o.label}
        </button>
      ))}
    </span>
  );
}
