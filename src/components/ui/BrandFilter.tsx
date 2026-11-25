"use client";

import { fileUrl } from "@/components/store/format";

export type BrandOption = { id: string; name: string; logoKey: string | null };

/**
 * Segmented chips: All | the brands of this business's catalogue (never a
 * hard-coded company). Scrolls sideways past four. With `param` set the
 * choice is mirrored into the URL (?brand=…) so it survives a reload.
 */
export default function BrandFilter({
  brands,
  value,
  onChangeAction,
  param,
  allLabel = "All",
  className = "",
}: {
  brands: BrandOption[];
  value: string | null;
  onChangeAction: (id: string | null) => void;
  param?: string;
  allLabel?: string;
  className?: string;
}) {
  function pick(id: string | null) {
    onChangeAction(id);
    if (param && typeof window !== "undefined") {
      const url = new URL(window.location.href);
      if (id) url.searchParams.set(param, id);
      else url.searchParams.delete(param);
      window.history.replaceState(null, "", url);
    }
  }
  if (brands.length < 1) return null;
  const chip = (on: boolean) =>
    `shrink-0 inline-flex items-center gap-1.5 min-h-10 px-3.5 rounded-full text-[13px] font-bold transition ${
      on ? "bg-[var(--ink)] text-white" : "bg-[var(--surface-2)] text-[var(--ink)]"
    }`;
  return (
    <div className={`flex gap-2 overflow-x-auto no-scrollbar ${className}`} role="group" aria-label="Brand">
      <button type="button" aria-pressed={value === null} onClick={() => pick(null)} className={chip(value === null)}>
        {allLabel}
      </button>
      {brands.map((b) => (
        <button key={b.id} type="button" aria-pressed={value === b.id} onClick={() => pick(value === b.id ? null : b.id)} className={chip(value === b.id)}>
          {b.logoKey && (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={fileUrl(b.logoKey)} alt="" className="h-4 w-4 rounded object-contain bg-white" />
          )}
          {b.name}
        </button>
      ))}
    </div>
  );
}
