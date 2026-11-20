"use client";

import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import Icon from "@/components/Icon";
import { matches } from "@/lib/translit";
import type { Confidence, ParsedLine } from "@/lib/order-text";
import { MAX_QTY, StockChip, type CartEntry, type StoreProduct } from "@/components/store/shared";

/**
 * A1: "Type or speak your order". The shop (or the agent) types, pastes or
 * speaks the order the way they'd say it ("5 peti nimbu, 2 jeera"); the
 * server reads it against this shop's products (POST /api/order-text) and
 * the lines come back to check here: change the product, the number or
 * units ↔ cases, drop a line, then add them to the cart. A WhatsApp order
 * (?draft=) opens here already read.
 */

type Row = { key: number; said: string; productId: string | null; qty: number; per: "unit" | "case"; confidence: Confidence; alternatives: string[]; note: string | null; picking: boolean };
export type TextAdd = { productId: string; entry: CartEntry };
type Draft = { id: string; text: string; lines: ParsedLine[]; status: "READING" | "OPEN" | "USED" | "EXPIRED"; orderId: string | null };

// The browser's own speech-to-text (Chrome / Android). Not in TypeScript's DOM types.
type Recognition = {
  lang: string;
  interimResults: boolean;
  continuous: boolean;
  start: () => void;
  stop: () => void;
  onresult: ((e: { resultIndex: number; results: ArrayLike<ArrayLike<{ transcript: string }> & { isFinal: boolean }> }) => void) | null;
  onerror: ((e: { error: string }) => void) | null;
  onend: (() => void) | null;
};
function recognitionClass(): (new () => Recognition) | null {
  if (typeof window === "undefined") return null;
  const w = window as unknown as { SpeechRecognition?: new () => Recognition; webkitSpeechRecognition?: new () => Recognition };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

const noSubscribe = () => () => {};

let nextKey = 1;
const toRows = (lines: ParsedLine[]): Row[] => lines.map((l) => ({ ...l, key: nextKey++, picking: !l.productId }));

export default function OrderByText({
  retailerId,
  products,
  byId,
  inCartAction,
  draftId,
  onAddAction,
}: {
  retailerId?: string;
  products: StoreProduct[];
  byId: Map<string, StoreProduct>;
  inCartAction: (productId: string) => boolean;
  draftId?: string | null;
  onAddAction: (adds: TextAdd[], draftId: string | null) => void;
}) {
  const [open, setOpen] = useState(!!draftId);
  const [text, setText] = useState("");
  const [rows, setRows] = useState<Row[] | null>(null);
  const [reading, setReading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [listening, setListening] = useState(false);
  const [interim, setInterim] = useState("");
  // false on the server, the real answer in the browser (no hydration mismatch).
  const canSpeak = useSyncExternalStore(noSubscribe, () => !!recognitionClass(), () => false);
  const rec = useRef<Recognition | null>(null);

  useEffect(() => () => rec.current?.stop(), []);

  // A WhatsApp order: load it already read.
  useEffect(() => {
    if (!draftId) return;
    let live = true;
    fetch(`/api/order-drafts/${encodeURIComponent(draftId)}${retailerId ? `?retailerId=${encodeURIComponent(retailerId)}` : ""}`)
      .then(async (r) => {
        const d = await r.json().catch(() => ({}));
        if (!r.ok) throw new Error(d.error ?? "Could not open the WhatsApp order");
        return d.draft as Draft;
      })
      .then((d) => {
        if (!live) return;
        setDraft(d);
        setText(d.text);
        if (d.status === "OPEN") setRows(toRows(d.lines.filter((l) => !l.productId || byId.has(l.productId))));
      })
      .catch((e: unknown) => live && setError(e instanceof Error ? e.message : "Could not open the WhatsApp order"));
    return () => {
      live = false;
    };
  }, [draftId, retailerId, byId]);

  function listen() {
    const R = recognitionClass();
    if (!R) return;
    if (listening) return rec.current?.stop();
    const r = new R();
    r.lang = "hi-IN"; // understands Hindi and Hinglish; English product names come through too
    r.interimResults = true;
    r.continuous = false;
    r.onresult = (e) => {
      let done = "";
      let partial = "";
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const res = e.results[i];
        if (res.isFinal) done += res[0].transcript;
        else partial += res[0].transcript;
      }
      if (done) setText((t) => (t.trim() ? `${t.trim()}, ${done.trim()}` : done.trim()));
      setInterim(partial);
    };
    r.onerror = (e) => {
      setError(e.error === "not-allowed" || e.error === "service-not-allowed" ? "Allow the microphone for this site to speak the order." : e.error === "no-speech" ? "Didn't hear anything. Tap the mic and speak." : "The mic stopped. Try again or type the order.");
    };
    r.onend = () => {
      setListening(false);
      setInterim("");
    };
    setError(null);
    rec.current = r;
    try {
      r.start();
      setListening(true);
    } catch {
      setError("The mic didn't start. Try again or type the order.");
    }
  }

  async function read() {
    if (!text.trim() || reading) return;
    rec.current?.stop();
    setReading(true);
    setError(null);
    setInfo(null);
    try {
      const res = await fetch("/api/order-text", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text, retailerId }),
      });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) return setError(d.error ?? "Could not read the order. Try again.");
      const lines = d.lines as ParsedLine[];
      if (!lines.length) return setError('No items found. Write it like "5 peti nimbu, 2 jeera".');
      setRows(toRows(lines));
      setInfo(d.note ?? null);
    } catch {
      setError("Network error. Check your connection and try again.");
    } finally {
      setReading(false);
    }
  }

  const patch = (key: number, p: Partial<Row>) => setRows((rs) => rs?.map((r) => (r.key === key ? { ...r, ...p } : r)) ?? null);
  const ready = (rows ?? []).filter((r) => r.productId && byId.has(r.productId) && r.qty >= 1);
  const unsure = (rows ?? []).filter((r) => !r.productId || r.confidence !== "high").length;

  function add() {
    onAddAction(
      ready.map((r) => {
        const p = byId.get(r.productId!)!;
        const cases = r.per === "case" && !!p.caseSize;
        return { productId: p.id, entry: { qty: Math.min(MAX_QTY, cases ? r.qty : Math.max(r.qty, p.moq || 1)), mode: cases ? "cases" : "units" } };
      }),
      draft?.status === "OPEN" ? draft.id : null
    );
    setRows(null);
    setText("");
    setInfo(`Added ${ready.length} to the cart.`);
  }

  if (!open) {
    return (
      <button type="button" onClick={() => setOpen(true)} className="card w-full p-3.5 flex items-center gap-3 text-left hover:brightness-[0.99]">
        <span className="grid place-items-center h-10 w-10 shrink-0 rounded-xl bg-[var(--kesar-tint)] text-[var(--kesar-text)]">
          <Icon name="mic" className="h-5 w-5" />
        </span>
        <span className="min-w-0">
          <span className="block text-sm font-bold">Type or speak your order</span>
          <span className="block text-xs text-[var(--muted)] truncate">Like you&apos;d say it: &ldquo;5 peti nimbu, 2 jeera&rdquo; · Hindi or English</span>
        </span>
      </button>
    );
  }

  return (
    <section className="card p-3.5 space-y-3" aria-label="Type or speak your order">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="page-kick">{draft ? "Your WhatsApp order" : "Type or speak your order"}</p>
          <p className="text-xs text-[var(--muted)] mt-0.5">
            {draft ? "We read it below. Check each line, then add it to the cart." : "Write it like a message, one item after another. We match it to products; you check before anything is ordered."}
          </p>
        </div>
        <button type="button" aria-label="Close" className="h-8 w-8 shrink-0 rounded-full bg-ink/5 text-sm font-bold" onClick={() => (rec.current?.stop(), setOpen(false))}>
          ×
        </button>
      </div>

      {draft && draft.status !== "OPEN" && (
        <p className="text-sm rounded-xl bg-ink/5 px-3 py-2">
          {draft.status === "USED" ? "This WhatsApp order was already placed." : draft.status === "EXPIRED" ? "This WhatsApp order has expired. Read it again below to order it." : "Still reading this WhatsApp order. Open the link again in a minute."}
        </p>
      )}

      {!rows && (
        <>
          <div className="relative">
            <textarea
              className="input min-h-[92px] !pr-12"
              value={listening && interim ? `${text}${text ? ", " : ""}${interim}` : text}
              onChange={(e) => setText(e.target.value)}
              placeholder={"5 peti nimbu, 2 jeera\nmasala chai 1 kilo wala 3 packet\nनमक 1 बोरी"}
              maxLength={2000}
              aria-label="Your order"
              readOnly={listening}
            />
            {canSpeak && (
              <button
                type="button"
                onClick={listen}
                aria-pressed={listening}
                aria-label={listening ? "Stop listening" : "Speak the order"}
                className={`absolute right-2 top-2 grid place-items-center h-9 w-9 rounded-full ${listening ? "bg-[#a8281e] text-white animate-pulse" : "bg-[var(--kesar-tint)] text-[var(--kesar-text)]"}`}
              >
                <Icon name="mic" className="h-4.5 w-4.5" />
              </button>
            )}
          </div>
          {listening && <p className="text-xs text-[var(--muted)]">Listening… say the items, then pause. Tap the mic to stop.</p>}
          <div className="flex items-center justify-between gap-3">
            <p className="text-xs text-[var(--muted)]">{canSpeak ? "Tap the mic to speak in Hindi or English." : "Paste a WhatsApp message or type the order."}</p>
            <button type="button" className="btn btn-primary btn-sm shrink-0" disabled={!text.trim() || reading} onClick={read}>
              {reading ? "Reading…" : "Read order"}
            </button>
          </div>
        </>
      )}

      {rows && (
        <div className="space-y-2">
          {unsure > 0 && <p className="text-xs text-[var(--kesar-text)] font-semibold">{unsure === 1 ? "1 line needs a look" : `${unsure} lines need a look`} (marked below).</p>}
          <ul className="divide-y divide-[var(--line)]">
            {rows.map((r) => (
              <RowEditor
                key={r.key}
                row={r}
                products={products}
                byId={byId}
                inCart={!!r.productId && inCartAction(r.productId)}
                onChangeAction={(p) => patch(r.key, p)}
                onRemoveAction={() => setRows((rs) => rs?.filter((x) => x.key !== r.key) ?? null)}
              />
            ))}
          </ul>
          <div className="flex items-center justify-between gap-2 pt-1">
            <button type="button" className="btn btn-quiet btn-sm" onClick={() => setRows(null)}>
              Edit the text
            </button>
            <button type="button" className="btn btn-primary btn-sm" disabled={!ready.length} onClick={add}>
              {ready.length ? `Add ${ready.length} to cart` : "Pick products first"}
            </button>
          </div>
        </div>
      )}

      {error && <p className="text-sm text-[#a8281e]">{error}</p>}
      {info && <p className="text-xs text-[var(--muted)]">{info}</p>}
    </section>
  );
}

