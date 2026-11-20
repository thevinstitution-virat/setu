import { APP_NAME, APP_NAME_HI } from "@/lib/brand";

/** The VBiz Pro glyph: a "V" whose right arm rises into an arrow (growth). */
export function BrandGlyph({ size, className }: { size?: number; className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      className={className}
      style={size ? { width: size, height: size } : undefined}
      aria-hidden="true"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.6"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M4 6.5l6.2 11.5L18.6 4" />
      <path d="M13.6 4h5v5" />
    </svg>
  );
}

/** The VBiz Pro mark on a Mor tile — same mark as the landing nav. */
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
      <BrandGlyph size={size * 0.58} />
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
