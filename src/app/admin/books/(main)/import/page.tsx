import ImportTool, { BOOKS_SHEETS } from "@/components/admin/ImportTool";
import { booksPage } from "@/lib/books-page";
import { ErrorCard } from "@/components/reports/Kit";

/** Suppliers, their open bills and old purchase bills, for whoever enters purchases (the full import screen is the owner's). */
export default async function BooksImportPage({ searchParams }: { searchParams: Promise<{ type?: string }> }) {
  const { type } = await searchParams;
  const r = await booksPage(async () => null);
  if (!r.ok) return <ErrorCard message={r.error} />;
  if (!r.me.canPurchase) return <ErrorCard message="Only someone who enters purchases can import suppliers and their bills." />;
  return <ImportTool only={BOOKS_SHEETS} initial={type} inBooks />;
}
