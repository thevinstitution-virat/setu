"use client";

import { useEffect } from "react";

/**
 * Page-wide motion for the landing page, in one place:
 * - `.ls-rv` blocks fade/slide in once they scroll into view (IntersectionObserver,
 *   works in every browser; `--i` staggers). Shown blocks get a `data-in`
 *   attribute, not a class, because React rewrites `className` on re-render
 *   (FAQ open/close, language switch) and would wipe a class we added.
 *   Blocks React mounts later (language switch remounts keyed lists) are picked
 *   up by a MutationObserver.
 * - the nav switches from "on dark hero" to "on cream" after the hero, and a
 *   thin progress bar tracks scroll;
 * - `.ls-glow` cards get a light that follows the pointer.
 * Everything stays visible without JS: hiding starts only once `ls-ready` is set,
 * and blocks already on screen are marked shown first.
 */
export default function LandingFx() {
  useEffect(() => {
    const root = document.documentElement;
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    const onScreen = (el: Element) => {
      const r = el.getBoundingClientRect();
      return r.top < window.innerHeight * 0.92 && r.bottom > 0;
    };
    const show = (el: Element) => el.setAttribute("data-in", "");

    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          if (e.isIntersecting) {
            show(e.target);
            io.unobserve(e.target);
          }
        }
      },
      { rootMargin: "0px 0px -8% 0px", threshold: 0.12 }
    );

    const track = (el: Element) => {
      if (el.hasAttribute("data-in")) return;
      if (reduced || onScreen(el)) show(el);
      else io.observe(el);
    };
    document.querySelectorAll(".ls-rv").forEach(track);

    const mo = new MutationObserver((records) => {
      for (const r of records) {
        r.addedNodes.forEach((n) => {
          if (!(n instanceof Element)) return;
          if (n.matches(".ls-rv")) track(n);
          n.querySelectorAll(".ls-rv").forEach(track);
        });
      }
    });
    const main = document.querySelector(".ls") ?? document.body;
    mo.observe(main, { childList: true, subtree: true });
    root.classList.add("ls-ready");

    // Nav state + progress bar
    const hero = document.querySelector<HTMLElement>(".ls-herow");
    const bar = document.querySelector<HTMLElement>(".ls-prog");
    let ticking = false;
    const onScroll = () => {
      if (ticking) return;
      ticking = true;
      requestAnimationFrame(() => {
        ticking = false;
        const y = window.scrollY;
        const heroEnd = hero ? hero.offsetTop + hero.offsetHeight - 80 : 400;
        root.classList.toggle("ls-past-hero", y > heroEnd);
        root.classList.toggle("ls-scrolled", y > 8);
        const max = document.documentElement.scrollHeight - window.innerHeight;
        if (bar) bar.style.transform = `scaleX(${max > 0 ? Math.min(1, y / max) : 0})`;
      });
    };
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });

    // Pointer light on cards
    const onMove = (ev: PointerEvent) => {
      const card = (ev.target as Element | null)?.closest?.<HTMLElement>(".ls-glow");
      if (!card) return;
      const r = card.getBoundingClientRect();
      card.style.setProperty("--mx", `${ev.clientX - r.left}px`);
      card.style.setProperty("--my", `${ev.clientY - r.top}px`);
    };
    if (!reduced) document.addEventListener("pointermove", onMove, { passive: true });

    return () => {
      io.disconnect();
      mo.disconnect();
      window.removeEventListener("scroll", onScroll);
      document.removeEventListener("pointermove", onMove);
      root.classList.remove("ls-ready", "ls-past-hero", "ls-scrolled");
    };
  }, []);

  return null;
}
