import { EASE_OUT, buzz, reducedMotion } from "@/lib/ui/motion";

/**
 * The first add of a product flies a thumbnail along a curve to the cart bar
 * (Web Animations API, no library) and gives a light vibration. Under reduced
 * motion nothing flies; the vibration is also skipped.
 */
export function flyToCart(from: HTMLElement) {
  buzz(10);
  if (reducedMotion() || typeof document === "undefined" || !("animate" in from)) return;

  const src = from.closest("[data-product-card]")?.querySelector("img")?.getAttribute("src") ?? null;
  const a = from.getBoundingClientRect();
  const bar = document.querySelector("[data-cartbar]")?.getBoundingClientRect();
  const tx = bar ? bar.left + 28 : window.innerWidth / 2;
  const ty = bar ? bar.top + bar.height / 2 : window.innerHeight - 110;
  const x0 = a.left + a.width / 2 - 22;
  const y0 = a.top + a.height / 2 - 22;
  const dx = tx - 22 - x0;
  const dy = ty - 22 - y0;

  const dot = document.createElement("div");
  dot.setAttribute("aria-hidden", "true");
  Object.assign(dot.style, {
    position: "fixed",
    left: `${x0}px`,
    top: `${y0}px`,
    width: "44px",
    height: "44px",
    borderRadius: "14px",
    zIndex: "80",
    pointerEvents: "none",
    background: src ? `#fff url("${src.replace(/"/g, "%22")}") center/contain no-repeat` : "var(--accent)",
    boxShadow: "0 10px 24px -8px rgba(15,42,42,.4)",
  } satisfies Partial<CSSStyleDeclaration>);
  document.body.appendChild(dot);

  const anim = dot.animate(
    [
      { transform: "translate(0,0) scale(1)", opacity: 1, offset: 0 },
      { transform: `translate(${dx * 0.45}px, ${dy * 0.45 - 70}px) scale(.85)`, opacity: 1, offset: 0.55 },
      { transform: `translate(${dx}px, ${dy}px) scale(.35)`, opacity: 0.2, offset: 1 },
    ],
    { duration: 560, easing: EASE_OUT },
  );
  anim.onfinish = anim.oncancel = () => dot.remove();
}
