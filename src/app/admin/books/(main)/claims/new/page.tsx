import ClaimForm from "@/components/books/ClaimForm";
import { booksPage, readSearch } from "@/lib/books-page";
import { claimOptions } from "@/lib/claims";
import { isClaimType } from "@/lib/claim-labels";
import { ErrorCard } from "@/components/reports/Kit";

type SP = Record<string, string | string[] | undefined>;

/** Raise a claim on a company. ?supplier= picks the company, ?type= what it is for. */
export default async function NewClaimPage({ searchParams }: { searchParams: Promise<SP> }) {
  const sp = readSearch(await searchParams);
  const r = await booksPage((ctx) => claimOptions(ctx));
  if (!r.ok) return <ErrorCard message={r.error} />;
  if (!r.me.canClaim) return <ErrorCard message="You can't raise claims" />;
  const t = sp.get("type");
  return <ClaimForm options={r.data} initialCompany={sp.get("supplier")} initialType={isClaimType(t) ? t : null} />;
}
