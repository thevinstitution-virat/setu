import Image from "next/image";
import { APP_NAME } from "@/lib/brand";

/**
 * VBiz Pro logo files (public/brand), vector, viewBox trimmed to the artwork.
 * Two colours only: saffron #DB5C17 + ink #0F2A2A. The brand uses no tagline.
 * - vbiz-logo.svg          V mark + "VBiz Pro" on one line (headers)
 * - vbiz-logo-white.svg    same, all white (one-colour use)
 * - vbiz-logo-ondark.svg   saffron V + white name (dark backgrounds)
 * - vbiz-logo-stacked.svg  mark above the name (footer)
 * - vbiz-mark.svg          the V mark alone (tiles, small spots)
 */
export const LOGO = {
  wide: { src: "/brand/vbiz-logo.svg", w: 380, h: 74.4 },
  white: { src: "/brand/vbiz-logo-white.svg", w: 380, h: 74.4 },
  onDark: { src: "/brand/vbiz-logo-ondark.svg", w: 380, h: 74.4 },
  stacked: { src: "/brand/vbiz-logo-stacked.svg", w: 227, h: 180.4 },
  mark: { src: "/brand/vbiz-mark.svg", w: 82, h: 66.8 },
} as const;

type LogoKind = keyof typeof LOGO;

/** One of the logo files at a given height (width follows the artwork). */
export function Logo({ kind = "wide", height, className, priority }: { kind?: LogoKind; height: number; className?: string; priority?: boolean }) {
  const f = LOGO[kind];
  const width = Math.round((f.w / f.h) * height);
  return (
    <Image
      src={f.src}
      alt={APP_NAME}
      width={width}
      height={height}
      priority={priority}
      unoptimized
      className={className}
      style={{ width, height, maxWidth: "100%", objectFit: "contain" }}
    />
  );
}

/** The "V" mark on a white tile, for square spots (console, avatars). */
export function BrandMark({ size = 36 }: { size?: number }) {
  return (
    <span
      className="inline-grid place-items-center shrink-0 bg-white"
      style={{
        width: size,
        height: size,
        borderRadius: size * 0.28,
        border: "1px solid var(--line)",
        boxShadow: "0 8px 18px -12px rgba(15,42,42,.45)",
      }}
    >
      <Image src={LOGO.mark.src} alt="" unoptimized width={Math.round(size * 0.62)} height={Math.round(size * 0.5)} style={{ width: "auto", height: size * 0.5 }} />
    </span>
  );
}

/**
 * Our own logo, or — for a business on its own brand (white label, Phase 9) —
 * that business's logo and name. `sub` is a small label beside our logo (the
 * signed-in role); `large` is the bigger size for sign-in pages.
 */
export function BrandLockup({
  size = 36,
  sub,
  name,
  logoUrl,
  large,
}: {
  size?: number;
  sub?: string;
  name?: string;
  logoUrl?: string | null;
  large?: boolean;
}) {
  const own = !name || name === APP_NAME;
  if (own && !logoUrl) {
    return (
      <span className="flex items-center gap-3 min-w-0">
        <Logo kind="wide" height={Math.round(size * (large ? 0.95 : 0.78))} priority />
        {sub && (
          <span className="hidden sm:block border-l border-[var(--line)] pl-3 text-[12px] font-bold leading-tight text-[var(--muted)] whitespace-nowrap">
            {sub}
          </span>
        )}
      </span>
    );
  }
  return (
    <span className="flex items-center gap-2.5 min-w-0">
      {logoUrl ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={logoUrl} alt="" width={size} height={size} className="shrink-0 object-contain rounded-lg bg-white" style={{ width: size, height: size }} />
      ) : (
        <BrandMark size={size} />
      )}
      <span className="min-w-0">
        <span className="block font-heading font-bold text-[16px] leading-none whitespace-nowrap text-ink truncate max-w-[220px]">{own ? APP_NAME : name}</span>
        {sub && <span className="block text-[11.5px] font-semibold leading-none mt-1 text-[var(--muted)] whitespace-nowrap">{sub}</span>}
      </span>
    </span>
  );
}
