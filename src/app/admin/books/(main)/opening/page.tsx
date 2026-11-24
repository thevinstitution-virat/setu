import { booksPage } from "@/lib/books-page";
import { openingView } from "@/lib/final-accounts";
import { ErrorCard } from "@/components/reports/Kit";
import OpeningForm from "@/components/books/OpeningForm";

/** Opening the books: the opening trial balance on the switch date. */
export default async function OpeningPage() {
  const r = await booksPage((ctx) => openingView(ctx));
  if (!r.ok) return <ErrorCard message={r.error} />;
  return <OpeningForm key={`${r.data.startOn}:${r.data.enteredAt}:${r.data.difference}`} view={r.data} canSetup={r.me.canSetup} />;
}
