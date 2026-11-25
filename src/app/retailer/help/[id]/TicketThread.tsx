"use client";

import { useState } from "react";
import Link from "next/link";
import Icon from "@/components/Icon";
import { formatINR } from "@/lib/money";
import { useLanguage } from "@/lib/i18n/LanguageProvider";
import { TICKET_CATEGORIES, isTicketCategory } from "@/lib/engage-settings";
import { ErrorBox, Thumb, errText, fileUrl, send, shortDate, useFetch } from "@/components/admin/AdminKit";
import PhotoPicker from "@/components/engage/PhotoPicker";
import { STATUS_CHIP, capital, type StatusText, type TicketStatusKey } from "@/components/engage/kit";

type Message = {
  id: string;
  body: string;
  photoKeys: string[];
  change: string | null;
  createdAt: string;
  author: { id: string; name: string; role: string };
};

type Ticket = {
  id: string;
  number: string;
  category: string;
  subject: string;
  status: TicketStatusKey;
  createdAt: string;
  slaDueAt: string;
  order: { id: string; orderNumber: string; totalAmount: number; createdAt: string } | null;
  messages: Message[];
  overdue: boolean;
  canReply: boolean;
};

const isStatus = (v: string): v is TicketStatusKey => ["OPEN", "IN_PROGRESS", "WAITING", "RESOLVED", "CLOSED"].includes(v);

/** One complaint: what was said on both sides, status changes, and my reply box. */
export default function TicketThread({ id, statusText }: { id: string; statusText: StatusText }) {
  const { lang } = useLanguage();
  const { data, error, reload } = useFetch<{ ticket: Ticket }>(`/api/tickets/${id}`);
  const [reopening, setReopening] = useState(false);

  if (error && !data) {
    return (
      <div className="space-y-4">
        <BackLink />
        <ErrorBox message={error} onRetry={reload} />
      </div>
    );
  }
  if (!data) return <p className="text-sm text-[var(--muted)]">Loading…</p>;

  const t = data.ticket;
  const st = (s: TicketStatusKey) => capital(statusText[s][lang]);
  const category = isTicketCategory(t.category) ? (lang === "hi" ? TICKET_CATEGORIES[t.category].hi : TICKET_CATEGORIES[t.category].label) : t.category;
  const showBox = t.canReply && (t.status !== "RESOLVED" || reopening);

  return (
    <div className="space-y-5">
      <BackLink />

      <div className="space-y-2">
        <div className="flex flex-wrap items-center gap-2">
          <span className={`chip !py-0.5 !px-2 !text-[11.5px] ${STATUS_CHIP[t.status]}`}>{st(t.status)}</span>
          <span className="text-xs text-[var(--muted)] break-all">{t.number}</span>
        </div>
        <h1 className="page-title break-words">{t.subject}</h1>
        <p className="page-sub">
          {category} · Raised {shortDate(t.createdAt, true)}
        </p>
        {t.order && (
          <Link href={`/retailer/orders/${t.order.id}`} className="inline-flex items-center gap-1.5 text-sm font-semibold text-[var(--accent-text)]">
            <Icon name="box" className="h-4 w-4" /> {t.order.orderNumber} · {formatINR(t.order.totalAmount)}
          </Link>
        )}
      </div>

      {t.status === "WAITING" && (
        <p className="card p-3 text-sm font-semibold text-[var(--accent-text)] border-2 !border-[var(--kesar)]">
          We asked you something below. Please reply so we can fix this.
        </p>
      )}

      <ol className="space-y-3">
        {t.messages.map((m) => (
          <MessageRow key={m.id} m={m} statusLabel={(s) => (isStatus(s) ? st(s) : s)} />
        ))}
      </ol>

      {t.status === "CLOSED" ? (
        <div className="card p-4 space-y-3">
          <p className="text-sm text-[var(--ink-2)]">This complaint is closed. If the problem is back, raise a new one.</p>
          <Link
            href={`/retailer/help?new=1${t.order ? `&order=${t.order.id}` : ""}${isTicketCategory(t.category) ? `&category=${t.category}` : ""}`}
            className="btn btn-kesar btn-sm"
          >
            <Icon name="plus" className="h-4 w-4" /> Raise a new complaint
          </Link>
        </div>
      ) : t.status === "RESOLVED" && !reopening ? (
        <div className="card p-4 space-y-3">
          <p className="text-sm text-[var(--ink-2)]">
            We marked this resolved. If it is fine now, there is nothing to do: it closes by itself in a few days.
          </p>
          {t.canReply && (
            <button type="button" className="btn btn-outline btn-sm" onClick={() => setReopening(true)}>
              Still a problem? Reopen
            </button>
          )}
        </div>
      ) : null}

      {showBox && (
        <ReplyBox
          ticketId={t.id}
          reopen={t.status === "RESOLVED"}
          onCancel={t.status === "RESOLVED" ? () => setReopening(false) : undefined}
          onSent={() => {
            setReopening(false);
            reload();
          }}
        />
      )}
    </div>
  );
}

