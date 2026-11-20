"use client";

import { useMemo, useState } from "react";
import Icon from "@/components/Icon";
import { mapsUrl } from "@/components/team/kit";

/**
 * A plain "map" without a maps provider: every point is fitted into an SVG
 * box (equirectangular, with a cos(latitude) correction on x, which is fine
 * at city scale), over a light grid and a scale bar. Tap a dot to see what it
 * is and open that spot in Google Maps.
 */

export type MapPoint = {
  id: string;
  lat: number;
  lng: number;
  label: string;
  /** Second line in the details row (time, outcome …). */
  sub?: string;
  /** Any CSS colour. */
  color?: string;
  /** Short text drawn inside the dot (a visit number, "In"). */
  tag?: string;
};

export type MapPath = { points: { lat: number; lng: number }[]; color?: string };

export type LegendItem = { color: string; label: string };

const W = 600;
const H = 420;
const PAD = 40;
/** Smallest box side in degrees (~300 m), so one point or a tight cluster does not fill the box. */
const MIN_SPAN = 0.003;
const RAD = Math.PI / 180;
const NICE = [25, 50, 100, 200, 500, 1000, 2000, 5000, 10_000, 20_000, 50_000, 100_000, 200_000, 500_000];

const ok = (p: { lat: number; lng: number }) => Number.isFinite(p.lat) && Number.isFinite(p.lng);

