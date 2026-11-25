"use client";

/** Pill segmented control. Controlled: pass the value and an onChange. */
export default function Tabs<T extends string>({
  value,
  options,
  onChangeAction,
  label,
  className = "",
}: {
  value: T;
  options: { value: T; label: string; count?: number }[];
  onChangeAction: (v: T) => void;
  label: string;
  className?: string;
}) {
  return (
    <div className={`seg ${className}`} role="tablist" aria-label={label}>
      {options.map((o) => (
        <button key={o.value} type="button" role="tab" aria-selected={value === o.value} onClick={() => onChangeAction(o.value)}>
          {o.label}
          {o.count !== undefined && <span className="text-[11px] opacity-70 num">{o.count}</span>}
        </button>
      ))}
    </div>
  );
}
