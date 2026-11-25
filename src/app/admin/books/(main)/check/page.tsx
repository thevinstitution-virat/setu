import Link from "next/link";
import Icon from "@/components/Icon";
import { booksPage } from "@/lib/books-page";
import { checkBooks } from "@/lib/books";
import { ErrorCard } from "@/components/reports/Kit";

export const dynamic = "force-dynamic";

/** "Check my books": every proof that the ledger is whole, in plain words. */
export default async function CheckPage() {
  const r = await booksPage((ctx) => checkBooks(ctx));
  if (!r.ok) return <ErrorCard message={r.error} />;
  const c = r.data;
  const bad = c.results.filter((x) => !x.ok).length;
  const at = new Date().toLocaleString("en-IN", { day: "numeric", month: "short", hour: "numeric", minute: "2-digit", timeZone: "Asia/Kolkata" });

  return (
    <div className="space-y-4">
      <section className={`card p-4 flex flex-wrap items-center justify-between gap-3 ${c.ok ? "border-[var(--mint)]" : "border-[#e8a39b]"}`}>
        <div className="flex items-center gap-3">
          <span className={`grid h-10 w-10 place-items-center rounded-full ${c.ok ? "bg-[var(--success-tint)] text-[var(--success-text)]" : "bg-[#fbe9e7] text-[var(--risk-text)]"}`}>
            <Icon name={c.ok ? "check" : "alert"} className="h-5 w-5" />
          </span>
          <div>
            <p className="font-heading font-bold text-[var(--ink)]">{c.ok ? "Your books are in order" : `${bad} check${bad === 1 ? "" : "s"} need${bad === 1 ? "s" : ""} a look`}</p>
            <p className="text-xs text-[var(--muted)]">
              {c.counts.entries.toLocaleString("en-IN")} entries, {c.counts.lines.toLocaleString("en-IN")} lines checked at {at}
            </p>
          </div>
        </div>
        <Link href="/admin/books/check" className="btn btn-outline btn-sm" prefetch={false}>
          Check again
        </Link>
      </section>
      <ul className="card divide-y divide-[var(--line)] p-0">
        {c.results.map((x) => (
          <li key={x.key} className="flex items-start gap-3 px-4 py-3">
            <Icon name={x.ok ? "check" : "alert"} className={`mt-0.5 h-4 w-4 shrink-0 ${x.ok ? "text-[var(--success-text)]" : "text-[var(--risk-text)]"}`} />
            <div className="min-w-0">
              <p className="text-sm font-semibold text-[var(--ink)]">{x.title}</p>
              <p className="text-xs text-[var(--muted)]">{x.detail}</p>
              {!x.ok && <p className="text-xs text-[var(--ink-2)] mt-0.5">What to do: {x.fix}</p>}
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}
