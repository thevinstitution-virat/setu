"use client";

import { useLayoutEffect, useRef, useState } from "react";
import { Icon3D } from "@/components/icons3d/Icon3D";
import { categoryIcon } from "@/lib/ui/categoryIcons";

/**
 * A vertical rail of category tiles (3D icon + name). The active tile gets an
 * accent border and a sliding indicator. Icons come from the category name
 * through categoryIcon(), so every business's own naming works.
 */
export default function CategoryRail({
  items,
  value,
  onChangeAction,
  allLabel = "All",
  className = "",
}: {
  items: { id: string; name: string }[];
  value: string | null;
  onChangeAction: (id: string | null) => void;
  allLabel?: string;
  className?: string;
}) {
  const wrap = useRef<HTMLDivElement>(null);
  const [bar, setBar] = useState<{ top: number; height: number } | null>(null);

  useLayoutEffect(() => {
    const el = wrap.current?.querySelector<HTMLElement>('[aria-pressed="true"]');
    if (el) setBar({ top: el.offsetTop + 10, height: el.offsetHeight - 20 });
  }, [value, items.length]);

  const all = [{ id: "", name: allLabel }, ...items];
  return (
    <div ref={wrap} className={`relative flex flex-col gap-2 ${className}`} role="group" aria-label="Categories">
      {bar && <span aria-hidden="true" className="absolute -right-[7px] w-1 rounded-full bg-[var(--accent)] transition-all duration-300" style={{ top: bar.top, height: bar.height }} />}
      {all.map((c) => {
        const on = (c.id || null) === value;
        return (
          <button
            key={c.id || "all"}
            type="button"
            aria-pressed={on}
            onClick={() => onChangeAction(c.id || null)}
            className={`i3d-host grid justify-items-center gap-1 rounded-[16px] border-[1.5px] px-1 py-2 text-center text-[11px] font-bold leading-tight transition ${
              on ? "border-[var(--accent)] bg-[var(--surface)] text-[var(--ink)]" : "border-transparent text-[var(--ink-2)]"
            }`}
          >
            <Icon3D name={c.id ? categoryIcon(c.name) : "box-sealed"} size={40} tinted animate="tap" />
            <span className="line-clamp-2 break-words">{c.name}</span>
          </button>
        );
      })}
    </div>
  );
}
