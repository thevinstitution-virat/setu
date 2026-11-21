/**
 * Decorative artwork in the VBiz Pro logo's own language — two colours only,
 * saffron and ink: the V mark itself, and a route hub (one distributor
 * reaching many shops), plus a ₹ coin, a parcel and a saffron dot.
 * Purely visual (aria-hidden); positioned by the parent's CSS.
 */

const INK = "#0F2A2A";
const SAFFRON = "#DB5C17";

/** One point fanning out to many — the idea behind the V mark. */
export function RouteHub({ className, light }: { className?: string; light?: boolean }) {
  const line = light ? "#FFFFFF" : INK;
  return (
    <svg className={className} viewBox="0 0 160 140" aria-hidden="true">
      <circle cx="62" cy="70" r="56" fill={SAFFRON} fillOpacity={light ? 0.22 : 0.12} />
      <g fill="none" stroke={line} strokeWidth="5" strokeLinecap="round" strokeOpacity={light ? 0.85 : 1}>
        <path d="M40 70C80 70 92 26 130 22" />
        <path d="M40 70C84 70 102 56 142 56" />
        <path d="M40 70C84 70 102 92 138 100" />
        <path d="M40 70C76 72 88 118 118 124" />
      </g>
      <circle cx="40" cy="70" r="15" fill={SAFFRON} />
      <circle cx="40" cy="70" r="5.5" fill="#FFFFFF" />
      {[
        [130, 22, line],
        [142, 56, SAFFRON],
        [138, 100, line],
        [118, 124, line],
      ].map(([x, y, c]) => (
        <g key={`${x}-${y}`}>
          <circle cx={x} cy={y} r="8" fill={c as string} />
          <circle cx={x} cy={y} r="3" fill={light && c !== SAFFRON ? INK : "#FFFFFF"} />
        </g>
      ))}
    </svg>
  );
}

/** The V mark from the logo. `light` turns its ink stroke white for dark bands. */
export function Mark({ className, light }: { className?: string; light?: boolean }) {
  return (
    <svg className={className} viewBox="7 15 86 71" aria-hidden="true">
      <path
        d="M 8.49 19.04 Q 7.50 16.00 10.70 16.00 L 23.30 16.00 Q 26.50 16.00 27.55 19.02 L 37.75 48.48 Q 38.80 51.50 37.89 54.57 L 32.59 72.50 Q 32.00 74.50 29.91 74.50 L 28.59 74.50 Q 26.50 74.50 25.85 72.51 Z"
        fill={light ? "#FFFFFF" : INK}
      />
      <path
        d="M 36.71 81.93 Q 35.80 85.00 39.00 85.00 L 48.00 85.00 Q 51.20 85.00 52.24 81.97 L 73.76 19.03 Q 74.80 16.00 71.60 16.00 L 59.40 16.00 Q 56.20 16.00 55.29 19.07 Z"
        fill={SAFFRON}
      />
      <path
        d="M 69.50 51.97 Q 68.46 55.00 71.66 55.00 L 79.76 55.00 Q 82.96 55.00 84.00 51.97 L 91.50 30.03 Q 92.54 27.00 89.34 27.00 L 81.24 27.00 Q 78.04 27.00 77.00 30.03 Z"
        fill={SAFFRON}
      />
    </svg>
  );
}

export function Coin({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 80 80" aria-hidden="true">
      <circle cx="40" cy="40" r="34" fill={SAFFRON} />
      <circle cx="40" cy="40" r="26" fill="none" stroke="#fff" strokeOpacity=".45" strokeWidth="3" />
      <text x="40" y="52" textAnchor="middle" fontSize="34" fontWeight="800" fill="#fff" fontFamily="system-ui, sans-serif">
        ₹
      </text>
    </svg>
  );
}

export function Parcel({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 90 90" aria-hidden="true">
      <path d="M45 8l34 18v38L45 82 11 64V26z" fill="#fff" stroke={INK} strokeWidth="5" strokeLinejoin="round" />
      <path d="M11 26l34 18 34-18M45 44v38" fill="none" stroke={INK} strokeWidth="5" strokeLinejoin="round" />
      <path d="M28 17l34 18" stroke={SAFFRON} strokeWidth="6" strokeLinecap="round" />
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
