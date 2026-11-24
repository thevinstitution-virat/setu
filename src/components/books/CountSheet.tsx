"use client";

import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import Icon from "@/components/Icon";
import { errText, Field, readInt, readRupees, rupeeText, SearchPick, send, Sheet } from "@/components/admin/AdminKit";
import { formatINR } from "@/lib/money";
import type { countDetail } from "@/lib/stock-counts";

type Count = Awaited<ReturnType<typeof countDetail>>;
type Line = Count["lines"][number];
type Product = { id: string; name: string; sku: string | null; unit: string };
type Show = "all" | "blank" | "diff";
const PAGE = 150;

/** Recompute a line's values from what is on screen. */
function calc(l: Line, mode: Count["mode"]): Line {
  const rate = l.enteredRate ?? l.autoRate;
  const counted = l.countedQty;
  return {
    ...l,
    rate,
    rateFrom: l.enteredRate !== null ? "entered" : l.autoFrom,
    diffQty: mode === "TRACKED" && counted !== null ? counted - l.bookQty : null,
    bookValue: l.bookQty * (rate ?? 0),
    countedValue: mode === "VALUE" ? l.value : counted === null ? null : counted * (rate ?? 0),
    diffValue: mode === "TRACKED" && counted !== null ? (counted - l.bookQty) * (rate ?? 0) : null,
  };
}