export default function TeamMap({
  points,
  path,
  legend,
  emptyText = "No positions to show yet.",
  showLabels,
}: {
  points: MapPoint[];
  path?: MapPath | null;
  legend?: LegendItem[];
  emptyText?: string;
  /** Write each point's label beside its dot (default: when there are 12 or fewer). */
  showLabels?: boolean;
}) {
  const [picked, setPicked] = useState<string | null>(null);
  const dots = useMemo(() => points.filter(ok), [points]);
  const trail = useMemo(() => (path?.points ?? []).filter(ok), [path]);

  const frame = useMemo(() => {
    const all = [...dots, ...trail];
    if (!all.length) return null;
    const lat0 = all.reduce((s, p) => s + p.lat, 0) / all.length;
    const k = Math.cos(lat0 * RAD);
    const xs = all.map((p) => p.lng * k);
    const ys = all.map((p) => -p.lat);
    const minX = Math.min(...xs);
    const maxX = Math.max(...xs);
    const minY = Math.min(...ys);
    const maxY = Math.max(...ys);
    const spanX = Math.max(maxX - minX, MIN_SPAN);
    const spanY = Math.max(maxY - minY, MIN_SPAN);
    const scale = Math.min((W - 2 * PAD) / spanX, (H - 2 * PAD) / spanY);
    const cx = (minX + maxX) / 2;
    const cy = (minY + maxY) / 2;
    const at = (p: { lat: number; lng: number }) => ({ x: W / 2 + (p.lng * k - cx) * scale, y: H / 2 + (-p.lat - cy) * scale });
    // One unit of y is one degree of latitude (~111.32 km); x is corrected to match.
    const metresPerPx = 111_320 / scale;
    const want = (W / 5) * metresPerPx;
    const bar = [...NICE].reverse().find((n) => n <= want) ?? NICE[0];
    return { at, bar, barPx: bar / metresPerPx };
  }, [dots, trail]);

  if (!frame) {
    return (
      <div className="card p-6 text-center">
        <Icon name="map" className="h-6 w-6 mx-auto text-[var(--muted)]" />
        <p className="text-sm text-[var(--muted)] mt-2">{emptyText}</p>
      </div>
    );
  }

  const labels = showLabels ?? dots.length <= 12;
  const current = dots.find((p) => p.id === picked) ?? null;
  const line = trail.map((p) => frame.at(p));
  const grid = [1, 2, 3, 4, 5];

  return (
    <div className="card p-2 space-y-2 min-w-0">
      <svg
        viewBox={`0 0 ${W} ${H}`}
        className="block w-full h-auto rounded-xl touch-manipulation select-none"
        role="img"
        aria-label="Positions plot"
        style={{ background: "#fbf8f2" }}
      >
        {grid.map((i) => (
          <line key={`v${i}`} x1={(W / 6) * i} x2={(W / 6) * i} y1={0} y2={H} style={{ stroke: "rgba(15,42,42,0.07)" }} />
        ))}
        {grid.slice(0, 4).map((i) => (
          <line key={`h${i}`} y1={(H / 5) * i} y2={(H / 5) * i} x1={0} x2={W} style={{ stroke: "rgba(15,42,42,0.07)" }} />
        ))}
        {/* Tap the empty plot to clear the pick. */}
        <rect x={0} y={0} width={W} height={H} fill="transparent" onClick={() => setPicked(null)} />

        {line.length > 1 && (
          <polyline
            points={line.map((p) => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(" ")}
            style={{ fill: "none", stroke: path?.color ?? "#155651", strokeWidth: 3, strokeOpacity: 0.55, strokeLinejoin: "round", strokeLinecap: "round" }}
          />
        )}
        {line.map((p, i) => (
          <circle key={i} cx={p.x} cy={p.y} r={2.2} style={{ fill: path?.color ?? "#155651", opacity: 0.6 }} />
        ))}

        {dots.map((d) => {
          const p = frame.at(d);
          const on = d.id === picked;
          const colour = d.color ?? "#db5c17";
          return (
            <g
              key={d.id}
              role="button"
              tabIndex={0}
              aria-label={d.label}
              className="cursor-pointer outline-none"
              onClick={() => setPicked(on ? null : d.id)}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  setPicked(on ? null : d.id);
                }
              }}
            >
              <circle cx={p.x} cy={p.y} r={22} fill="transparent" />
              {on && <circle cx={p.x} cy={p.y} r={16} style={{ fill: colour, opacity: 0.22 }} />}
              <circle cx={p.x} cy={p.y} r={d.tag ? 11 : 9} style={{ fill: colour, stroke: "#fff", strokeWidth: 2.5 }} />
              {d.tag && (
                <text x={p.x} y={p.y + 4} textAnchor="middle" style={{ fill: "#fff", fontSize: d.tag.length > 2 ? 8.5 : 11, fontWeight: 800 }}>
                  {d.tag}
                </text>
              )}
              {(labels || on) && (
                <text
                  x={p.x + 15}
                  y={p.y + 4.5}
                  style={{
                    fill: "#0f2a2a",
                    fontSize: on ? 15 : 13,
                    fontWeight: on ? 800 : 700,
                    paintOrder: "stroke",
                    stroke: "#fbf8f2",
                    strokeWidth: 4,
                    strokeLinejoin: "round",
                  }}
                >
                  {d.label.length > 22 ? `${d.label.slice(0, 21)}…` : d.label}
                </text>
              )}
            </g>
          );
        })}

        <g transform={`translate(${W - 16 - frame.barPx}, ${H - 18})`}>
          <line x1={0} x2={frame.barPx} y1={0} y2={0} style={{ stroke: "#36504e", strokeWidth: 2.5 }} />
          <line x1={0} x2={0} y1={-5} y2={3} style={{ stroke: "#36504e", strokeWidth: 2 }} />
          <line x1={frame.barPx} x2={frame.barPx} y1={-5} y2={3} style={{ stroke: "#36504e", strokeWidth: 2 }} />
          <text x={frame.barPx / 2} y={-8} textAnchor="middle" style={{ fill: "#36504e", fontSize: 12, fontWeight: 700 }}>
            {frame.bar >= 1000 ? `${frame.bar / 1000} km` : `${frame.bar} m`}
          </text>
        </g>
      </svg>

      <div className="px-2 pb-1 min-h-[44px] flex flex-wrap items-center justify-between gap-2">
        {current ? (
          <>
            <div className="min-w-0">
              <p className="text-sm font-bold truncate">{current.label}</p>
              {current.sub && <p className="text-xs text-[var(--muted)] truncate">{current.sub}</p>}
            </div>
            <a
              href={mapsUrl(current.lat, current.lng)}
              target="_blank"
              rel="noopener noreferrer"
              className="btn btn-quiet btn-xs !min-h-[44px] shrink-0"
            >
              <Icon name="pin" className="h-3.5 w-3.5" /> Open in Google Maps
            </a>
          </>
        ) : (
          <p className="text-xs text-[var(--muted)]">{dots.length ? "Tap a dot to see who or what it is." : "Route only, no marked stops."}</p>
        )}
        {legend && legend.length > 0 && (
          <ul className="w-full flex flex-wrap gap-x-3 gap-y-1 text-xs text-[var(--ink-2)]">
            {legend.map((l) => (
              <li key={l.label} className="inline-flex items-center gap-1.5">
                <span className="h-2.5 w-2.5 rounded-full shrink-0" style={{ background: l.color }} />
                {l.label}
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
