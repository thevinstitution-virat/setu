import PurchaseForm from "@/components/books/PurchaseForm";
import { readSearch } from "@/lib/books-page";
import { getTenant } from "@/lib/tenant";
import { pageSession } from "@/lib/guard";
import { can } from "@/lib/permissions";
import { ErrorCard } from "@/components/reports/Kit";
import type { PurchaseDocType } from "@/lib/purchase-math";

type SP = Record<string, string | string[] | undefined>;
const TYPES: PurchaseDocType[] = ["BILL", "DEBIT_NOTE", "CREDIT_NOTE"];

/** New purchase bill or note. ?type=DEBIT_NOTE|CREDIT_NOTE, ?grn=<goods received>, ?supplier=, ?against=<bill>, ?claim=<claim a credit note settles>. */
export default async function NewPurchasePage({ searchParams }: { searchParams: Promise<SP> }) {
  const sp = readSearch(await searchParams);
  const [tenant, session] = await Promise.all([getTenant(), pageSession()]);
  if (!tenant || !session) return <ErrorCard message="Please sign in" />;
  if (!can(session.role, "purchases.manage")) return <ErrorCard message="You can't enter purchases" />;
  const type = TYPES.find((t) => t === sp.get("type")) ?? "BILL";
  return <PurchaseForm initial={{ type, grn: sp.get("grn"), supplier: sp.get("supplier"), against: sp.get("against"), claim: sp.get("claim") }} />;
}