/** Fill a count on the phone (saves as you go), add what was found, then accept it. Read-only once accepted. */
export default function CountSheet({ count, products, canPost }: { count: Count; products: Product[]; canPost: boolean }) {
  const router = useRouter();
  const mode = count.mode;
  const open = count.status === "DRAFT" && canPost;
  const [lines, setLines] = useState<Line[]>(count.lines);
  const [text, setText] = useState<Record<string, string>>({});
  const [state, setState] = useState<Record<string, "saving" | "saved" | "bad">>({});
  const [q, setQ] = useState("");
  const [show, setShow] = useState<Show>(count.status === "ACCEPTED" && mode === "TRACKED" ? "diff" : "all");
  const [book, setBook] = useState(count.status !== "DRAFT");
  const [limit, setLimit] = useState(PAGE);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [ask, setAsk] = useState<null | "accept" | "book" | "zero" | "cancel">(null);
  const [reason, setReason] = useState("");
  const [adding, setAdding] = useState(false);

  const totals = useMemo(() => {
    if (count.status !== "DRAFT") return count.totals;
    const sum = (f: (l: Line) => number | null) => lines.reduce((a, l) => a + (f(l) ?? 0), 0);
    return {
      lines: lines.length,
      counted: lines.filter((l) => (mode === "VALUE" ? l.value !== null : l.countedQty !== null)).length,
      bookValue: sum((l) => l.bookValue),
      countedValue: sum((l) => l.countedValue),
      shortage: sum((l) => (l.diffValue !== null && l.diffValue < 0 ? -l.diffValue : 0)),
      excess: sum((l) => (l.diffValue !== null && l.diffValue > 0 ? l.diffValue : 0)),
      short: lines.filter((l) => (l.diffQty ?? 0) < 0).length,
      over: lines.filter((l) => (l.diffQty ?? 0) > 0).length,
      noRate: lines.filter((l) => mode !== "VALUE" && l.rate === null && (l.countedQty ?? l.bookQty) > 0).length,
    };
  }, [lines, count, mode]);

  const query = q.trim().toLowerCase();
  const shown = lines.filter(
    (l) =>
      (!query || `${l.name} ${l.sku ?? ""} ${l.batch} ${l.company ?? ""}`.toLowerCase().includes(query)) &&
      (show === "all" || (show === "blank" ? (mode === "VALUE" ? l.value === null : l.countedQty === null) : (l.diffQty ?? 0) !== 0)),
  );

  const key = (id: string, f: string) => `${id}:${f}`;
  const valueOf = (l: Line, f: "countedQty" | "rate" | "value") =>
    text[key(l.id, f)] ?? (f === "countedQty" ? (l.countedQty === null ? "" : String(l.countedQty)) : f === "rate" ? rupeeText(l.enteredRate) : rupeeText(l.value));

  async function save(l: Line, f: "countedQty" | "rate" | "value") {
    const k = key(l.id, f);
    const raw = text[k];
    if (raw === undefined) return;
    const v = f === "countedQty" ? readInt(raw) : readRupees(raw);
    if (v === "bad") return setState((s) => ({ ...s, [k]: "bad" }));
    const before = f === "countedQty" ? l.countedQty : f === "rate" ? l.enteredRate : l.value;
    if (v === before) return;
    setState((s) => ({ ...s, [k]: "saving" }));
    try {
      await send(`/api/admin/books/stock/counts/${count.id}`, "POST", { action: "save", lines: [{ id: l.id, [f]: v }] });
      setLines((ls) => ls.map((x) => (x.id === l.id ? calc({ ...x, ...(f === "countedQty" ? { countedQty: v } : f === "rate" ? { enteredRate: v } : { value: v }) }, mode) : x)));
      setState((s) => ({ ...s, [k]: "saved" }));
      setErr(null);
    } catch (e) {
      setState((s) => ({ ...s, [k]: "bad" }));
      setErr(errText(e));
    }
  }

  async function act(body: Record<string, unknown>, after?: () => void) {
    setBusy(true);
    setErr(null);
    try {
      await send(`/api/admin/books/stock/counts/${count.id}`, "POST", body);
      setAsk(null);
      after?.();
      router.refresh();
    } catch (e) {
      setErr(errText(e));
    } finally {
      setBusy(false);
    }
  }

  async function removeLine(l: Line) {
    await act({ action: "remove", lineId: l.id });
  }

  function next(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key !== "Enter") return;
    e.preventDefault();
    const all = Array.from(document.querySelectorAll<HTMLInputElement>("input[data-count]"));
    const i = all.indexOf(e.currentTarget);
    if (all[i + 1]) all[i + 1].focus();
    else e.currentTarget.blur();
  }

  const input = (l: Line, f: "countedQty" | "rate" | "value", label: string, wide = false) => {
    const k = key(l.id, f);
    const st = state[k];
    return (
      <label className={`block ${wide ? "w-28" : "w-20"} shrink-0`}>
        <span className="block text-[10px] uppercase tracking-wide text-[var(--muted)]">{label}</span>
        <input
          data-count
          className={`input !py-1.5 !px-2 text-right tabular-nums ${st === "bad" ? "!border-[#a8281e]" : st === "saved" ? "!border-[#2e7d4f]" : ""}`}
          inputMode={f === "countedQty" ? "numeric" : "decimal"}
          enterKeyHint="next"
          aria-label={`${label}: ${l.name}${l.batch ? ` batch ${l.batch}` : ""}`}
          value={valueOf(l, f)}
          disabled={!open}
          onChange={(e) => {
            const v = e.target.value;
            setText((t) => ({ ...t, [k]: v }));
            setState((s) => {
              const n = { ...s };
              delete n[k];
              return n;
            });
          }}
          onBlur={() => save(l, f)}
          onKeyDown={next}
        />
      </label>
    );
  };

  const done = totals.counted === totals.lines;
  const net = totals.excess - totals.shortage;

  return (
    <div className="space-y-3 pb-2">
      {count.status !== "DRAFT" ? (
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          <Stat label="Counted at cost" value={formatINR(totals.countedValue)} />
          {mode === "TRACKED" && <Stat label="The app had" value={formatINR(totals.bookValue)} />}
          {mode === "TRACKED" && <Stat label="Short" value={formatINR(totals.shortage)} sub={`${totals.short} lines`} />}
          {mode === "TRACKED" && <Stat label="Over" value={formatINR(totals.excess)} sub={`${totals.over} lines`} />}
        </div>
      ) : (
        <p className="text-sm text-[var(--ink-2)]">
          {mode === "TRACKED"
            ? "Count what is on the shelf and type it in; each line saves when you leave it. The app's quantity is hidden so the count is honest."
            : mode === "QUANTITY"
              ? "Type the quantity of each product you have. The rate is the last purchase cost unless you enter one."
              : "Type the value at cost of each company's goods in stock."}
        </p>
      )}

      <div className="flex flex-wrap items-center gap-2">
        <input
          className="input !py-1.5 flex-1 min-w-0 basis-48"
          placeholder={mode === "VALUE" ? "Search companies" : "Search product, code or batch"}
          value={q}
          onChange={(e) => setQ(e.target.value)}
          aria-label="Search the sheet"
        />
        <div className="flex gap-1.5 overflow-x-auto" role="radiogroup" aria-label="Show">
          {([["all", "All"], ["blank", "Not counted"], ...(mode === "TRACKED" ? [["diff", "Differences"]] : [])] as [Show, string][]).map(([k, label]) => (
            <button
              key={k}
              type="button"
              role="radio"
              aria-checked={show === k}
              onClick={() => setShow(k)}
              className={`shrink-0 rounded-full px-3 py-1 text-sm font-semibold ${show === k ? "bg-ink text-white" : "bg-black/5 text-foreground/70"}`}
            >
              {label}
            </button>
          ))}
        </div>
        {mode === "TRACKED" && count.status === "DRAFT" && (
          <label className="flex items-center gap-1.5 text-sm text-[var(--ink-2)]">
            <input type="checkbox" checked={book} onChange={(e) => setBook(e.target.checked)} /> Show the app&apos;s quantity
          </label>
        )}
      </div>

      {err && <p className="text-sm rounded-lg bg-[#fdecea] text-[#a8281e] px-3 py-2">{err}</p>}

      <section className="card p-0 overflow-hidden">
        {shown.length ? (
          <ul className="divide-y divide-[var(--line)]">
            {shown.slice(0, limit).map((l) => (
              <li key={l.id} className="px-3 sm:px-4 py-2.5 flex flex-wrap items-end justify-between gap-x-3 gap-y-2">
                <div className="min-w-0 flex-1 basis-40">
                  <p className="text-sm font-semibold text-[var(--ink)] leading-snug">
                    <span className="text-[var(--muted)] font-normal tabular-nums mr-1">{l.sl}.</span>
                    {l.name}
                    {l.added && <span className="chip !text-[10px] ml-1.5">Found</span>}
                  </p>
                  <p className="text-xs text-[var(--muted)]">
                    {[
                      l.sku,
                      l.batch ? `Batch ${l.batch}` : mode === "TRACKED" ? "No batch" : "",
                      l.expiry ? `Exp ${l.expiry.slice(5, 7)}/${l.expiry.slice(2, 4)}` : "",
                      mode !== "VALUE" && book ? `App ${l.bookQty} ${l.unit ?? ""}`.trim() : "",
                      mode !== "VALUE" && l.rate !== null ? `${formatINR(l.rate)}${l.rateFrom === "last" ? " last cost" : l.rateFrom === "batch" ? " batch cost" : ""}` : "",
                    ]
                      .filter(Boolean)
                      .join(" · ")}
                  </p>
                  {l.diffQty !== null && l.diffQty !== 0 && (book || count.status !== "DRAFT") && (
                    <p className={`text-xs font-semibold ${l.diffQty < 0 ? "text-[#a8281e]" : "text-[#2e7d4f]"}`}>
                      {l.diffQty < 0 ? `Short ${-l.diffQty}` : `Over ${l.diffQty}`}
                      {l.diffValue ? ` · ${formatINR(Math.abs(l.diffValue))}` : ""}
                    </p>
                  )}
                </div>
                <div className="flex items-end gap-2">
                  {count.status !== "DRAFT" ? (
                    <p className="text-right text-sm tabular-nums">
                      <span className="block font-semibold">{mode === "VALUE" ? formatINR(l.value ?? 0) : `${l.countedQty ?? 0} ${l.unit ?? ""}`}</span>
                      {mode !== "VALUE" && <span className="block text-xs text-[var(--muted)]">{formatINR(l.countedValue ?? 0)}</span>}
                    </p>
                  ) : mode === "VALUE" ? (
                    input(l, "value", "Value ₹", true)
                  ) : (
                    <>
                      {(mode === "QUANTITY" || l.autoRate === null || l.enteredRate !== null) && input(l, "rate", "Rate ₹")}
                      {input(l, "countedQty", "Counted")}
                    </>
                  )}
                  {open && l.added && (
                    <button type="button" className="btn btn-quiet btn-xs !px-2" aria-label={`Take off ${l.name}`} disabled={busy} onClick={() => removeLine(l)}>
                      <Icon name="trash" className="h-4 w-4" />
                    </button>
                  )}
                </div>
              </li>
            ))}
          </ul>
        ) : (
          <p className="px-4 py-6 text-sm text-[var(--muted)]">{lines.length ? "Nothing matches." : "The sheet is empty: the app had no stock here on that day. Add what you find."}</p>
        )}
        {shown.length > limit && (
          <button type="button" className="w-full border-t border-[var(--line)] px-4 py-2.5 text-sm font-semibold text-[var(--kesar-text)]" onClick={() => setLimit((n) => n + PAGE)}>
            Show more ({shown.length - limit} left)
          </button>
        )}
      </section>

      {open && (
        <div className="flex flex-wrap gap-2">
          {mode !== "VALUE" && (
            <button type="button" className="btn btn-outline btn-sm" onClick={() => setAdding(true)}>
              <Icon name="plus" className="h-4 w-4" /> Add what you found
            </button>
          )}
          {!done && mode === "TRACKED" && (
            <button type="button" className="btn btn-quiet btn-sm" onClick={() => setAsk("book")}>
              Rest are as in the app
            </button>
          )}
          {!done && (
            <button type="button" className="btn btn-quiet btn-sm" onClick={() => setAsk("zero")}>
              Rest are {mode === "VALUE" ? "₹0" : "0"}
            </button>
          )}
          <button type="button" className="btn btn-quiet btn-sm" onClick={() => setAsk("cancel")}>
            Cancel the count
          </button>
        </div>
      )}

      {open && ask && ask !== "accept" && (
        <div className="rounded-xl bg-ink/5 p-3 space-y-3 max-w-lg">
          {ask === "cancel" ? (
            <Field label="Why cancel it?">
              <input className="input" value={reason} maxLength={200} onChange={(e) => setReason(e.target.value)} placeholder="e.g. Started for the wrong place" />
            </Field>
          ) : (
            <p className="text-sm text-[var(--ink-2)]">
              {totals.lines - totals.counted} lines are not counted yet.{" "}
              {ask === "book" ? "Count each as the quantity the app has?" : `Count each as ${mode === "VALUE" ? "₹0" : "0 (none in stock)"}?`}
            </p>
          )}
          <div className="flex gap-2">
            <button
              type="button"
              className={`btn btn-sm ${ask === "cancel" ? "btn-danger" : "btn-mor"}`}
              disabled={busy || (ask === "cancel" && reason.trim().length < 3)}
              onClick={() => (ask === "cancel" ? act({ action: "cancel", reason }) : act({ action: "fill", how: ask }))}
            >
              {busy ? "Working…" : ask === "cancel" ? "Cancel the count" : "Yes, fill them"}
            </button>
            <button type="button" className="btn btn-quiet btn-sm" disabled={busy} onClick={() => setAsk(null)}>
              Back
            </button>
          </div>
        </div>
      )}

      {open && (
        <div className="sticky bottom-[5.5rem] md:bottom-3 z-20 rounded-2xl border border-[var(--line)] bg-white/95 backdrop-blur shadow-lg p-3 space-y-2">
          <div className="flex items-center justify-between gap-3 text-sm">
            <span className="min-w-0">
              <span className="font-semibold tabular-nums">
                {totals.counted} of {totals.lines}
              </span>{" "}
              counted
              <span className="block text-xs text-[var(--muted)] tabular-nums">
                {formatINR(totals.countedValue)} at cost
                {mode === "TRACKED" && book && (totals.shortage || totals.excess) ? ` · short ${formatINR(totals.shortage)} · over ${formatINR(totals.excess)}` : ""}
              </span>
            </span>
            <button type="button" className="btn btn-mor btn-sm shrink-0" disabled={busy || !done} onClick={() => setAsk(ask === "accept" ? null : "accept")}>
              <Icon name="check" className="h-4 w-4" /> Accept
            </button>
          </div>
          <div className="h-1.5 rounded-full bg-black/5 overflow-hidden" aria-hidden>
            <div className="h-full bg-[var(--mor,#2e7d4f)]" style={{ width: `${totals.lines ? (totals.counted / totals.lines) * 100 : 0}%` }} />
          </div>
          {ask === "accept" && (
            <div className="space-y-2 pt-1">
              <p className="text-sm text-[var(--ink-2)]">
                {mode === "TRACKED"
                  ? `The app's stock will be set to what you counted, as at the end of the day. ${net < 0 ? `The shortage of ${formatINR(-net)} goes to stock shortage.` : net > 0 ? `The excess of ${formatINR(net)} reduces purchases.` : "There is no difference in value."} `
                  : ""}
                The closing stock becomes {formatINR(totals.countedValue)}. This can&apos;t be undone{mode === "TRACKED" ? "; count again to correct it" : ""}.
              </p>
              {totals.noRate > 0 && <p className="text-sm text-[#7a4b00]">{totals.noRate} lines have no rate; enter one for each first.</p>}
              <div className="flex gap-2">
                <button type="button" className="btn btn-mor btn-sm" disabled={busy} onClick={() => act({ action: "accept" })}>
                  {busy ? "Accepting…" : "Yes, accept the count"}
                </button>
                <button type="button" className="btn btn-quiet btn-sm" disabled={busy} onClick={() => setAsk(null)}>
                  Back
                </button>
              </div>
            </div>
          )}
          {!done && <p className="text-xs text-[var(--muted)]">Count every line (or fill the rest) to accept.</p>}
        </div>
      )}

      {adding && <AddFound countId={count.id} tracked={mode === "TRACKED"} products={products} onClose={() => setAdding(false)} onAdded={() => router.refresh()} />}
    </div>
  );
}

