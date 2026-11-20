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

/**
 * Mark + English name + Devanagari name, as on the landing page. With a
 * business's own name (white label, Phase 9) it shows that name and its logo
 * instead; the Devanagari line is only for our own name.
 */
export function BrandLockup({ size = 36, sub, name, logoUrl }: { size?: number; sub?: string; name?: string; logoUrl?: string | null }) {
  const own = !name || name === APP_NAME;
  return (
    <span className="flex items-center gap-2.5 min-w-0">
      {logoUrl ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={logoUrl} alt="" width={size} height={size} className="shrink-0 object-contain rounded-lg bg-white" style={{ width: size, height: size }} />
      ) : (
        <BrandMark size={size} />
      )}
      <span className="min-w-0">
        <span className="block font-heading font-bold text-[16px] leading-none whitespace-nowrap text-ink truncate max-w-[220px]">
          {own ? APP_NAME : name}
        </span>
        <span className="block text-[11.5px] font-bold leading-none mt-1 text-[var(--kesar-text)] whitespace-nowrap">
          {own ? APP_NAME_HI : null}
          {sub && <span className="text-[var(--muted)] font-semibold">{own ? " · " : ""}{sub}</span>}
        </span>
      </span>
    </span>
  );
}
