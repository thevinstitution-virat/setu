"use client";

/**
 * Brand screen pieces: a colour field (picker + hex box) and a live preview
 * of the app in the chosen colours (header bar, buttons, a card) with the
 * phone home-screen icon. The preview sets the same CSS tokens the app uses
 * (themeVars), so the real .btn / .card / .panel-dark styles render in the
 * business's colours.
 */

import Icon from "@/components/Icon";
import { fileUrl } from "@/components/admin/AdminKit";
import { normHex, themeVars } from "@/lib/branding";

export function ColourField({
  label,
  hint,
  value,
  fallback,
  onChange,
  error,
  disabled,
}: {
  label: string;
  hint?: string;
  value: string;
  fallback: string;
  onChange: (v: string) => void;
  error?: string | null;
  disabled?: boolean;
}) {
  const hex = normHex(value) ?? fallback;
  const bad = value.trim() !== "" && !normHex(value);
  return (
    <div className="min-w-0">
      <span className="block text-sm font-medium text-[var(--ink-2)] mb-1">{label}</span>
      <div className="flex items-center gap-2">
        <input
          type="color"
          aria-label={`${label}: pick a colour`}
          className="h-11 w-12 shrink-0 cursor-pointer rounded-xl border border-[var(--line)] bg-white p-1 disabled:cursor-not-allowed disabled:opacity-50"
          value={hex}
          disabled={disabled}
          onChange={(e) => onChange(e.target.value)}
        />
        <input
          className={`input font-mono uppercase ${error || bad ? "!border-[#a8281e]" : ""}`}
          aria-label={`${label}: colour code`}
          value={value}
          placeholder={fallback.toUpperCase()}
          maxLength={7}
          spellCheck={false}
          disabled={disabled}
          onChange={(e) => onChange(e.target.value)}
        />
      </div>
      {bad ? (
        <span className="block text-xs text-[#a8281e] mt-1">Colour must look like #1A5C55</span>
      ) : error ? (
        <span className="block text-xs text-[#a8281e] mt-1">{error}</span>
      ) : hint ? (
        <span className="block text-xs text-[var(--muted)] mt-1">{hint}</span>
      ) : null}
    </div>
  );
}

type PreviewProps = {
  appName: string;
  shortName: string;
  tagline: string;
  logoKey: string | null;
  iconKey: string | null;
  colours: { primary: string; accent: string; surface: string };
};

function Letter({ name, className }: { name: string; className: string }) {
  return (
    <span className={`grid place-items-center font-heading font-bold text-white ${className}`} style={{ background: "var(--mor)" }}>
      {(name.trim()[0] ?? "S").toUpperCase()}
    </span>
  );
}

export function BrandPreview({ appName, shortName, tagline, logoKey, iconKey, colours }: PreviewProps) {
  const vars = themeVars(colours) as React.CSSProperties;
  const name = appName.trim() || "Your business";
  const label = (shortName.trim() || name).slice(0, 12);
  const icon = iconKey ?? logoKey;

  return (
    <div style={vars} className="space-y-4">
      {/* The app */}
      <div className="rounded-2xl border border-[var(--line)] overflow-hidden" style={{ background: "var(--background)" }}>
        <div className="panel-dark !rounded-none px-4 py-3 flex items-center gap-3">
          {logoKey ? (
            <span className="h-9 w-9 shrink-0 rounded-xl bg-white overflow-hidden grid place-items-center">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={fileUrl(logoKey)} alt="" className="h-full w-full object-contain" />
            </span>
          ) : (
            <Letter name={name} className="h-9 w-9 shrink-0 rounded-xl !bg-white/15" />
          )}
          <div className="min-w-0 flex-1">
            <p className="font-heading font-bold truncate">{name}</p>
            {tagline.trim() && <p className="text-xs text-white/75 truncate">{tagline}</p>}
          </div>
          <Icon name="bell" className="h-5 w-5 text-white/80 shrink-0" />
        </div>
        <div className="p-4 space-y-3">
          <div className="card p-4 space-y-2">
            <div className="flex items-center justify-between gap-2">
              <p className="font-semibold">Order #1042</p>
              <span className="chip chip-kesar !py-0.5 !px-2 !text-[11.5px]">Out for delivery</span>
            </div>
            <p className="text-sm text-[var(--ink-2)]">12 items · arriving today</p>
            <p className="text-sm font-semibold" style={{ color: "var(--mor)" }}>
              Track order
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <span className="btn btn-primary btn-sm pointer-events-none">Place order</span>
            <span className="btn btn-secondary btn-sm pointer-events-none">Pay now</span>
            <span className="btn btn-soft btn-sm pointer-events-none">Add note</span>
          </div>
        </div>
      </div>

      {/* The phone home screen */}
      <div className="flex justify-center">
        <div
          className="w-[210px] rounded-[30px] border-[6px] border-ink p-4 pt-6"
          style={{ background: "linear-gradient(160deg, #3c5a73 0%, #2a3f52 55%, #1b2a38 100%)" }}
          aria-label="Phone home screen preview"
        >
          <div className="grid grid-cols-4 gap-x-3 gap-y-4">
            <div className="col-span-1 flex flex-col items-center gap-1 min-w-0">
              {icon ? (
                <span className="h-11 w-11 rounded-[24%] bg-white overflow-hidden grid place-items-center shadow">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={fileUrl(icon)} alt="" className="h-full w-full object-cover" />
                </span>
              ) : (
                <Letter name={label} className="h-11 w-11 rounded-[24%] text-lg shadow" />
              )}
              <span className="block w-full text-center text-[10px] leading-tight text-white truncate">{label}</span>
            </div>
            {Array.from({ length: 7 }).map((_, i) => (
              <div key={i} className="flex flex-col items-center gap-1" aria-hidden="true">
                <span className="h-11 w-11 rounded-[24%] bg-white/20" />
                <span className="h-1.5 w-8 rounded bg-white/25 mt-1" />
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