function Stat({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="card p-3">
      <p className="text-xs text-[var(--muted)]">{label}</p>
      <p className="font-heading text-lg font-bold tabular-nums">{value}</p>
      {sub && <p className="text-xs text-[var(--muted)]">{sub}</p>}
    </div>
  );
}

/** A product (or a batch of it) on the shelf that is not on the sheet. */
function AddFound({ countId, tracked, products, onClose, onAdded }: { countId: string; tracked: boolean; products: Product[]; onClose: () => void; onAdded: () => void }) {
  const [productId, setProductId] = useState<string | null>(null);
  const [batch, setBatch] = useState("");
  const [expiry, setExpiry] = useState("");
  const [qty, setQty] = useState("");
  const [rate, setRate] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const options = useMemo(() => products.map((p) => ({ id: p.id, label: p.name, sub: [p.sku, p.unit].filter(Boolean).join(" · ") })), [products]);

  async function add() {
    const n = readInt(qty);
    const r = readRupees(rate);
    if (!productId) return setErr("Pick the product");
    if (n === "bad" || n === null) return setErr("Enter how many you counted");
    if (r === "bad") return setErr("The rate is not a number");
    setBusy(true);
    setErr(null);
    try {
      await send(`/api/admin/books/stock/counts/${countId}`, "POST", {
        action: "add",
        productId,
        batch: tracked ? batch.trim() : null,
        expiry: tracked && expiry ? expiry : null,
        countedQty: n,
        rate: r,
      });
      onAdded();
      onClose();
    } catch (e) {
      setErr(errText(e));
      setBusy(false);
    }
  }

  return (
    <Sheet
      title="Add what you found"
      onClose={onClose}
      footer={
        <div className="flex gap-2">
          <button type="button" className="btn btn-mor btn-sm" disabled={busy} onClick={add}>
            {busy ? "Adding…" : "Add to the sheet"}
          </button>
          <button type="button" className="btn btn-quiet btn-sm" disabled={busy} onClick={onClose}>
            Close
          </button>
        </div>
      }
    >
      <Field label="Product">
        <SearchPick options={options} value={productId} onChange={setProductId} placeholder="Search product or code" />
      </Field>
      {tracked && (
        <div className="grid grid-cols-2 gap-3">
          <Field label="Batch" hint="Leave blank if it has none.">
            <input className="input" value={batch} maxLength={40} onChange={(e) => setBatch(e.target.value)} />
          </Field>
          <Field label="Expiry">
            <input type="date" className="input" value={expiry} onChange={(e) => setExpiry(e.target.value)} />
          </Field>
        </div>
      )}
      <div className="grid grid-cols-2 gap-3">
        <Field label="Counted">
          <input className="input text-right" inputMode="numeric" value={qty} onChange={(e) => setQty(e.target.value)} />
        </Field>
        <Field label="Rate ₹ (optional)" hint="Blank uses the batch or last cost.">
          <input className="input text-right" inputMode="decimal" value={rate} onChange={(e) => setRate(e.target.value)} />
        </Field>
      </div>
      {err && <p className="text-sm text-[#a8281e]">{err}</p>}
    </Sheet>
  );
}
