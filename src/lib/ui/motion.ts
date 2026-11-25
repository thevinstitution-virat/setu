/**
 * Shared motion presets (redesign §5). CSS and the Web Animations API only:
 * no animation library. Every helper is a no-op under reduced motion.
 */

export const EASE_OUT = "cubic-bezier(.2, .8, .2, 1)";
export const EASE_SPRING = "linear(0, .25 7%, .8 20%, 1.04 32%, 1.06 40%, 1.01 55%, .995 70%, 1)";

export const fadeUp = { distance: 8, duration: 240 } as const;
export const stagger = 40;
export const spring = { easing: EASE_SPRING, duration: 320 } as const;

export function reducedMotion(): boolean {
  return typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches === true;
}

/** Fade an element up 8px over 240ms. Returns the animation (or null when motion is off). */
export function playFadeUp(el: Element, index = 0): Animation | null {
  if (reducedMotion() || !("animate" in el)) return null;
  return el.animate(
    [
      { opacity: 0, transform: `translateY(${fadeUp.distance}px)` },
      { opacity: 1, transform: "translateY(0)" },
    ],
    { duration: fadeUp.duration, delay: index * stagger, easing: EASE_OUT, fill: "backwards" },
  );
}

/** Light haptic tap where the browser supports it. */
export function buzz(ms = 10) {
  try {
    if (!reducedMotion()) navigator.vibrate?.(ms);
  } catch {
    /* not supported */
  }
}
