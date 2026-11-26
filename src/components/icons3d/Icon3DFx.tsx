"use client";

import { useEffect } from "react";

/**
 * Mount once (root layout). On a click it plays the jelly + sparkle burst on the 3D icons of the
 * tile that was clicked: the nearest `.i3d-host` (all icons inside it) or an icon marked
 * `data-fx`. Pure CSS does the drawing; this only sets `data-burst` for 700ms. No-op under
 * reduced motion.
 */
export default function Icon3DFx() {
  useEffect(() => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const timers = new WeakMap<Element, number>();
    const onClick = (e: MouseEvent) => {
      const hit = (e.target as Element | null)?.closest?.(".i3d-host, .i3d[data-fx]");
      if (!hit) return;
      const icons = hit.matches(".i3d") ? [hit] : [...hit.querySelectorAll(".i3d")];
      for (const el of icons) {
        window.clearTimeout(timers.get(el));
        el.removeAttribute("data-burst");
        void (el as HTMLElement).offsetWidth; // restart the animation on a quick second click
        el.setAttribute("data-burst", "");
        timers.set(el, window.setTimeout(() => el.removeAttribute("data-burst"), 700));
      }
    };
    document.addEventListener("click", onClick);
    return () => document.removeEventListener("click", onClick);
  }, []);
  return null;
}
