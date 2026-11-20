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
