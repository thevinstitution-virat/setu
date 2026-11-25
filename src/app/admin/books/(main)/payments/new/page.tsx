import PayForm from "@/components/books/PayForm";
import { booksPage, readSearch } from "@/lib/books-page";
import { payOptions } from "@/lib/supplier-payments";
import { ErrorCard } from "@/components/reports/Kit";

type SP = Record<string, string | string[] | undefined>;

/** Pay a supplier. ?supplier= picks one. */
export default async function NewPaymentPage({ searchParams }: { searchParams: Promise<SP> }) {
  const sp = readSearch(await searchParams);
  const r = await booksPage((ctx) => payOptions(ctx));
  if (!r.ok) return <ErrorCard message={r.error} />;
  if (!r.me.canPay) return <ErrorCard message="You can't pay suppliers" />;
  return <PayForm options={r.data} initialSupplier={sp.get("supplier")} />;
}