const CONF: Record<Confidence, { label: string; cls: string } | null> = {
  high: null,
  medium: { label: "Check", cls: "chip-genda" },
  low: { label: "Pick one", cls: "chip-kesar" },
};

function RowEditor({
  row: r,
  products,
  byId,
  inCart,
  onChangeAction,
  onRemoveAction,
}: {
  row: Row;
  products: StoreProduct[];
  byId: Map<string, StoreProduct>;
  inCart: boolean;
  onChangeAction: (p: Partial<Row>) => void;
  onRemoveAction: () => void;
}) {
  const [q, setQ] = useState("");
  const p = r.productId ? (byId.get(r.productId) ?? null) : null;
  const options = [r.productId, ...r.alternatives].filter((id, i, a): id is string => !!id && byId.has(id) && a.indexOf(id) === i);
  const found = useMemo(() => (q.trim() ? products.filter((x) => matches(x.search, q)).slice(0, 8) : []), [q, products]);
  // A product is chosen: worth a look. None: pick one.
  const conf = r.productId ? CONF[r.confidence === "low" ? "medium" : r.confidence] : CONF.low;
  const hasCase = !!p?.caseSize && p.caseSize > 1;

  function choose(id: string) {
    const np = byId.get(id);
    onChangeAction({ productId: id, confidence: "high", picking: false, per: r.per === "case" && np?.caseSize ? "case" : "unit" });
    setQ("");
  }

  return (
    <li className="py-2.5 space-y-1.5">
      <div className="flex items-center justify-between gap-2">
        <p className="text-xs text-[var(--muted)] min-w-0 truncate">
          &ldquo;{r.said}&rdquo;
          {conf && <span className={`chip ml-1.5 !py-0 !text-[10.5px] ${conf.cls}`}>{conf.label}</span>}
        </p>
        <button type="button" className="text-xs font-semibold text-[var(--muted)] hover:text-[#a8281e] shrink-0" onClick={onRemoveAction} aria-label={`Remove ${r.said}`}>
          Remove
        </button>
      </div>

      {!r.picking && p ? (
        <div className="flex items-center gap-2 flex-wrap">
          {options.length > 1 ? (
            <select className="input !py-1.5 !text-sm flex-1 min-w-[160px]" value={p.id} onChange={(e) => (e.target.value === "__other" ? onChangeAction({ picking: true }) : choose(e.target.value))} aria-label="Product">
              {options.map((id) => (
                <option key={id} value={id}>
                  {byId.get(id)!.name}
                </option>
              ))}
              <option value="__other">Another product…</option>
            </select>
          ) : (
            <button type="button" className="flex-1 min-w-[160px] text-left text-sm font-semibold truncate" onClick={() => onChangeAction({ picking: true })} title="Change the product">
              {p.name} <span className="text-xs font-normal text-[var(--muted)] underline">change</span>
            </button>
          )}
          <StockChip stock={p.stock} />
          {inCart && <span className="text-[11px] font-semibold text-[var(--mint-text)]">in cart · adds to it</span>}
        </div>
      ) : (
        <div className="space-y-1.5">
          <input className="input !py-1.5 !text-sm" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search a product (Hindi or English)" aria-label={`Product for ${r.said}`} autoFocus={!options.length} />
          <div className="flex flex-wrap gap-1.5">
            {(found.length ? found.map((x) => x.id) : options).map((id) => (
              <button key={id} type="button" className="chip !py-1" onClick={() => choose(id)}>
                {byId.get(id)?.name}
              </button>
            ))}
            {!found.length && !options.length && <span className="text-xs text-[var(--muted)]">Type to find the product.</span>}
          </div>
        </div>
      )}

      <div className="flex items-center gap-2">
        <input
          type="number"
          inputMode="numeric"
          min={1}
          max={MAX_QTY}
          className="input !py-1.5 !text-sm w-24 tabular-nums"
          value={r.qty}
          onChange={(e) => onChangeAction({ qty: Math.max(0, Math.min(MAX_QTY, Math.floor(Number(e.target.value) || 0))) })}
          aria-label={`How many: ${r.said}`}
        />
        {p && hasCase ? (
          <div className="inline-flex rounded-lg bg-ink/5 p-0.5 text-[11.5px] font-bold" role="group" aria-label="Order in">
            {(["unit", "case"] as const).map((m) => (
              <button key={m} type="button" aria-pressed={r.per === m} onClick={() => onChangeAction({ per: m })} className={`px-2 py-1 rounded-md ${r.per === m ? "bg-white shadow-sm text-[var(--ink)]" : "text-[var(--muted)]"}`}>
                {m === "unit" ? p.unit : `${p.caseUnit || "case"} of ${p.caseSize}`}
              </button>
            ))}
          </div>
        ) : (
          <span className="text-sm text-[var(--muted)]">{p?.unit ?? ""}</span>
        )}
      </div>
      {r.note && <p className="text-[11.5px] text-[var(--muted)]">{r.note}</p>}
    </li>
  );
}
