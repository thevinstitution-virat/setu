"use client";

import { useEffect, useRef, useState } from "react";
import Icon from "@/components/Icon";
import { formatINR } from "@/lib/money";
import { reducedMotion } from "@/lib/ui/motion";

/** Count a paise value up (or down) to its new figure over 400ms. */
function useCountTo(target: number | null): number | null {
  const [shown, setShown] = useState<number | null>(target);
  const from = useRef<number | null>(target);
  useEffect(() => {
    if (target === null) return;
    const start = from.current ?? target;
    if (start === target || reducedMotion()) {
      from.current = target;
      const t = window.setTimeout(() => setShown(target), 0);
      return () => window.clearTimeout(t);
    }
    let raf = 0;
    const t0 = performance.now();
    const tick = (now: number) => {
      const k = Math.min(1, (now - t0) / 400);
      const eased = 1 - Math.pow(1 - k, 3);
      setShown(Math.round(start + (target - start) * eased));
      if (k < 1) raf = requestAnimationFrame(tick);
      else from.current = target;
    };
    raf = requestAnimationFrame(tick);
    return () => {
      cancelAnimationFrame(raf);
      from.current = target;
    };
  }, [target]);
  return target === null ? null : (shown ?? target);
}

/**
 * Sticky accent bar above the bottom tabs: "{n} items · ₹total · View cart →".
 * Springs in and out; the total counts up. `total` is paise, or null while the
 * server prices the cart. Hidden when the cart is empty.
 */
export default function CartBar({
  count,
  total,
  note,
  warn,
  stale = false,
  label = "View cart",
  onClickAction,
}: {
  count: number;
  total: number | null;
  /** A short second line, e.g. "saving ₹412". */
  note?: string | null;
  /** A warning line, e.g. "Add ₹800 more to order". */
  warn?: string | null;
  stale?: boolean;
  label?: string;
  onClickAction: () => void;
}) {
  const shown = useCountTo(total);
  if (count < 1) return null;
  return (
    <>
      <div aria-hidden="true" className="h-24" />
      <div className="fixed bottom-[calc(76px+env(safe-area-inset-bottom)+8px)] md:bottom-4 inset-x-3 md:inset-x-auto md:left-[calc(76px+16px)] lg:left-[calc(256px+16px)] md:right-4 z-30 pointer-events-none">
        <button
          type="button"
          data-cartbar
          onClick={onClickAction}
          className="cartbar-in pointer-events-auto w-full max-w-5xl mx-auto flex items-center justify-between gap-3 px-4 min-h-[60px] py-2 text-left rounded-[18px] bg-[var(--accent)] text-[var(--accent-on)] shadow-[var(--e-cta)]"
        >
          <span className="min-w-0">
            <span className="block text-[12px] font-semibold opacity-90 truncate">
              {count} item{count === 1 ? "" : "s"}
              {note ? ` · ${note}` : ""}
            </span>
            <span className={`block font-heading font-bold text-[18px] leading-tight num ${stale ? "opacity-70" : ""}`}>
              {shown === null ? "Checking prices…" : formatINR(shown)}
            </span>
            {warn && <span className="block text-[11.5px] font-bold">{warn}</span>}
          </span>
          <span className="inline-flex items-center gap-1.5 font-bold text-[14px] shrink-0">
            {label} <Icon name="arrow" className="h-4 w-4" weight="bold" />
          </span>
        </button>
      </div>
    </>
  );
}
