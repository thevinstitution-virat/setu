import type { ReactNode } from "react";

export type StatTone = "accent" | "money" | "scheme" | "neutral" | "risk";

const TONE: Record<StatTone, { box: string; label: string; delta: string }> = {
  accent: { box: "bg-[var(--accent)] text-[var(--accent-on)] border-transparent", label: "opacity-90", delta: "opacity-90" },
  money: { box: "bg-[var(--money)] text-white border-transparent", label: "opacity-85", delta: "text-[var(--genda)]" },
  scheme: { box: "bg-[var(--scheme)] text-[var(--on-scheme)] border-transparent", label: "opacity-80", delta: "opacity-85" },
  neutral: { box: "bg-[var(--surface)] text-[var(--ink)] border-[var(--line)]", label: "text-[var(--muted)]", delta: "text-[var(--muted)]" },
  risk: { box: "bg-[var(--surface)] text-[var(--ink)] border-[var(--line)]", label: "text-[var(--muted)]", delta: "text-[var(--muted)]" },
};

/**
 * Label, a big Poppins figure, an optional delta line and an optional
 * sparkline (inline SVG, no chart library). Compact amounts belong in `value`
 * (formatINR(p, { compact: true })).
 */
export default function StatCard({
  label,
  value,
  delta,
  tone = "neutral",
  spark,
  href,
  icon,
  className = "",
}: {
  label: string;
  value: ReactNode;
  delta?: ReactNode;
  tone?: StatTone;
  /** A short series, oldest first. */
  spark?: number[];
  href?: string;
  icon?: ReactNode;
  className?: string;
}) {
  const t = TONE[tone];
  const body = (
    <>
      <span className="flex items-center justify-between gap-2">
        <span className={`text-[12.5px] font-semibold ${t.label}`}>{label}</span>
        {icon}
      </span>
      <span className={`block font-heading font-bold text-[26px] leading-[1.1] mt-1 num ${tone === "risk" ? "text-[var(--risk)]" : ""}`}>{value}</span>
      {delta && <span className={`block text-[12px] font-semibold mt-1 ${t.delta}`}>{delta}</span>}
      {spark && spark.length > 1 && <Sparkline data={spark} className="mt-2 h-8 w-full opacity-90" />}
    </>
  );
  const cls = `block rounded-[var(--r-lg)] border p-4 ${t.box} ${href ? "transition hover:-translate-y-0.5" : ""} ${className}`;
  if (href)
    return (
      <a href={href} className={cls}>
        {body}
      </a>
    );
  return <div className={cls}>{body}</div>;
}

/** A line with a soft area fill and an emphasised endpoint. Colour follows currentColor. */
export function Sparkline({ data, className = "" }: { data: number[]; className?: string }) {
  const w = 120;
  const h = 32;
  const min = Math.min(...data);
  const max = Math.max(...data);
  const span = max - min || 1;
  const pts = data.map((v, i) => [(i / (data.length - 1)) * (w - 6) + 3, h - 4 - ((v - min) / span) * (h - 10)] as const);
  const line = pts.map(([x, y], i) => `${i ? "L" : "M"}${x.toFixed(1)} ${y.toFixed(1)}`).join(" ");
  const area = `${line} L${pts[pts.length - 1][0].toFixed(1)} ${h} L${pts[0][0].toFixed(1)} ${h} Z`;
  const [lx, ly] = pts[pts.length - 1];
  return (
    <svg viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none" className={className} aria-hidden="true">
      <path d={area} fill="currentColor" opacity="0.14" />
      <path d={line} fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" vectorEffect="non-scaling-stroke" />
      <circle cx={lx} cy={ly} r="2.6" fill="currentColor" />
    </svg>
  );
}