function BackLink() {
  return (
    <Link href="/retailer/help" className="inline-flex items-center gap-1 text-sm text-[var(--accent-text)] min-h-[44px]">
      <Icon name="chevronLeft" className="h-4 w-4" /> All complaints
    </Link>
  );
}

function MessageRow({ m, statusLabel }: { m: Message; statusLabel: (s: string) => string }) {
  const mine = m.author.role === "RETAILER";
  const to = m.change?.split(">")[1] ?? null;
  return (
    <li className="space-y-1.5">
      {(m.body || m.photoKeys.length > 0) && (
        <div className={`flex ${mine ? "justify-end" : "justify-start"}`}>
          <div
            className={`max-w-[85%] min-w-0 rounded-2xl px-3.5 py-2.5 space-y-2 ${
              mine ? "bg-[var(--mor)] text-white rounded-br-md" : "card rounded-bl-md"
            }`}
          >
            <p className={`text-[11px] font-bold ${mine ? "text-white/70" : "text-[var(--muted)]"}`}>
              {mine ? "You" : `${m.author.name} (our team)`} · {shortDate(m.createdAt, true)}
            </p>
            {m.body && <p className="text-sm whitespace-pre-line break-words">{m.body}</p>}
            {m.photoKeys.length > 0 && (
              <div className="flex flex-wrap gap-2">
                {m.photoKeys.map((k) => (
                  <a key={k} href={fileUrl(k)} target="_blank" rel="noopener" aria-label="Open photo">
                    <Thumb imageKey={k} className="h-20 w-20" />
                  </a>
                ))}
              </div>
            )}
          </div>
        </div>
      )}
      {to && (
        <p className="text-center text-xs text-[var(--muted)]">
          {shortDate(m.createdAt, true)} · Now: <b className="text-[var(--ink-2)]">{statusLabel(to)}</b>
        </p>
      )}
    </li>
  );
}

function ReplyBox({
  ticketId,
  reopen,
  onCancel,
  onSent,
}: {
  ticketId: string;
  reopen: boolean;
  onCancel?: () => void;
  onSent: () => void;
}) {
  const [body, setBody] = useState("");
  const [photos, setPhotos] = useState<string[]>([]);
  const [uploading, setUploading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    setError(null);
    if (!body.trim()) return setError(reopen ? "Tell us what is still wrong" : "Write your message");
    setSaving(true);
    try {
      await send(`/api/tickets/${ticketId}`, "POST", { body: body.trim(), photoKeys: photos, ...(reopen ? { reopen: true } : {}) });
      setBody("");
      setPhotos([]);
      onSent();
    } catch (e) {
      setError(errText(e));
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className="card p-4 space-y-3">
      <p className="text-sm font-semibold">{reopen ? "What is still wrong?" : "Add a message"}</p>
      <textarea
        className="input min-h-[96px]"
        maxLength={2000}
        value={body}
        autoFocus={reopen}
        onChange={(e) => setBody(e.target.value)}
        placeholder={reopen ? "For example: the replacement box is also damaged." : "Write here"}
      />
      <PhotoPicker value={photos} onChange={setPhotos} onBusy={setUploading} />
      {error && <p className="text-sm text-[var(--risk-text)]">{error}</p>}
      <div className="flex gap-2">
        {onCancel && (
          <button type="button" className="btn btn-quiet flex-1" onClick={onCancel} disabled={saving}>
            Cancel
          </button>
        )}
        <button type="button" className="btn btn-kesar flex-[2]" onClick={submit} disabled={saving || uploading}>
          {saving ? "Sending…" : reopen ? "Reopen and send" : "Send"}
        </button>
      </div>
    </section>
  );
}
