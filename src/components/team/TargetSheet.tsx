"use client";

import { useMemo, useState } from "react";
import { Field, SearchPick, Sheet, errText, readInt, readRupees, rupeeText, send, useFetch, type Option } from "@/components/admin/AdminKit";
import { METRIC_LABEL, MONEY_METRICS } from "@/lib/field-settings";
import { errorText, monthLabel, roleText, type Member } from "@/components/team/kit";

export type Metric = keyof typeof METRIC_LABEL;

export type TargetJson = {
  id: string;
  userId: string;
  period: string;
  metric: Metric;
  goal: number;
  productId: string | null;
  brandId: string | null;
  incentive: number;
  minPct: number;
  capPct: number;
  note: string | null;
  user: { name: string; role: string };
  achieved: number;
  pct: number;
  earned: number;
  itemName: string | null;
};

type ProductRow = { id: string; name: string; sku?: string | null; active?: boolean; brand: { id: string; name: string } | null };

export const METRICS = Object.keys(METRIC_LABEL) as Metric[];

/**
 * Add or edit a monthly target. Editing keeps the person, metric and item
 * (they are the target's identity; saving the same ones replaces it).
 */
export default function TargetSheet({
  target,
  period,
  members,
  onClose,
  onSaved,
}: {
  target: TargetJson | null;
  period: string;
  members: Member[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const editing = !!target;
  const [userId, setUserId] = useState<string | null>(target?.userId ?? null);
  const [metric, setMetric] = useState<Metric>(target?.metric ?? "VALUE");
  const money = MONEY_METRICS.has(metric);
  const [goal, setGoal] = useState(target ? (MONEY_METRICS.has(target.metric) ? rupeeText(target.goal) : String(target.goal)) : "");
  const [scope, setScope] = useState<"all" | "product" | "brand">(target?.productId ? "product" : target?.brandId ? "brand" : "all");
  const [productId, setProductId] = useState<string | null>(target?.productId ?? null);
  const [brandId, setBrandId] = useState<string | null>(target?.brandId ?? null);
  const [incentive, setIncentive] = useState(target ? rupeeText(target.incentive) : "");
  const [minPct, setMinPct] = useState(String(target?.minPct ?? 80));
  const [capPct, setCapPct] = useState(String(target?.capPct ?? 120));
  const [note, setNote] = useState(target?.note ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Products (and their brands) only when a units target is being set up.
  const products = useFetch<{ products: ProductRow[] }>(metric === "VOLUME" && !editing ? "/api/products" : null);
  const productOptions: Option[] = useMemo(
    () => (products.data?.products ?? []).filter((p) => p.active !== false).map((p) => ({ id: p.id, label: p.name, sub: [p.brand?.name, p.sku].filter(Boolean).join(" · ") })),
    [products.data]
  );
  const brandOptions: Option[] = useMemo(() => {
    const m = new Map<string, string>();
    for (const p of products.data?.products ?? []) if (p.brand) m.set(p.brand.id, p.brand.name);
    return [...m.entries()].map(([id, label]) => ({ id, label })).sort((a, b) => a.label.localeCompare(b.label));
  }, [products.data]);

  const people: Option[] = members.map((m) => ({ id: m.id, label: m.name, sub: roleText(m.role) }));
  const person = target ? target.user.name : null;

  const goalLabel = money ? "Goal (₹)" : metric === "VOLUME" ? "Goal (units)" : "Goal (new shops)";

  async function save() {
    if (!userId) return setError("Pick the person");
    const g = money ? readRupees(goal) : readInt(goal, 1);
    if (g === null || g === "bad" || g <= 0) return setError(money ? "Enter the goal in ₹" : "Enter the goal as a whole number");
    const inc = readRupees(incentive);
    if (inc === "bad") return setError("Enter the incentive in ₹");
    const min = readInt(minPct);
    if (min === null || min === "bad" || min > 100) return setError("Pay from must be 0 to 100%");
    const cap = readInt(capPct, 100);
    if (cap === null || cap === "bad" || cap > 1000) return setError("Cap must be 100 to 1000%");
    if (metric === "VOLUME" && !editing && scope === "product" && !productId) return setError("Pick the product");
    if (metric === "VOLUME" && !editing && scope === "brand" && !brandId) return setError("Pick the brand");

    setBusy(true);
    setError(null);
    try {
      await send("/api/targets", "POST", {
        userId,
        period: target?.period ?? period,
        metric,
        goal: g,
        productId: metric === "VOLUME" ? (editing ? target!.productId : scope === "product" ? productId : null) : null,
        brandId: metric === "VOLUME" ? (editing ? target!.brandId : scope === "brand" ? brandId : null) : null,
        incentive: inc ?? 0,
        minPct: min,
        capPct: cap,
        note: note.trim() || null,
      });
      onSaved();
    } catch (e) {
      setError(errText(e));
      setBusy(false);
    }
  }

  return (
    <Sheet
      title={editing ? "Edit target" : "New target"}
      onClose={onClose}
      footer={
        <div className="space-y-2">
          {error && <p className={errorText}>{error}</p>}
          <div className="flex gap-2 justify-end">
            <button type="button" className="btn btn-quiet !min-h-[44px]" onClick={onClose} disabled={busy}>
              Cancel
            </button>
            <button type="button" className="btn btn-kesar !min-h-[44px]" onClick={save} disabled={busy}>
              {busy ? "Saving…" : "Save target"}
            </button>
          </div>
        </div>
      }
    >
      <p className="text-sm text-[var(--ink-2)]">
        For <b>{monthLabel(target?.period ?? period)}</b>
      </p>

      {editing ? (
        <div className="rounded-2xl bg-ink/5 p-3 text-sm space-y-0.5">
          <p>
            <b>{person}</b> · {METRIC_LABEL[metric]}
            {target?.itemName ? ` · ${target.itemName}` : ""}
          </p>
          <p className="text-xs text-[var(--muted)]">To change the person or what is measured, delete this target and add a new one.</p>
        </div>
      ) : (
        <>
          <div>
            <span className="block text-sm font-medium text-[var(--ink-2)] mb-1">Person</span>
            {people.length === 0 ? (
              <p className="text-sm text-[var(--muted)]">No field staff yet.</p>
            ) : (
              <SearchPick options={people} value={userId} onChange={setUserId} placeholder="Search your team" />
            )}
          </div>

          <div>
            <span className="block text-sm font-medium text-[var(--ink-2)] mb-1.5">What is measured</span>
            <div className="grid grid-cols-2 gap-2" role="radiogroup" aria-label="What is measured">
              {METRICS.map((m) => (
                <button
                  key={m}
                  type="button"
                  role="radio"
                  aria-checked={metric === m}
                  onClick={() => {
                    if (MONEY_METRICS.has(m) !== money) setGoal("");
                    setMetric(m);
                  }}
                  className={`min-h-[44px] rounded-xl px-3 text-sm font-bold transition ${
                    metric === m ? "bg-gradient-to-br from-mor to-[var(--mor-mid)] text-white" : "bg-ink/5 text-[var(--ink-2)]"
                  }`}
                >
                  {METRIC_LABEL[m]}
                </button>
              ))}
            </div>
          </div>

          {metric === "VOLUME" && (
            <div className="space-y-2">
              <span className="block text-sm font-medium text-[var(--ink-2)]">Which units count</span>
              <div className="flex flex-wrap gap-2" role="radiogroup" aria-label="Which units count">
                {(
                  [
                    ["all", "All products"],
                    ["product", "One product"],
                    ["brand", "One brand"],
                  ] as const
                ).map(([k, label]) => (
                  <button
                    key={k}
                    type="button"
                    role="radio"
                    aria-checked={scope === k}
                    onClick={() => setScope(k)}
                    className={`min-h-[44px] rounded-xl px-3 text-sm font-bold transition ${
                      scope === k ? "bg-gradient-to-br from-mor to-[var(--mor-mid)] text-white" : "bg-ink/5 text-[var(--ink-2)]"
                    }`}
                  >
                    {label}
                  </button>
                ))}
              </div>
              {scope !== "all" && products.error && <p className={errorText}>{products.error}</p>}
              {scope !== "all" && !products.data && !products.error && <p className="text-xs text-[var(--muted)]">Loading products…</p>}
              {scope === "product" && products.data && (
                <SearchPick options={productOptions} value={productId} onChange={setProductId} placeholder="Search products" />
              )}
              {scope === "brand" && products.data && <SearchPick options={brandOptions} value={brandId} onChange={setBrandId} placeholder="Search brands" />}
            </div>
          )}
        </>
      )}

      <Field label={goalLabel}>
        <input className="input" inputMode={money ? "decimal" : "numeric"} value={goal} onChange={(e) => setGoal(e.target.value)} placeholder={money ? "e.g. 500000" : "e.g. 200"} />
      </Field>

      <Field label="Incentive at 100% (₹)" hint="Paid pro rata from the 'pay from' level, up to the cap.">
        <input className="input" inputMode="decimal" value={incentive} onChange={(e) => setIncentive(e.target.value)} placeholder="0" />
      </Field>

      <div className="grid grid-cols-2 gap-3">
        <Field label="Pay from (%)">
          <input className="input" inputMode="numeric" value={minPct} onChange={(e) => setMinPct(e.target.value)} />
        </Field>
        <Field label="Cap (%)">
          <input className="input" inputMode="numeric" value={capPct} onChange={(e) => setCapPct(e.target.value)} />
        </Field>
      </div>

      <Field label="Note (optional)">
        <input className="input" maxLength={200} value={note} onChange={(e) => setNote(e.target.value)} placeholder="e.g. Festival push" />
      </Field>
    </Sheet>
  );
}
