import Link from "next/link";
import Icon from "@/components/Icon";
import { booksPage } from "@/lib/books-page";
import { switchOver, type StepState } from "@/lib/switch-over";
import { ErrorCard } from "@/components/reports/Kit";
import { OldTrialBalance, ParallelRun } from "@/components/books/SwitchTools";

const STATE: Record<StepState, { icon: string; cls: string; label: string }> = {
  done: { icon: "check", cls: "bg-[#e3f4ec] text-[#1d6b47]", label: "Done" },
  todo: { icon: "arrow", cls: "bg-black/5 text-[var(--ink-2)]", label: "To do" },
  check: { icon: "alert", cls: "bg-[#fff4e0] text-[#7a4b00]", label: "Check" },
};

/** A10: moving the books here from other software, step by step. */
export default async function SwitchPage() {
  const r = await booksPage((ctx) => switchOver(ctx));
  if (!r.ok) return <ErrorCard message={r.error} />;
  const s = r.data;
  return (
    <div className="space-y-4">
      <section className="card p-4 sm:p-5 space-y-3">
        <div>
          <h2 className="font-heading text-lg font-bold text-[var(--ink)]">Move your books here</h2>
          <p className="text-sm text-[var(--ink-2)]">
            Everything moves on one day, so sales and purchases never sit in two sets of books. {s.done} of {s.steps.length} steps done.
          </p>
        </div>
        <ol className="space-y-2">
          {s.steps.map((x, i) => (
            <li key={x.key} className="flex gap-3 rounded-xl border border-[var(--line)] p-3">
              <span className={`grid h-7 w-7 shrink-0 place-items-center rounded-full text-xs font-bold ${STATE[x.state].cls}`} title={STATE[x.state].label}>
                {x.state === "done" ? <Icon name="check" className="h-4 w-4" /> : i + 1}
              </span>
              <div className="min-w-0 flex-1">
                <p className="font-semibold text-[var(--ink)]">
                  {x.title} <span className={`ml-1 rounded-full px-2 py-0.5 text-[11px] font-semibold ${STATE[x.state].cls}`}>{STATE[x.state].label}</span>
                </p>
                <p className="text-sm text-[var(--ink-2)]">{x.text}</p>
              </div>
              <Link href={x.href} className="btn btn-outline btn-xs self-start shrink-0">
                {x.cta}
              </Link>
            </li>
          ))}
        </ol>
      </section>

      <section className="card p-4 sm:p-5 space-y-3">
        <h3 className="font-heading font-bold text-[var(--ink)]">The old trial balance</h3>
        <p className="text-sm text-[var(--ink-2)]">
          Bring in the old software&apos;s trial balance as on the day before the switch. The app matches each line to its accounts and checks that it balances and that the debtors, creditors
          and stock in it agree with the open bills and stock entered here, before the books open.
        </p>
        <OldTrialBalance startOn={s.startOn} canSetup={r.me.canSetup} />
      </section>

      <section id="parallel" className="card p-4 sm:p-5 space-y-3 scroll-mt-20">
        <h3 className="font-heading font-bold text-[var(--ink)]">Parallel run</h3>
        <p className="text-sm text-[var(--ink-2)]">
          While both run, put the old software&apos;s trial balance, debtors, creditors and stock for a day in a sheet, and see each line against the app&apos;s figures for the same day.
        </p>
        <ParallelRun today={s.today} />
      </section>
    </div>
  );
}
