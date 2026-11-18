import { APP_NAME, APP_NAME_HI } from "@/lib/brand";

/** The bridge mark on a Mor tile — same mark as the landing nav. */
export function BrandMark({ size = 36 }: { size?: number }) {
  return (
    <span
      className="inline-grid place-items-center shrink-0 text-genda"
      style={{
        width: size,
        height: size,
        borderRadius: size * 0.28,
        background: "linear-gradient(150deg, var(--mor), var(--mor-mid) 60%, var(--mor-dark))",
        boxShadow: "0 1px 0 rgba(255,255,255,.14) inset, 0 10px 20px -12px rgba(8,38,37,.9)",
      }}
    >
      <svg
        viewBox="0 0 24 24"
        style={{ width: size * 0.56, height: size * 0.56 }}
        aria-hidden="true"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
      >
        <path d="M2 17c4-7 16-7 20 0" />
        <path d="M2 17h20M6 17v-3.5M10 17v-5M14 17v-5M18 17v-3.5" />
      </svg>
    </span>
  );
}

/** Mark + English name + Devanagari name, as on the landing page. */
export function BrandLockup({ size = 36, sub }: { size?: number; sub?: string }) {
  return (
    <span className="flex items-center gap-2.5 min-w-0">
      <BrandMark size={size} />
      <span className="min-w-0">
        <span className="block font-heading font-bold text-[16px] leading-none whitespace-nowrap text-ink">
          {APP_NAME}
        </span>
        <span className="block text-[11.5px] font-bold leading-none mt-1 text-[var(--kesar-text)] whitespace-nowrap">
          {APP_NAME_HI}
          {sub && <span className="text-[var(--muted)] font-semibold"> · {sub}</span>}
        </span>
      </span>
    </span>
  );
}
