import Icon from "@/components/Icon";

export type Step = { label: string; hint?: string; done: boolean };

/** A short checklist at the top of a task screen: numbered until done, then a tick. */
export default function StepChecklist({ steps }: { steps: Step[] }) {
  return (
    <ol className="grid gap-2" aria-label="Steps">
      {steps.map((s, i) => (
        <li key={s.label} className={`flex items-center gap-3 rounded-[14px] border px-3.5 min-h-[56px] ${s.done ? "border-transparent bg-[var(--success-tint)]" : "border-[var(--line)] bg-[var(--surface)]"}`}>
          <span className={`grid place-items-center h-8 w-8 shrink-0 rounded-full text-sm font-bold ${s.done ? "bg-[var(--success)] text-white" : "border-2 border-[var(--line-2)] text-[var(--faint)]"}`}>
            {s.done ? <Icon name="check" className="h-4 w-4" weight="bold" /> : i + 1}
          </span>
          <span className="min-w-0">
            <span className="block font-bold text-sm">{s.label}</span>
            {s.hint && <span className="block text-xs text-[var(--muted)]">{s.hint}</span>}
          </span>
        </li>
      ))}
    </ol>
  );
}
