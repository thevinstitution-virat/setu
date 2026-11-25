"use client";

import { Icon3D } from "@/components/icons3d/Icon3D";

/**
 * Full-screen "order placed": the box pops in, then the truck slides off
 * (1.6s in all) while the caller moves on to the order page. Reduced motion
 * keeps the picture and drops the slide.
 */
export default function OrderPlaced({ orderNumber }: { orderNumber: string }) {
  return (
    <div className="fixed inset-0 z-[90] grid place-items-center bg-[var(--surface)] px-6" role="status" aria-live="polite">
      <div className="relative flex flex-col items-center text-center overflow-hidden w-full max-w-sm">
        <Icon3D name="box-sealed" size={160} animate="pop" priority />
        <div className="order-truck" aria-hidden="true">
          <Icon3D name="truck" size={96} priority />
        </div>
        <p className="font-heading font-bold text-2xl mt-2">Order placed</p>
        <p className="text-sm text-[var(--muted)] mt-1 num">{orderNumber}</p>
        <p className="text-sm text-[var(--muted)] mt-1">Taking you to the order…</p>
      </div>
    </div>
  );
}
