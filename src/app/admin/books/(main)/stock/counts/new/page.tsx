import Link from "next/link";
import Icon from "@/components/Icon";
import { booksPage } from "@/lib/books-page";
import { stockChoices } from "@/lib/stock-counts";
import { ErrorCard } from "@/components/reports/Kit";
import StartCountForm from "@/components/books/StartCountForm";

/** Start a stock count sheet. */
export default async function NewCountPage() {
  const r = await booksPage((ctx) => stockChoices(ctx));
  if (!r.ok) return <ErrorCard message={r.error} />;
  if (!r.me.canPost) return <ErrorCard message="You can't start stock counts" />;
  const c = r.data;
  return (
    <div className="space-y-4">
      <Link href="/admin/books/stock/counts" className="inline-flex items-center gap-1 text-sm font-bold text-[var(--ink-2)]">
        <Icon name="arrow" className="h-4 w-4 rotate-180" /> Stock counts
      </Link>
      <StartCountForm
        tracking={c.tracking}
        places={c.places.filter((p) => p.kind !== "DAMAGED").map((p) => ({ id: p.id, name: p.name, isDefault: p.isDefault }))}
        companies={c.companies.filter((x) => x.active).map((x) => ({ id: x.id, name: x.name }))}
        categories={c.categories.filter((x) => x.active).map((x) => ({ id: x.id, name: x.name }))}
      />
    </div>
  );
}
