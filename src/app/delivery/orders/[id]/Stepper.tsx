"use client";

/** − n + with 44 px buttons, for one-hand counting. */
export default function Stepper({
  value,
  min = 0,
  max,
  onChangeAction,
  label,
}: {
  value: number;
  min?: number;
  max: number;
  onChangeAction: (n: number) => void;
  /** Read out with the buttons, e.g. "Parle-G". */
  label: string;
}) {
  const set = (n: number) => onChangeAction(Math.min(max, Math.max(min, n)));
  return (
    <div className="inline-flex items-center rounded-xl bg-black/[0.05]">
      <button
        type="button"
        className="h-11 w-11 grid place-items-center text-xl font-bold disabled:opacity-30"
        onClick={() => set(value - 1)}
        disabled={value <= min}
        aria-label={`One less ${label}`}
      >
        −
      </button>
      <input
        className="w-11 bg-transparent text-center font-heading font-bold text-lg outline-none"
        inputMode="numeric"
        value={value}
        aria-label={label}
        onChange={(e) => {
          const n = Number(e.target.value.replace(/\D/g, "") || 0);
          set(n);
        }}
        onFocus={(e) => e.target.select()}
      />
      <button
        type="button"
        className="h-11 w-11 grid place-items-center text-xl font-bold disabled:opacity-30"
        onClick={() => set(value + 1)}
        disabled={value >= max}
        aria-label={`One more ${label}`}
      >
        +
      </button>
    </div>
  );
}
