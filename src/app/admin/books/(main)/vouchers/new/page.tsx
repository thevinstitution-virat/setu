import VoucherForm from "@/components/books/VoucherForm";
import { booksPage, readSearch } from "@/lib/books-page";
import { voucherOptions } from "@/lib/vouchers";
import { isVoucherType } from "@/lib/voucher-labels";
import { ErrorCard } from "@/components/reports/Kit";

type SP = Record<string, string | string[] | undefined>;

/** Enter a voucher. ?type=PAYMENT|RECEIPT|CONTRA|JOURNAL picks the kind. */
export default async function NewVoucherPage({ searchParams }: { searchParams: Promise<SP> }) {
  const sp = readSearch(await searchParams);
  const r = await booksPage((ctx) => voucherOptions(ctx));
  if (!r.ok) return <ErrorCard message={r.error} />;
  if (!r.me.canPost) return <ErrorCard message="You can't enter vouchers" />;
  const t = sp.get("type");
  return <VoucherForm options={r.data} initialType={isVoucherType(t) ? t : "PAYMENT"} />;
}
