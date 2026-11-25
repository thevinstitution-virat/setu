"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { Icon3D } from "@/components/icons3d/Icon3D";
import type { Icon3DName } from "@/lib/ui/icons3d";

export type SchemeBannerData = {
  id: string;
  /** Small caps line above the headline, e.g. "Scheme · till 30 Nov". */
  kicker?: string;
  title: string;
  subtitle?: string | null;
  cta?: string;
  href?: string;
  onClickAction?: () => void;
  /** A business photo for the banner. Without one, the 3D gift box fills in. */
  imageUrl?: string | null;
  icon?: Icon3DName;
  /** "Add 1 more case to unlock": only when the quote already carries the numbers. */
  progress?: { have: number; need: number; label: string };
};

/** One scheme card: marigold ground, dark text, 3D art bleeding off the right edge. */
export function SchemeBanner({ b, bob = false, className = "" }: { b: SchemeBannerData; bob?: boolean; className?: string }) {
  const inner = (
    <>
      <span className="relative z-10 block max-w-[62%] sm:max-w-[68%]">
        {b.kicker && <span className="block text-[10.5px] font-extrabold uppercase tracking-[.06em] opacity-80 truncate">{b.kicker}</span>}
        <span className="block font-heading font-bold text-[19px] leading-[1.12] mt-1 line-clamp-2">{b.title}</span>
        {b.subtitle && <span className="block text-[12.5px] font-semibold mt-1 opacity-80 line-clamp-2">{b.subtitle}</span>}
        {b.progress && (
          <span className="block mt-2.5">
            <span className="block h-1.5 rounded-full bg-black/15 overflow-hidden">
              <span className="block h-full rounded-full bg-[var(--ink)]" style={{ width: `${Math.min(100, Math.round((b.progress.have / b.progress.need) * 100))}%` }} />
            </span>
            <span className="block text-[11.5px] font-bold mt-1">{b.progress.label}</span>
          </span>
        )}
        {b.cta && <span className="inline-flex items-center mt-3 min-h-10 px-4 rounded-[12px] bg-[var(--ink)] text-white text-[13px] font-bold">{b.cta}</span>}
      </span>
      {b.imageUrl ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={b.imageUrl} alt="" className="absolute right-0 top-0 h-full w-[40%] object-cover rounded-r-[28px]" />
      ) : (
        <span className="absolute -right-2 top-1/2 -translate-y-1/2">
          <Icon3D name={b.icon ?? "gift-box"} size={104} animate={bob ? "bob" : "none"} />
        </span>
      )}
    </>
  );
  const cls = `scheme-card relative block overflow-hidden text-left rounded-[28px] bg-[var(--scheme)] text-[var(--on-scheme)] p-4 min-h-[136px] ${className}`;
  if (b.href) {
    const external = /^https?:\/\//i.test(b.href);
    return external ? (
      <a href={b.href} target="_blank" rel="noopener noreferrer" className={cls}>
        {inner}
      </a>
    ) : (
      <Link href={b.href} className={cls}>
        {inner}
      </Link>
    );
  }
  if (b.onClickAction)
    return (
      <button type="button" onClick={b.onClickAction} className={`${cls} w-full`}>
        {inner}
      </button>
    );
  return <div className={cls}>{inner}</div>;
}

/** A sideways carousel of scheme banners: advances every 5s, pauses while touched or hovered. */
export default function SchemeCarousel({ items }: { items: SchemeBannerData[] }) {
  const track = useRef<HTMLDivElement>(null);
  const [paused, setPaused] = useState(false);
  const [index, setIndex] = useState(0);

  useEffect(() => {
    if (items.length < 2 || paused) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const t = window.setInterval(() => setIndex((i) => (i + 1) % items.length), 5000);
    return () => window.clearInterval(t);
  }, [items.length, paused]);

  useEffect(() => {
    const el = track.current;
    const child = el?.children[index] as HTMLElement | undefined;
    if (el && child) el.scrollTo({ left: child.offsetLeft - el.offsetLeft, behavior: "smooth" });
  }, [index]);

  if (!items.length) return null;
  return (
    <div
      className="space-y-2"
      onPointerEnter={() => setPaused(true)}
      onPointerLeave={() => setPaused(false)}
      onTouchStart={() => setPaused(true)}
      onTouchEnd={() => window.setTimeout(() => setPaused(false), 4000)}
    >
      <div ref={track} className="flex gap-3 overflow-x-auto snap-x snap-mandatory no-scrollbar" onScroll={(e) => {
        const el = e.currentTarget;
        const w = (el.children[0] as HTMLElement | undefined)?.offsetWidth ?? 1;
        const i = Math.round(el.scrollLeft / (w + 12));
        if (i !== index && paused) setIndex(i);
      }}>
        {items.map((b, i) => (
          <div key={b.id} className="snap-start shrink-0 w-[88%] sm:w-[420px]">
            <SchemeBanner b={b} bob={i === index} />
          </div>
        ))}
      </div>
      {items.length > 1 && (
        <div className="flex justify-center gap-1.5" aria-hidden="true">
          {items.map((b, i) => (
            <span key={b.id} className={`h-1.5 rounded-full transition-all ${i === index ? "w-5 bg-[var(--accent)]" : "w-1.5 bg-[var(--line-2)]"}`} />
          ))}
        </div>
      )}
    </div>
  );
}
