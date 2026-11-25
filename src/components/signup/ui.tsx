"use client";

import Icon from "@/components/Icon";

/** Props for an input that can carry an error: id, aria wiring and a red border. */
export function fieldProps(id: string, error?: string | null) {
  return {
    id: `f-${id}`,
    "aria-invalid": error ? true : undefined,
    "aria-describedby": error ? `f-${id}-err` : undefined,
    style: error ? { borderColor: "var(--risk-text)" } : undefined,
  } as const;
}

/** A labelled field with its error (or a hint) right under it. */
export function Field({
  id,
  label,
  optional,
  hint,
  error,
  children,
}: {
  id: string;
  label: string;
  optional?: boolean;
  hint?: React.ReactNode;
  error?: string | null;
  children: React.ReactNode;
}) {
  return (
    <div>
      <label htmlFor={`f-${id}`} className="block text-sm font-medium text-foreground/70 mb-1">
        {label}
        {optional && <span className="font-normal text-[var(--muted)]"> (optional)</span>}
      </label>
      {children}
      {error ? (
        <p id={`f-${id}-err`} role="alert" className="text-xs font-semibold text-[var(--risk-text)] mt-1 break-words">
          {error}
        </p>
      ) : hint ? (
        <p className="text-xs text-[var(--muted)] mt-1">{hint}</p>
      ) : null}
    </div>
  );
}

/** An error that belongs to no single field. */
export function FormError({ message }: { message: string | null | undefined }) {
  if (!message) return null;
  return (
    <div role="alert" className="flex gap-2 rounded-xl bg-[var(--risk-text)]/10 text-[var(--risk-text)] px-3 py-2.5 text-sm">
      <Icon name="alert" className="h-5 w-5 shrink-0" />
      <p className="break-words">{message}</p>
    </div>
  );
}

/** Step bars with labels (labels hidden on a phone; the line under them says where you are). */
export function Progress({ steps, active }: { steps: readonly string[]; active: number }) {
  return (
    <div>
      <ol className="flex gap-1.5" aria-label="Sign-up steps">
        {steps.map((s, i) => (
          <li key={s} className="flex-1 min-w-0" aria-current={i === active ? "step" : undefined}>
            <div className={`h-1.5 rounded-full ${i <= active ? "bg-[var(--kesar)]" : "bg-black/10"}`} />
            <span
              className={`hidden sm:block mt-1.5 text-[11.5px] font-bold truncate ${
                i === active ? "text-[var(--accent-text)]" : i < active ? "text-[var(--ink-2)]" : "text-[var(--muted)]"
              }`}
            >
              {s}
            </span>
          </li>
        ))}
      </ol>
      <p className="sm:hidden mt-1.5 text-xs font-bold text-[var(--accent-text)]">
        Step {active + 1} of {steps.length} · {steps[active]}
      </p>
    </div>
  );
}
