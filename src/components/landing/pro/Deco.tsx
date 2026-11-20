/**
 * Decorative artwork in the VBiz Pro logo's own language: the yellow sun with
 * the blue cart, the red-orange "V" that rises into an arrow, the violet dot.
 * Purely visual (aria-hidden); positioned by the parent's CSS.
 */

const BLUE = "#054099";
const YELLOW = "#fbac26";
const RED = "#ed3237";

export function CartSun({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 160 140" aria-hidden="true">
      <circle cx="84" cy="58" r="44" fill={YELLOW} />
      <g fill="none" stroke={BLUE} strokeWidth="8" strokeLinecap="round" strokeLinejoin="round">
        <path d="M14 22h18l16 62h66l16-46H40" />
        <path d="M58 52h48a10 10 0 0 1 0 20H66a6 6 0 0 1 0-12h34" strokeWidth="6" />
      </g>
      <circle cx="60" cy="112" r="9" fill={BLUE} />
      <circle cx="106" cy="112" r="9" fill={BLUE} />
    </svg>
  );
}

export function RiseArrow({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 120 120" aria-hidden="true">
      <defs>
        <linearGradient id="vp-rise" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#e49260" />
          <stop offset="1" stopColor="#c3362f" />
        </linearGradient>
        <linearGradient id="vp-dot" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#3f8cff" />
          <stop offset="1" stopColor="#721cc8" />
        </linearGradient>
      </defs>
      <path d="M14 34l34 64 50-82" fill="none" stroke="url(#vp-rise)" strokeWidth="14" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M72 16h26v26" fill="none" stroke="url(#vp-rise)" strokeWidth="14" strokeLinecap="round" strokeLinejoin="round" />
      <circle cx="40" cy="14" r="10" fill="url(#vp-dot)" />
    </svg>
  );
}

export function Coin({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 80 80" aria-hidden="true">
      <circle cx="40" cy="40" r="34" fill={YELLOW} />
      <circle cx="40" cy="40" r="26" fill="none" stroke="#fff" strokeOpacity=".55" strokeWidth="3" />
      <text x="40" y="52" textAnchor="middle" fontSize="34" fontWeight="800" fill={BLUE} fontFamily="system-ui, sans-serif">
        ₹
      </text>
    </svg>
  );
}

export function Parcel({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 90 90" aria-hidden="true">
      <path d="M45 8l34 18v38L45 82 11 64V26z" fill="#fff" stroke={BLUE} strokeWidth="5" strokeLinejoin="round" />
      <path d="M11 26l34 18 34-18M45 44v38" fill="none" stroke={BLUE} strokeWidth="5" strokeLinejoin="round" />
      <path d="M28 17l34 18" stroke={RED} strokeWidth="6" strokeLinecap="round" />
    </svg>
  );
}

export function Dot({ className }: { className?: string }) {
  return <span className={`vp-dot ${className ?? ""}`} aria-hidden="true" />;
}

/** A gentle rising line chart, for dark bands. */
export function TrendLine({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 600 160" preserveAspectRatio="none" aria-hidden="true">
      <path d="M0 140 C 80 130, 110 100, 170 108 S 260 70, 320 80 S 420 30, 470 44 S 560 12, 600 6" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" pathLength={1} />
    </svg>
  );
}
