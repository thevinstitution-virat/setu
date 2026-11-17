"use client";

import { useReducedMotion } from "./use-landing";

const PATH = "M 70 130 C 220 40, 380 40, 530 130";

export default function BridgeAnimation() {
  const reduced = useReducedMotion();

  return (
    <svg viewBox="0 0 600 220" className="w-full h-auto" role="img" aria-label="Retailer to sales to delivery, connected by Setu">
      <defs>
        <linearGradient id="setu-cable" x1="0" y1="0" x2="1" y2="0">
          <stop offset="0%" stopColor="#146c5b" />
          <stop offset="100%" stopColor="#e9b949" />
        </linearGradient>
        <radialGradient id="setu-node-glow">
          <stop offset="0%" stopColor="#e9b949" stopOpacity="0.55" />
          <stop offset="100%" stopColor="#e9b949" stopOpacity="0" />
        </radialGradient>
      </defs>

      {/* cable */}
      <path d={PATH} fill="none" stroke="url(#setu-cable)" strokeWidth="2.5" strokeDasharray="1 7" strokeLinecap="round" opacity="0.7" />
      <path d={PATH} fill="none" stroke="url(#setu-cable)" strokeWidth="1" opacity="0.5" />

      {/* traveling pulse */}
      {!reduced && (
        <circle r="5" fill="#fff">
          <animateMotion dur="3.2s" repeatCount="indefinite" path={PATH} />
          <animate attributeName="opacity" values="0;1;1;0" keyTimes="0;0.08;0.9;1" dur="3.2s" repeatCount="indefinite" />
        </circle>
      )}

      {/* nodes */}
      {[
        { x: 70, y: 130, icon: "🛒", label: "Retailer" },
        { x: 300, y: 48, icon: "📍", label: "Sales" },
        { x: 530, y: 130, icon: "🛵", label: "Delivery" },
      ].map((n) => (
        <g key={n.label}>
          <circle cx={n.x} cy={n.y} r="34" fill="url(#setu-node-glow)" />
          <circle cx={n.x} cy={n.y} r="22" fill="#0d2420" stroke="#e9b949" strokeWidth="1.5" />
          <text x={n.x} y={n.y + 7} textAnchor="middle" fontSize="20">
            {n.icon}
          </text>
        </g>
      ))}
    </svg>
  );
}
