import type { ReactNode } from "react";
import BooksNav from "@/components/books/BooksNav";

export default function BooksLayout({ children }: { children: ReactNode }) {
  return (
    <div className="space-y-5">
      <div className="page-head">
        <div>
          <p className="page-kick">Accounts</p>
          <h1 className="page-title">The books</h1>
          <p className="page-sub">Every rupee in one ledger: accounts and heads, purchases and suppliers, bank accounts, any account&apos;s ledger, the day book and a check that it all adds up.</p>
        </div>
      </div>
      <BooksNav />
      {children}
    </div>
  );
}
