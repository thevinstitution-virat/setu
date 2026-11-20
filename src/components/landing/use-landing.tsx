"use client";

import { useEffect, useId, useMemo, useRef, useState, useSyncExternalStore } from "react";

function subscribeReducedMotion(callback: () => void) {
  const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
  mq.addEventListener("change", callback);
  return () => mq.removeEventListener("change", callback);
}

export function useReducedMotion() {
  return useSyncExternalStore(
    subscribeReducedMotion,
    () => window.matchMedia("(prefers-reduced-motion: reduce)").matches,
    () => false
  );
}

/** Toggles `animation-play-state` on the element via a class while it's off-screen. */
export function useInView<T extends HTMLElement>(threshold = 0.15) {
  const ref = useRef<T | null>(null);
  const [inView, setInView] = useState(true);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const io = new IntersectionObserver((entries) => setInView(entries[0]?.isIntersecting ?? true), { threshold });
    io.observe(el);
    return () => io.disconnect();
  }, [threshold]);
  return [ref, inView] as const;
}

const inr = new Intl.NumberFormat("en-IN");

/**
 * A number that counts up (or down, when `from` > `to`) the first time it
 * scrolls into view. Server HTML and reduced motion show the final value.
 */
export function CountUp({
  to,
  from = 0,
  prefix = "",
  suffix = "",
  duration = 1400,
  className,
  style,
}: {
  to: number;
  from?: number;
  prefix?: string;
  suffix?: string;
  duration?: number;
  className?: string;
  style?: React.CSSProperties;
}) {
  const ref = useRef<HTMLSpanElement | null>(null);
  const [value, setValue] = useState(to);
  const reduced = useReducedMotion();

  useEffect(() => {
    const el = ref.current;
    if (!el || reduced) return;
    // Already on screen at load: leave the final value (no flash of zero).
    const r = el.getBoundingClientRect();
    if (r.top < window.innerHeight && r.bottom > 0) return;
    let raf = 0;
    setValue(from);
    const io = new IntersectionObserver(
      (entries) => {
        if (!entries[0]?.isIntersecting) return;
        io.disconnect();
        const start = performance.now();
        const step = (now: number) => {
          const t = Math.min(1, (now - start) / duration);
          const eased = 1 - Math.pow(1 - t, 4);
          setValue(Math.round(from + (to - from) * eased));
          if (t < 1) raf = requestAnimationFrame(step);
        };
        raf = requestAnimationFrame(step);
      },
      { threshold: 0.4 }
    );
    io.observe(el);
    return () => {
      io.disconnect();
      cancelAnimationFrame(raf);
    };
  }, [to, from, duration, reduced]);

  return (
    <span ref={ref} className={className} style={style}>
      {prefix}
      {inr.format(value)}
      {suffix}
    </span>
  );
}

/**
 * Words stacked in one grid cell (so the line never reflows), one shown at a
 * time with a slide-up swap.
 */
export function RotatingWord({ words, interval = 2600 }: { words: string[]; interval?: number }) {
  const [i, setI] = useState(0);
  const reduced = useReducedMotion();
  useEffect(() => {
    if (reduced || words.length < 2) return;
    const id = setInterval(() => {
      if (!document.hidden) setI((n) => (n + 1) % words.length);
    }, interval);
    return () => clearInterval(id);
  }, [reduced, words.length, interval]);

  return (
    <span className="ls-rot" aria-live="off">
      {words.map((w, n) => (
        <span key={w} className={`ls-rot-w ${n === i ? "on" : ""}`} aria-hidden={n !== i}>
          <span className="ls-mark">{w}</span>
        </span>
      ))}
    </span>
  );
}

/** 16 confetti pieces with randomized fling vectors, as CSS custom properties. */
function confettiPieces(seed: number) {
  const pieces: { dx: number; dy: number; r: number }[] = [];
  let s = seed || 1;
  const rand = () => {
    s = (s * 9301 + 49297) % 233280;
    return s / 233280;
  };
  for (let i = 0; i < 16; i++) {
    const angle = rand() * Math.PI * 2;
    const dist = 40 + rand() * 60;
    pieces.push({
      dx: Math.round(Math.cos(angle) * dist),
      dy: Math.round(Math.sin(angle) * dist - 20),
      r: Math.round(rand() * 480 - 240),
    });
  }
  return pieces;
}

export function Confetti({ className }: { className?: string }) {
  const id = useId();
  const seed = useMemo(() => {
    let h = 0;
    for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) % 100000;
    return h + 1;
  }, [id]);
  const pieces = useMemo(() => confettiPieces(seed), [seed]);
  return (
    <div className={`ls-cf ${className ?? ""}`} aria-hidden="true">
      {pieces.map((p, i) => (
        <i key={i} style={{ "--dx": `${p.dx}px`, "--dy": `${p.dy}px`, "--r": `${p.r}deg` } as React.CSSProperties} />
      ))}
    </div>
  );
}
