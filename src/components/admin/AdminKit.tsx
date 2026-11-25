"use client";

/**
 * Small shared pieces for the catalogue / pricing / schemes admin screens:
 * fetch helpers, tab bar, toggle, sheet (full screen on phones), searchable
 * single and multi pickers, and a photo field that uploads to storage.
 */

import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import Icon from "@/components/Icon";
import { compressImage, uploadFile } from "@/lib/upload-client";

// ───────────────────────────── fetch ─────────────────────────────

/** A failed API call: status and the whole JSON body (e.g. stockShort on a 409). */
export class ApiError extends Error {
  constructor(message: string, public status: number, public data: Record<string, unknown>) {
    super(message);
  }
}

export async function api<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, init);
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new ApiError(data.error ?? "Something went wrong", res.status, data);
  return data as T;
}

export function send<T>(url: string, method: "POST" | "PATCH" | "DELETE", body?: unknown) {
  return api<T>(url, {
    method,
    headers: body === undefined ? undefined : { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

export const errText = (e: unknown) => (e instanceof Error ? e.message : "Something went wrong");

/** Load JSON from a URL once (and again on reload()). url = null waits. */
export function useFetch<T>(url: string | null) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [tick, setTick] = useState(0);
  useEffect(() => {
    if (!url) return;
    let live = true;
    api<T>(url)
      .then((d) => {
        if (!live) return;
        setData(d);
        setError(null);
      })
      .catch((e) => live && setError(errText(e)));
    return () => {
      live = false;
    };
  }, [url, tick]);
  const reload = useCallback(() => setTick((t) => t + 1), []);
  return { data, error, reload, setData };
}

export const fileUrl = (key: string) => `/api/files/${key.split("/").map(encodeURIComponent).join("/")}`;

// ───────────────────────────── money / text ─────────────────────────────

/** Paise → editable rupee text ("12.5"). */
export const rupeeText = (p: number | null | undefined) => (p === null || p === undefined ? "" : String(p / 100));

/** Rupee text → paise; blank → null; not a number or negative → "bad". */
export function readRupees(s: string): number | null | "bad" {
  const t = s.replace(/[,₹\s]/g, "");
  if (!t) return null;
  const n = Number(t);
  if (!Number.isFinite(n) || n < 0) return "bad";
  return Math.round(n * 100);
}

/** Whole-number text → number; blank → null; anything else → "bad". */
export function readInt(s: string, min = 0): number | null | "bad" {
  const t = s.trim();
  if (!t) return null;
  const n = Number(t);
  if (!Number.isInteger(n) || n < min) return "bad";
  return n;
}

/** Retailer's margin % on MRP after paying rate + GST (one decimal). */
export function margin(price: number, gstRate: number, mrp: number): number | null {
  if (!mrp || mrp <= 0) return null;
  return Math.round(((mrp - price * (1 + gstRate / 100)) / mrp) * 1000) / 10;
}

export function MarginText({ value }: { value: number | null }) {
  if (value === null) return <span className="text-[var(--muted)]">—</span>;
  const tone = value < 0 ? "text-[var(--risk-text)]" : value < 5 ? "text-[var(--scheme-text)]" : "text-[var(--success-text)]";
  return <span className={`font-semibold ${tone}`}>{value}%</span>;
}

/** ISO → value for <input type="datetime-local"> in the browser's time zone. */
export function isoToLocal(iso: string | null | undefined): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
}

export function localToIso(v: string): string | null {
  if (!v) return null;
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

export function shortDate(iso: string | null | undefined, withTime = false) {
  if (!iso) return "";
  return new Date(iso).toLocaleString("en-IN", {
    day: "numeric",
    month: "short",
    year: "numeric",
    ...(withTime ? { hour: "numeric", minute: "2-digit" } : {}),
    timeZone: "Asia/Kolkata",
  });
}

// ───────────────────────────── layout bits ─────────────────────────────

export function TabBar<K extends string>({
  tabs,
  value,
  onChange,
}: {
  tabs: readonly { key: K; label: string }[];
  value: K;
  onChange: (k: K) => void;
}) {
  return (
    <div className="overflow-x-auto -mx-4 px-4 pb-1">
      <div className="inline-flex rounded-2xl p-1 bg-ink/5 min-w-full sm:min-w-0" role="tablist">
        {tabs.map((t) => (
          <button
            key={t.key}
            type="button"
            role="tab"
            aria-selected={value === t.key}
            onClick={() => onChange(t.key)}
            className={`flex-1 sm:flex-none whitespace-nowrap rounded-xl py-2 px-3.5 text-sm font-bold transition ${
              value === t.key ? "bg-gradient-to-br from-mor to-[var(--mor-mid)] text-white" : "text-[var(--ink-2)]"
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>
    </div>
  );
}

export function Field({
  label,
  hint,
  children,
  className = "",
}: {
  label: string;
  hint?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <label className={`block min-w-0 ${className}`}>
      <span className="block text-sm font-medium text-[var(--ink-2)] mb-1">{label}</span>
      {children}
      {hint && <span className="block text-xs text-[var(--muted)] mt-1">{hint}</span>}
    </label>
  );
}

export function Toggle({
  checked,
  onChange,
  label,
  hint,
  disabled,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  label: string;
  hint?: React.ReactNode;
  disabled?: boolean;
}) {
  return (
    <label className={`flex items-start gap-3 ${disabled ? "opacity-50" : "cursor-pointer"}`}>
      <input
        type="checkbox"
        className="sr-only peer"
        checked={checked}
        disabled={disabled}
        onChange={(e) => onChange(e.target.checked)}
      />
      <span
        aria-hidden="true"
        className={`mt-0.5 shrink-0 h-6 w-11 rounded-full p-0.5 transition peer-focus-visible:ring-2 peer-focus-visible:ring-mor ${
          checked ? "bg-mor" : "bg-ink/15"
        }`}
      >
        <span className={`block h-5 w-5 rounded-full bg-white shadow transition ${checked ? "translate-x-5" : ""}`} />
      </span>
      <span className="min-w-0">
        <span className="block text-sm font-medium">{label}</span>
        {hint && <span className="block text-xs text-[var(--muted)]">{hint}</span>}
      </span>
    </label>
  );
}

export function ActiveChip({ active, on = "Active", off = "Off" }: { active: boolean; on?: string; off?: string }) {
  return <span className={`chip !py-0.5 !px-2 !text-[11.5px] ${active ? "chip-mint" : ""}`}>{active ? on : off}</span>;
}

export function ErrorBox({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <div className="card p-4 flex flex-wrap items-center justify-between gap-2">
      <p className="text-sm text-[var(--risk-text)]">{message}</p>
      {onRetry && (
        <button type="button" className="btn btn-quiet btn-xs" onClick={onRetry}>
          Try again
        </button>
      )}
    </div>
  );
}

export function Flash({ text }: { text: string | null }) {
  if (!text) return null;
  return (
    <p className="text-sm text-[var(--success-text)] flex items-center gap-1.5">
      <Icon name="check" className="h-4 w-4 shrink-0" /> {text}
    </p>
  );
}

/**
 * Edit panel: a right-hand drawer on desktop, full screen on phones. The body
 * scrolls; the footer (save / cancel) stays put.
 */
export function Sheet({
  title,
  onClose,
  children,
  footer,
  wide,
}: {
  title: string;
  onClose: () => void;
  children: React.ReactNode;
  footer?: React.ReactNode;
  wide?: boolean;
}) {
  const ref = useRef(onClose);
  useEffect(() => {
    ref.current = onClose;
  }, [onClose]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && ref.current();
    window.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
    };
  }, []);
  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-black/40" role="dialog" aria-modal="true" aria-label={title}>
      <button type="button" className="absolute inset-0 cursor-default" aria-label="Close" onClick={onClose} />
      <div
        className={`relative flex h-full w-full ${wide ? "sm:max-w-3xl" : "sm:max-w-xl"} flex-col bg-[var(--background)] shadow-2xl`}
      >
        <div className="flex items-center justify-between gap-3 border-b border-[var(--line)] px-4 py-3">
          <p className="font-heading font-bold text-lg truncate">{title}</p>
          <button type="button" className="btn btn-quiet btn-xs !px-2" onClick={onClose} aria-label="Close">
            <Icon name="x" className="h-4 w-4" />
          </button>
        </div>
        <div className="flex-1 overflow-y-auto overflow-x-hidden px-4 py-4 space-y-4">{children}</div>
        {footer && <div className="border-t border-[var(--line)] px-4 py-3 bg-white/60">{footer}</div>}
      </div>
    </div>
  );
}

// ───────────────────────────── pickers ─────────────────────────────

export type Option = { id: string; label: string; sub?: string };

function matches(o: Option, q: string) {
  if (!q) return true;
  return `${o.label} ${o.sub ?? ""}`.toLowerCase().includes(q);
}

/**
 * Pick several from a long list: chosen ones show as chips, a search box
 * lists the rest. Empty selection shows `emptyText`.
 */
export function MultiPick({
  options,
  value,
  onChange,
  placeholder = "Search to add",
  emptyText,
  max = 50,
}: {
  options: Option[];
  value: string[];
  onChange: (ids: string[]) => void;
  placeholder?: string;
  emptyText?: string;
  max?: number;
}) {
  const [q, setQ] = useState("");
  const [open, setOpen] = useState(false);
  const listId = useId();
  const byId = useMemo(() => new Map(options.map((o) => [o.id, o])), [options]);
  const chosen = new Set(value);
  const query = q.trim().toLowerCase();
  const hits = options.filter((o) => !chosen.has(o.id) && matches(o, query)).slice(0, max);

  return (
    <div className="space-y-2 min-w-0">
      <div className="flex flex-wrap gap-1.5">
        {value.length === 0 && emptyText && <span className="text-xs text-[var(--muted)] py-1">{emptyText}</span>}
        {value.map((id) => (
          <span key={id} className="chip chip-mor !py-1 max-w-full">
            <span className="truncate">{byId.get(id)?.label ?? "Removed item"}</span>
            <button
              type="button"
              className="shrink-0 opacity-80 hover:opacity-100"
              aria-label={`Remove ${byId.get(id)?.label ?? "item"}`}
              onClick={() => onChange(value.filter((v) => v !== id))}
            >
              <Icon name="x" className="h-3.5 w-3.5" />
            </button>
          </span>
        ))}
      </div>
      <div className="relative">
        <input
          className="input !py-2"
          type="search"
          value={q}
          placeholder={placeholder}
          aria-controls={listId}
          onFocus={() => setOpen(true)}
          onBlur={() => setTimeout(() => setOpen(false), 150)}
          onChange={(e) => {
            setQ(e.target.value);
            setOpen(true);
          }}
        />
        {open && (
          <div
            id={listId}
            className="absolute z-20 mt-1 max-h-64 w-full overflow-y-auto rounded-xl border border-[var(--line)] bg-white shadow-lg"
          >
            {hits.length === 0 ? (
              <p className="px-3 py-2 text-sm text-[var(--muted)]">{options.length ? "Nothing matches" : "Nothing to pick yet"}</p>
            ) : (
              hits.map((o) => (
                <button
                  key={o.id}
                  type="button"
                  className="block w-full px-3 py-2 text-left text-sm hover:bg-black/[0.04]"
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => {
                    onChange([...value, o.id]);
                    setQ("");
                  }}
                >
                  <span className="font-medium">{o.label}</span>
                  {o.sub && <span className="block text-xs text-[var(--muted)]">{o.sub}</span>}
                </button>
              ))
            )}
          </div>
        )}
      </div>
    </div>
  );
}

/** Pick one from a long list by typing. */
export function SearchPick({
  options,
  value,
  onChange,
  placeholder = "Search",
  max = 50,
}: {
  options: Option[];
  value: string | null;
  onChange: (id: string | null) => void;
  placeholder?: string;
  max?: number;
}) {
  const [q, setQ] = useState("");
  const [open, setOpen] = useState(false);
  const selected = options.find((o) => o.id === value) ?? null;
  const query = q.trim().toLowerCase();
  const hits = options.filter((o) => matches(o, query)).slice(0, max);

  if (selected && !open) {
    return (
      <div className="flex items-center gap-2 rounded-xl border border-[var(--line)] bg-white px-3 py-2 min-w-0">
        <div className="min-w-0 flex-1">
          <p className="text-sm font-bold truncate">{selected.label}</p>
          {selected.sub && <p className="text-xs text-[var(--muted)] truncate">{selected.sub}</p>}
        </div>
        <button
          type="button"
          className="btn btn-quiet btn-xs shrink-0"
          onClick={() => {
            setQ("");
            setOpen(true);
          }}
        >
          Change
        </button>
        <button type="button" className="btn btn-quiet btn-xs !px-2 shrink-0" aria-label="Clear" onClick={() => onChange(null)}>
          <Icon name="x" className="h-3.5 w-3.5" />
        </button>
      </div>
    );
  }

  return (
    <div className="relative">
      <input
        className="input"
        type="search"
        value={q}
        autoFocus={open && !!selected}
        placeholder={placeholder}
        onFocus={() => setOpen(true)}
        onBlur={() => setTimeout(() => setOpen(false), 150)}
        onChange={(e) => {
          setQ(e.target.value);
          setOpen(true);
        }}
      />
      {open && (
        <div className="absolute z-20 mt-1 max-h-72 w-full overflow-y-auto rounded-xl border border-[var(--line)] bg-white shadow-lg">
          {hits.length === 0 ? (
            <p className="px-3 py-2 text-sm text-[var(--muted)]">Nothing matches</p>
          ) : (
            hits.map((o) => (
              <button
                key={o.id}
                type="button"
                className={`block w-full px-3 py-2 text-left text-sm hover:bg-black/[0.04] ${o.id === value ? "bg-[var(--success-tint)]" : ""}`}
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => {
                  onChange(o.id);
                  setQ("");
                  setOpen(false);
                }}
              >
                <span className="font-medium">{o.label}</span>
                {o.sub && <span className="block text-xs text-[var(--muted)]">{o.sub}</span>}
              </button>
            ))
          )}
        </div>
      )}
    </div>
  );
}

// ───────────────────────────── photos ─────────────────────────────

/** Compress a photo (PNG / WebP logos under 1 MB keep their transparency) and upload it. */
export async function uploadImage(file: File, kind: string, maxSide = 1280): Promise<string> {
  const keep = (file.type === "image/png" || file.type === "image/webp") && file.size < 1024 * 1024;
  const blob = keep ? file : await compressImage(file, maxSide);
  return uploadFile(blob, kind);
}

export function Thumb({ imageKey, className = "h-12 w-12", alt = "" }: { imageKey: string | null | undefined; className?: string; alt?: string }) {
  if (!imageKey) {
    return (
      <span className={`${className} shrink-0 rounded-xl bg-ink/5 text-[var(--muted)] grid place-items-center`}>
        <Icon name="image" className="h-5 w-5 opacity-60" />
      </span>
    );
  }
  return (
    <span className={`${className} shrink-0 rounded-xl overflow-hidden border border-[var(--line)] bg-white block`}>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={fileUrl(imageKey)} alt={alt} className="h-full w-full object-cover" loading="lazy" />
    </span>
  );
}

/** One image: upload / replace / remove. */
export function ImageField({
  value,
  onChange,
  kind,
  maxSide,
  wide,
}: {
  value: string | null;
  onChange: (key: string | null) => void;
  kind: string;
  maxSide?: number;
  wide?: boolean;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const input = useRef<HTMLInputElement>(null);

  async function pick(f: File | undefined) {
    if (!f) return;
    setBusy(true);
    setError(null);
    try {
      onChange(await uploadImage(f, kind, maxSide));
    } catch (e) {
      setError(errText(e));
    } finally {
      setBusy(false);
      if (input.current) input.current.value = "";
    }
  }

  return (
    <div className="space-y-1.5">
      <div className="flex items-center gap-3">
        <Thumb imageKey={value} className={wide ? "h-20 w-36" : "h-16 w-16"} />
        <div className="flex flex-wrap gap-2">
          <button type="button" className="btn btn-quiet btn-xs" disabled={busy} onClick={() => input.current?.click()}>
            <Icon name="upload" className="h-3.5 w-3.5" />
            {busy ? "Uploading…" : value ? "Replace" : "Upload"}
          </button>
          {value && (
            <button type="button" className="btn btn-quiet btn-xs" disabled={busy} onClick={() => onChange(null)}>
              Remove
            </button>
          )}
        </div>
        <input ref={input} type="file" accept="image/jpeg,image/png,image/webp" className="hidden" onChange={(e) => pick(e.target.files?.[0])} />
      </div>
      {error && <p className="text-xs text-[var(--risk-text)]">{error}</p>}
    </div>
  );
}

// ───────────────────────────── shared lookups ─────────────────────────────

export type RegionRow = { id: string; name: string; areas: { id: string; name: string }[] };
export type GroupRow = { id: string; name: string; description: string | null; _count: { members: number } };
export type RetailerRow = {
  id: string;
  outletName: string;
  user: { name: string; phone: string | null } | null;
  area: { id: string; name: string; region?: { name: string } | null } | null;
};

export function areaOptions(regions: RegionRow[] | undefined): Option[] {
  return (regions ?? []).flatMap((r) => r.areas.map((a) => ({ id: a.id, label: a.name, sub: r.name })));
}

export function groupOptions(groups: GroupRow[] | undefined): Option[] {
  return (groups ?? []).map((g) => ({ id: g.id, label: g.name, sub: `${g._count.members} retailer${g._count.members === 1 ? "" : "s"}` }));
}

export function retailerOptions(retailers: RetailerRow[] | undefined): Option[] {
  return (retailers ?? []).map((r) => ({
    id: r.id,
    label: r.outletName,
    sub: [r.user?.name, r.user?.phone, r.area?.name].filter(Boolean).join(" · "),
  }));
}
