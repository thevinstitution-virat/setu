import Link from "next/link";
import type { ReactNode } from "react";
import { LEGAL_DRAFT, LEGAL_UPDATED } from "@/lib/legal";

/** Frame for the terms and privacy pages: plain, readable, printable. */
export default function LegalDoc({ title, children }: { title: string; children: ReactNode }) {
  return (
    <main className="min-h-dvh bg-[var(--paper,#faf7f2)] px-4 py-8">
      <article className="mx-auto max-w-2xl space-y-4 text-[15px] leading-relaxed text-[var(--ink-2)] [&_h2]:text-lg [&_h2]:font-bold [&_h2]:text-ink [&_h2]:pt-3 [&_ul]:list-disc [&_ul]:pl-5 [&_ul]:space-y-1">
        <nav className="text-sm flex gap-4">
          <Link href="/legal/terms" className="font-semibold text-[var(--mor)] hover:underline">
            Terms of service
          </Link>
          <Link href="/legal/privacy" className="font-semibold text-[var(--mor)] hover:underline">
            Privacy notice
          </Link>
        </nav>
        <h1 className="text-2xl font-bold text-ink">{title}</h1>
        <p className="text-sm text-[var(--muted)]">Last updated {LEGAL_UPDATED}</p>
        {LEGAL_DRAFT && (
          <p role="note" className="rounded-xl border border-[var(--genda)]/50 bg-[var(--scheme-tint)] px-3 py-2 text-sm font-semibold text-[var(--scheme-text)]">
            Draft. This text is being reviewed and will be replaced by the final version before the service opens to other businesses.
          </p>
        )}
        {children}
      </article>
    </main>
  );
}
