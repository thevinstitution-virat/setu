"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import Icon from "@/components/Icon";
import { useLanguage } from "@/lib/i18n/LanguageProvider";
import { TICKET_CATEGORIES, isTicketCategory, type TicketCategory } from "@/lib/engage-settings";
import { ErrorBox, shortDate, useFetch } from "@/components/admin/AdminKit";
import ComplaintSheet, { type OrderOption } from "@/components/engage/ComplaintSheet";
import { STATUS_CHIP, capital, type StatusText, type TicketStatusKey } from "@/components/engage/kit";

type Row = {
  id: string;
  number: string;
  category: string;
  subject: string;
  status: TicketStatusKey;
  createdAt: string;
  updatedAt: string;
  order: { id: string; orderNumber: string } | null;
  overdue: boolean;
};

/** The shop's complaints, newest first, and "New complaint". */
export default function HelpDesk({
  statusText,
  orders,
  openNew,
  initialOrderId,
  initialCategory,
}: {
  statusText: StatusText;
  orders: OrderOption[];
  openNew: boolean;
  initialOrderId: string | null;
  initialCategory: TicketCategory | null;
}) {
  const router = useRouter();
  const { lang } = useLanguage();
  const { data, error, reload } = useFetch<{ items: Row[] }>("/api/tickets");
  const [adding, setAdding] = useState(openNew);

  const items = data?.items ?? [];
  const waiting = items.filter((t) => t.status === "WAITING").length;
  const cat = (k: string) => (isTicketCategory(k) ? (lang === "hi" ? TICKET_CATEGORIES[k].hi : TICKET_CATEGORIES[k].label) : k);

  function close() {
    setAdding(false);
    if (openNew) router.replace("/retailer/help");
  }

  return (
    <div className="space-y-5">
      <div className="page-head">
        <div className="min-w-0">
          <p className="page-kick">Help</p>
          <h1 className="page-title">Complaints</h1>
          <p className="page-sub">Tell us about damaged, missing or wrong goods, late deliveries or bill problems.</p>
        </div>
        <button type="button" className="btn btn-kesar btn-sm shrink-0" onClick={() => setAdding(true)}>
          <Icon name="plus" className="h-4 w-4" /> New complaint
        </button>
      </div>

      {waiting > 0 && (
        <p className="card p-3 text-sm font-semibold text-[var(--accent-text)] border-2 !border-[var(--kesar)]">
          {waiting === 1 ? "1 complaint is" : `${waiting} complaints are`} waiting for your answer.
        </p>
      )}

      {error && !data ? (
        <ErrorBox message={error} onRetry={reload} />
      ) : !data ? (
        <p className="text-sm text-[var(--muted)]">Loading…</p>
      ) : items.length === 0 ? (
        <div className="card p-6 text-center space-y-3">
          <span className="icon-tile mx-auto bg-[var(--success-tint)] text-[var(--success-text)]">
            <Icon name="chat" />
          </span>
          <p className="text-sm text-[var(--ink-2)]">No complaints. If something is wrong with an order, tell us here.</p>
          <button type="button" className="btn btn-kesar btn-sm" onClick={() => setAdding(true)}>
            New complaint
          </button>
        </div>
      ) : (
        <ul className="space-y-2">
          {items.map((t) => (
            <li key={t.id}>
              <Link
                href={`/retailer/help/${t.id}`}
                className={`card p-4 flex items-start gap-3 hover:-translate-y-0.5 transition ${
                  t.status === "WAITING" ? "border-2 !border-[var(--kesar)]" : ""
                }`}
              >
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className={`chip !py-0.5 !px-2 !text-[11.5px] ${STATUS_CHIP[t.status]}`}>
                      {capital(statusText[t.status][lang])}
                    </span>
                    <span className="text-xs text-[var(--muted)] break-all">{t.number}</span>
                  </div>
                  <p className="font-bold text-sm mt-1.5 break-words">{t.subject}</p>
                  <p className="text-xs text-[var(--muted)] mt-0.5">
                    {cat(t.category)}
                    {t.order ? ` · ${t.order.orderNumber}` : ""} · Updated {shortDate(t.updatedAt)}
                  </p>
                </div>
                <Icon name="chevronRight" className="h-4 w-4 shrink-0 mt-1 text-[var(--muted)]" />
              </Link>
            </li>
          ))}
        </ul>
      )}

      {adding && (
        <ComplaintSheet
          orders={orders}
          initialOrderId={initialOrderId}
          initialCategory={initialCategory}
          onClose={close}
          onRaised={(t) => router.push(`/retailer/help/${t.id}`)}
        />
      )}
    </div>
  );
}
