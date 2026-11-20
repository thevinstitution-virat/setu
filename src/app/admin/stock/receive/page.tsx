"use client";

import { use, useMemo, useRef, useState } from "react";
import Link from "next/link";
import Icon from "@/components/Icon";
import StockNav from "@/components/stock/StockNav";
import { formatINR } from "@/lib/money";
import { ErrorBox, Field, SearchPick, errText, readRupees, rupeeText, send, useFetch, type Option } from "@/components/admin/AdminKit";

type PoStatus = "DRAFT" | "SENT" | "PARTLY_RECEIVED" | "RECEIVED" | "CANCELLED";
const OPEN: PoStatus[] = ["DRAFT", "SENT", "PARTLY_RECEIVED"];

type Supplier = { id: string; name: string; active: boolean };
type Location = { id: string; kind: "WAREHOUSE" | "VAN" | "DAMAGED"; name: string; isDefault: boolean; active: boolean };
type StockProduct = {
  id: string;
  name: string;
  sku: string;
  unit: string;
  caseUnit: string | null;
  caseSize: number | null;
  trackExpiry: boolean;
  lastCost: number | null;
  available: number;
  supplier: { id: string; name: string } | null;
};
type StockResponse = { settings: { enabled: boolean }; products: StockProduct[] };
type OpenPo = { id: string; number: string; status: PoStatus; expectedDate: string | null; createdAt: string; lines: number; units: number; received: number };
type PoDetail = {
  po: {
    id: string;
    number: string;
    status: PoStatus;
    supplierId: string;
    supplier: { id: string; name: string };
    lines: { id: string; productId: string; quantity: number; unitCost: number | null; receivedQty: number; product: { name: string } }[];
  };
};
type Done = { id: string; number: string; total: number; lines: number; units: number; supplier: string; po: { id: string; number: string } | null };

type Line = { key: string; productId: string; name?: string; qty: string; cases: boolean; batch: string; expiry: string; mfg: string; showMfg: boolean; cost: string; poLeft?: number };

const plural = (n: number, w: string, many = `${w}s`) => `${n} ${n === 1 ? w : many}`;
const one = (v: string | string[] | undefined) => (typeof v === "string" && v ? v : undefined);

export default function ReceivePage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const sp = use(searchParams);
  const [round, setRound] = useState(0);
  const [done, setDone] = useState<Done | null>(null);
  const urlPoId = round === 0 ? one(sp.poId) : undefined;

  function more() {
    setDone(null);
    setRound((r) => r + 1);
    try {
      window.history.replaceState(null, "", "/admin/stock/receive");
    } catch {
      /* address bar only */
    }
    window.scrollTo({ top: 0 });
  }

  return (
    <div className="space-y-5 pb-40">
      <div className="space-y-3">
        <div className="page-head">
          <div className="min-w-0">
            <p className="page-kick">Stock</p>
            <h1 className="page-title">Receive goods</h1>
            <p className="page-sub">Record goods that came in from a supplier, batch by batch.</p>
          </div>
        </div>
        <StockNav />
      </div>

      {done ? (
        <Success done={done} onMore={more} />
      ) : (
        <ReceiveForm
          key={round}
          initialPoId={urlPoId ?? null}
          onDone={(d) => {
            setDone(d);
            window.scrollTo({ top: 0 });
          }}
        />
      )}
    </div>
  );
}

// ───────────────────────────── form ─────────────────────────────

function ReceiveForm({ initialPoId, onDone }: { initialPoId: string | null; onDone: (d: Done) => void }) {
  const suppliers = useFetch<{ suppliers: Supplier[] }>("/api/suppliers");
  const stock = useFetch<StockResponse>("/api/stock");
  const places = useFetch<{ locations: Location[] }>("/api/stock/locations");

  const [supplierChoice, setSupplierChoice] = useState<string | null>(null);
  const [poId, setPoId] = useState<string | null>(initialPoId);
  const poData = useFetch<PoDetail>(poId ? `/api/purchase-orders/${poId}` : null);
  const [locationChoice, setLocationChoice] = useState<string | null>(null);
  const [billNo, setBillNo] = useState("");
  const [billDate, setBillDate] = useState("");
  const [note, setNote] = useState("");
  const [edited, setEdited] = useState<Line[] | null>(null);
  const [tried, setTried] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const keySeq = useRef(0);

  const products = useMemo(() => stock.data?.products ?? [], [stock.data]);
  const byId = useMemo(() => new Map(products.map((p) => [p.id, p])), [products]);

  const po = poData.data && poData.data.po.id === poId ? poData.data.po : null;
  const poOpen = !!po && OPEN.includes(po.status);
  const supplierId = supplierChoice ?? po?.supplierId ?? "";
  const openPos = useFetch<{ orders: OpenPo[] }>(supplierId ? `/api/purchase-orders?open=1&supplierId=${supplierId}` : null);
  const poList = openPos.data?.orders ?? [];

  const warehouses = (places.data?.locations ?? []).filter((l) => l.kind === "WAREHOUSE" && l.active);
  const locationId = locationChoice ?? warehouses.find((w) => w.isDefault)?.id ?? warehouses[0]?.id ?? "";

  /** Lines from the purchase order: what is still to come, at the order's cost. */
  const fromPo = useMemo<Line[]>(() => {
    if (!po || !poOpen) return [];
    return po.lines
      .filter((l) => l.quantity > l.receivedQty)
      .map((l) => {
        const p = byId.get(l.productId);
        const left = l.quantity - l.receivedQty;
        const cs = p?.caseSize && p.caseSize > 1 && left % p.caseSize === 0 ? p.caseSize : null;
        return {
          key: `po:${l.id}`,
          productId: l.productId,
          name: l.product.name,
          qty: String(cs ? left / cs : left),
          cases: !!cs,
          batch: "",
          expiry: "",
          mfg: "",
          showMfg: false,
          cost: rupeeText(l.unitCost ?? p?.lastCost ?? null),
          poLeft: left,
        };
      });
  }, [po, poOpen, byId]);

  const lines = edited ?? fromPo;
  const setLines = (fn: (ls: Line[]) => Line[]) => {
    setEdited(fn(lines));
    setError(null);
  };
  const newKey = () => `n${++keySeq.current}`;

  function pickSupplier(id: string) {
    if (id === supplierId) return;
    setSupplierChoice(id);
    if (poId) {
      setPoId(null);
      setEdited([]);
    }
    setError(null);
  }

  function pickPo(id: string) {
    if (id === (poOpen ? poId : null)) return;
    if (!id) {
      setPoId(null);
      setEdited(lines);
    } else {
      setPoId(id);
      setEdited(null);
    }
    setError(null);
  }

  function addProduct(id: string | null) {
    if (!id) return;
    const p = byId.get(id);
    setLines((ls) => [
      ...ls,
      { key: newKey(), productId: id, qty: "", cases: false, batch: "", expiry: "", mfg: "", showMfg: false, cost: rupeeText(p?.lastCost ?? null) },
    ]);
  }

  const options: Option[] = useMemo(() => {
    const mine = products.filter((p) => supplierId && p.supplier?.id === supplierId);
    const rest = products.filter((p) => !(supplierId && p.supplier?.id === supplierId));
    const opt = (p: StockProduct): Option => ({
      id: p.id,
      label: p.name,
      sub: [p.sku, p.supplier?.id === supplierId ? "usual supplier" : p.supplier?.name, p.trackExpiry ? "needs expiry date" : null].filter(Boolean).join(" · "),
    });
    return [...mine.map(opt), ...rest.map(opt)];
  }, [products, supplierId]);

  // Check lines and build the request.
  const problems = new Map<string, string>();
  let total = 0;
  let units = 0;
  const body: { productId: string; quantity: number; batch: string | null; expiry: string | null; mfgDate: string | null; unitCost: number | null }[] = [];
  for (const l of lines) {
    const p = byId.get(l.productId);
    const n = Number(l.qty);
    const cs = l.cases && p?.caseSize ? p.caseSize : 1;
    const cost = readRupees(l.cost);
    if (!l.qty.trim() || !Number.isInteger(n) || n <= 0) problems.set(l.key, "Enter the quantity");
    else if (p?.trackExpiry && !l.expiry) problems.set(l.key, "Enter the expiry date");
    else if (cost === "bad") problems.set(l.key, "Cost must be in rupees");
    if (problems.has(l.key)) continue;
    const quantity = n * cs;
    units += quantity;
    total += quantity * (typeof cost === "number" ? cost : 0);
    body.push({ productId: l.productId, quantity, batch: l.batch.trim() || null, expiry: l.expiry || null, mfgDate: l.mfg || null, unitCost: typeof cost === "number" ? cost : null });
  }

  const enabled = stock.data?.settings.enabled ?? true;
  const loadError = suppliers.error || stock.error || places.error;
  const loading = !suppliers.data || !stock.data || !places.data;
  const activeSuppliers = (suppliers.data?.suppliers ?? []).filter((s) => s.active);
  const supplierName = activeSuppliers.find((s) => s.id === supplierId)?.name ?? po?.supplier.name ?? "";

  async function save() {
    setTried(true);
    if (!supplierId) return setError("Pick the supplier");
    if (!lines.length) return setError("Add at least one product");
    if (problems.size) {
      const [key, msg] = [...problems.entries()][0];
      const l = lines.find((x) => x.key === key);
      return setError(`${byId.get(l?.productId ?? "")?.name ?? l?.name ?? "A product"}: ${msg.toLowerCase()}`);
    }
    setBusy(true);
    setError(null);
    try {
      const r = await send<{ result: { id: string; number: string; total: number } }>("/api/purchases", "POST", {
        supplierId,
        locationId: locationId || null,
        poId: poOpen ? poId : null,
        billNo: billNo.trim() || null,
        billDate: billDate || null,
        note: note.trim() || null,
        lines: body,
      });
      onDone({
        id: r.result.id,
        number: r.result.number,
        total: r.result.total,
        lines: body.length,
        units,
        supplier: supplierName,
        po: poOpen && po ? { id: po.id, number: po.number } : null,
      });
    } catch (e) {
      setError(errText(e));
      setBusy(false);
    }
  }

  if (loadError) {
    return (
      <ErrorBox
        message={loadError}
        onRetry={() => {
          suppliers.reload();
          stock.reload();
          places.reload();
        }}
      />
    );
  }
  if (loading) return <p className="text-sm text-[var(--muted)]">Loading…</p>;

  return (
    <div className="space-y-4">
      {!enabled && (
        <div className="card p-4 flex items-start gap-3 !bg-[var(--genda-tint)]">
          <Icon name="alert" className="h-5 w-5 shrink-0 text-[var(--genda-text)] mt-0.5" />
          <p className="text-sm text-[var(--genda-text)]">
            Stock tracking is off. Turn it on in{" "}
            <Link href="/admin/settings" className="font-bold underline">
              Settings
            </Link>{" "}
            to receive goods.
          </p>
        </div>
      )}

      {/* Where from */}
      <section className="card p-4 space-y-4">
        {activeSuppliers.length === 0 ? (
          <div className="rounded-2xl bg-[var(--genda-tint)] p-3 text-sm text-[var(--genda-text)]">
            Add a supplier first.{" "}
            <Link href="/admin/stock/suppliers" className="font-bold underline">
              Suppliers
            </Link>
          </div>
        ) : (
          <Field label="Supplier">
            <select className="input" value={supplierId} onChange={(e) => pickSupplier(e.target.value)}>
              <option value="">Pick a supplier</option>
              {activeSuppliers.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
          </Field>
        )}

        {poId && poData.error && <p className="text-sm text-[#a8281e]">Purchase order: {poData.error}</p>}
        {poId && !po && !poData.error && <p className="text-sm text-[var(--muted)]">Loading the purchase order…</p>}
        {po && !poOpen && (
          <p className="rounded-xl bg-[var(--genda-tint)] px-3 py-2 text-sm text-[var(--genda-text)]">
            Purchase order {po.number} is {po.status === "RECEIVED" ? "fully received" : "cancelled"}. These goods will be received without it.
          </p>
        )}

        {supplierId && (
          <Field
            label="Against purchase order"
            hint={poOpen ? "Lines are filled with what is still to come. Change them to match what arrived." : poList.length ? undefined : "No open purchase orders for this supplier."}
          >
            <select className="input" value={poOpen ? (poId ?? "") : ""} disabled={!openPos.data} onChange={(e) => pickPo(e.target.value)}>
              <option value="">No purchase order</option>
              {poOpen && po && !poList.some((o) => o.id === po.id) && <option value={po.id}>{po.number}</option>}
              {poList.map((o) => (
                <option key={o.id} value={o.id}>
                  {o.number} · {o.received ? `${o.received} of ${o.units} received` : `${o.units} ordered`}
                </option>
              ))}
            </select>
          </Field>
        )}

        {warehouses.length > 1 && (
          <Field label="Into warehouse">
            <select className="input" value={locationId} onChange={(e) => setLocationChoice(e.target.value)}>
              {warehouses.map((w) => (
                <option key={w.id} value={w.id}>
                  {w.name}
                  {w.isDefault ? " (vans load here)" : ""}
                </option>
              ))}
            </select>
          </Field>
        )}

        <div className="grid grid-cols-2 gap-3">
          <Field label="Supplier bill no.">
            <input className="input" maxLength={40} autoComplete="off" value={billNo} onChange={(e) => setBillNo(e.target.value)} />
          </Field>
          <Field label="Bill date">
            <input className="input" type="date" value={billDate} onChange={(e) => setBillDate(e.target.value)} />
          </Field>
        </div>
      </section>

      {/* What came in */}
      <section className="space-y-2">
        <div className="flex items-end justify-between gap-2">
          <h2 className="font-heading font-bold text-xl">Goods</h2>
          {lines.length > 0 && <span className="text-sm text-[var(--muted)]">{plural(lines.length, "line")}</span>}
        </div>
        {lines.length === 0 && (!poId || po) && (
          <p className="card p-4 text-sm text-[var(--muted)]">{supplierId ? "Search below to add the products that came in." : "Pick the supplier, then add the products that came in."}</p>
        )}
        <ul className="space-y-2">
          {lines.map((l) => (
            <LineCard
              key={l.key}
              l={l}
              p={byId.get(l.productId)}
              problem={tried ? problems.get(l.key) : undefined}
              onPatch={(d) => setLines((ls) => ls.map((x) => (x.key === l.key ? { ...x, ...d } : x)))}
              onRemove={() => setLines((ls) => ls.filter((x) => x.key !== l.key))}
              onSplit={() =>
                setLines((ls) => {
                  const i = ls.findIndex((x) => x.key === l.key);
                  const copy: Line = { ...l, key: newKey(), qty: "", batch: "", expiry: "", mfg: "", poLeft: undefined };
                  return [...ls.slice(0, i + 1), copy, ...ls.slice(i + 1)];
                })
              }
            />
          ))}
        </ul>
        <div className="card p-3">
          <SearchPick options={options} value={null} onChange={addProduct} placeholder={lines.length ? "Add another product" : "Search products to add"} />
        </div>
      </section>

      <section className="card p-4">
        <Field label="Note" hint="Optional. For example: 2 cartons damaged, sent back.">
          <input className="input" maxLength={300} value={note} onChange={(e) => setNote(e.target.value)} />
        </Field>
      </section>

      <div className="sticky bottom-[5.5rem] md:bottom-3 z-10">
        <div className="card p-3 shadow-xl space-y-2">
          <div className="flex items-center justify-between gap-3">
            <div className="min-w-0">
              <p className="font-heading font-bold text-lg leading-tight">{formatINR(total)}</p>
              <p className="text-xs text-[var(--muted)]">
                {plural(lines.length, "line")} · {units} units · before GST
              </p>
            </div>
            <button type="button" className="btn btn-kesar shrink-0" disabled={busy || !enabled} onClick={save}>
              <Icon name="check" className="h-4 w-4" /> {busy ? "Saving…" : "Save receipt"}
            </button>
          </div>
          {error && <p className="text-sm text-[#a8281e]">{error}</p>}
        </div>
      </div>
    </div>
  );
}

function LineCard({
  l,
  p,
  problem,
  onPatch,
  onRemove,
  onSplit,
}: {
  l: Line;
  p: StockProduct | undefined;
  problem: string | undefined;
  onPatch: (d: Partial<Line>) => void;
  onRemove: () => void;
  onSplit: () => void;
}) {
  const unit = p?.unit ?? "units";
  const caseSize = p?.caseSize && p.caseSize > 1 ? p.caseSize : null;
  const caseUnit = p?.caseUnit ?? "case";
  const n = Number(l.qty);
  const qty = Number.isInteger(n) ? n * (l.cases && caseSize ? caseSize : 1) : 0;
  const cost = readRupees(l.cost);
  const amount = typeof cost === "number" ? qty * cost : 0;
  const needExpiry = !!p?.trackExpiry;
  const name = p?.name ?? l.name ?? "Product";

  return (
    <li className={`card p-3 space-y-3 ${problem ? "ring-2 ring-[#e9a39b]" : ""}`}>
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="text-sm font-bold break-words">{name}</p>
          <p className="text-xs text-[var(--muted)] break-all">
            {p?.sku}
            {l.poLeft !== undefined ? ` · ${l.poLeft} ${unit} to come on the order` : ""}
          </p>
        </div>
        <button type="button" className="btn btn-quiet btn-xs !px-2 !min-h-[40px] !min-w-[40px] shrink-0" aria-label={`Remove ${name}`} onClick={onRemove}>
          <Icon name="x" className="h-4 w-4" />
        </button>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <div className="min-w-0">
          <span className="block text-xs font-medium text-[var(--ink-2)] mb-1">Quantity</span>
          <div className="flex gap-2">
            <input
              className="input text-right min-w-0 flex-1 !text-base"
              inputMode="numeric"
              placeholder="0"
              aria-label={`Quantity of ${name}`}
              value={l.qty}
              onChange={(e) => onPatch({ qty: e.target.value.replace(/\D/g, "") })}
            />
            {caseSize && (
              <UnitSwitch
                cases={l.cases}
                unit={unit}
                caseUnit={caseUnit}
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
            {l.cases && caseSize ? `= ${qty} ${unit} (${caseSize} a ${caseUnit})` : caseSize ? `${unit} · ${caseSize} a ${caseUnit}` : unit}
          </p>
        </div>
        <div className="min-w-0">
          <span className="block text-xs font-medium text-[var(--ink-2)] mb-1">Cost per {unit} (₹, before GST)</span>
          <input
            className="input text-right !text-base"
            inputMode="decimal"
            placeholder="₹0"
            aria-label={`Cost per ${unit} of ${name}`}
            value={l.cost}
            onChange={(e) => onPatch({ cost: e.target.value.replace(/[^\d.]/g, "") })}
          />
          {amount > 0 && <p className="text-[11px] text-[var(--muted)] mt-0.5 text-right">Line {formatINR(amount)}</p>}
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <label className="block min-w-0">
          <span className="block text-xs font-medium text-[var(--ink-2)] mb-1">Batch no.</span>
          <input
            className="input uppercase"
            autoCapitalize="characters"
            autoCorrect="off"
            spellCheck={false}
            maxLength={40}
            value={l.batch}
            onChange={(e) => onPatch({ batch: e.target.value.toUpperCase() })}
          />
        </label>
        <label className="block min-w-0">
          <span className="block text-xs font-medium text-[var(--ink-2)] mb-1">
            Expiry date{needExpiry ? <span className="text-[#a8281e]"> · needed</span> : <span className="text-[var(--muted)]"> · optional</span>}
          </span>
          <input
            className={`input !px-2 ${problem === "Enter the expiry date" ? "!border-[#a8281e]" : ""}`}
            type="date"
            required={needExpiry}
            aria-required={needExpiry}
            value={l.expiry}
            onChange={(e) => onPatch({ expiry: e.target.value })}
          />
        </label>
      </div>

      {l.showMfg ? (
        <label className="block sm:max-w-[50%]">
          <span className="block text-xs font-medium text-[var(--ink-2)] mb-1">Manufacturing date · optional</span>
          <input className="input !px-2" type="date" value={l.mfg} onChange={(e) => onPatch({ mfg: e.target.value })} />
        </label>
      ) : null}

      <div className="flex flex-wrap items-center gap-2">
        {!l.showMfg && (
          <button type="button" className="btn btn-quiet btn-xs !min-h-[40px]" onClick={() => onPatch({ showMfg: true })}>
            <Icon name="plus" className="h-3.5 w-3.5" /> Mfg date
          </button>
        )}
        <button type="button" className="btn btn-quiet btn-xs !min-h-[40px]" onClick={onSplit}>
          <Icon name="layers" className="h-3.5 w-3.5" /> Another batch
        </button>
      </div>

      {problem && <p className="text-xs font-semibold text-[#a8281e]">{problem}</p>}
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

// ───────────────────────────── done ─────────────────────────────

function Success({ done, onMore }: { done: Done; onMore: () => void }) {
  return (
    <section className="card p-5 space-y-4" role="status">
      <div className="flex items-start gap-3">
        <span className="icon-tile bg-[var(--mint-tint)] text-[var(--mint-text)]">
          <Icon name="check" />
        </span>
        <div className="min-w-0">
          <p className="font-heading font-bold text-lg">Goods received</p>
          <p className="text-sm text-[var(--ink-2)] break-all">
            <b>{done.number}</b> · {done.supplier}
          </p>
          <p className="text-sm text-[var(--muted)]">
            {plural(done.lines, "line")} · {done.units} units
            {done.total ? ` · ${formatINR(done.total)} before GST` : ""}
          </p>
          {done.po && <p className="text-sm text-[var(--muted)]">Against purchase order {done.po.number}.</p>}
        </div>
      </div>
      <div className="flex flex-wrap gap-2">
        <Link href={`/admin/stock/purchases/${done.id}`} className="btn btn-kesar btn-sm !min-h-[44px]">
          <Icon name="eye" className="h-4 w-4" /> View receipt
        </Link>
        <button type="button" className="btn btn-outline btn-sm !min-h-[44px]" onClick={onMore}>
          <Icon name="plus" className="h-4 w-4" /> Receive more
        </button>
        {done.po && (
          <Link href={`/admin/stock/purchase-orders/${done.po.id}`} className="btn btn-quiet btn-sm !min-h-[44px]">
            <Icon name="clipboard" className="h-4 w-4" /> {done.po.number}
          </Link>
        )}
      </div>
    </section>
  );
}
