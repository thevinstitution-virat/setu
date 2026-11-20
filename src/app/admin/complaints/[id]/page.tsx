"use client";

import { use, useRef, useState } from "react";
import Link from "next/link";
import Icon from "@/components/Icon";
import { formatINR } from "@/lib/money";
import { ErrorBox, Flash, Toggle, errText, fileUrl, send, shortDate, uploadImage, useFetch } from "@/components/admin/AdminKit";
import {
  NEXT,
  SlaText,
  Stars,
  StatusChip,
  categoryLabel,
  isOpenStatus,
  spanText,
  statusLabel,
  tagGood,
  tagLabel,
  useNow,
  type TicketStatus,
} from "@/components/engage/admin/kit";

type Person = { id: string; name: string; role: string };
type Message = { id: string; body: string; photoKeys: string[]; internal: boolean; change: string | null; createdAt: string; author: Person };
type Ticket = {
  id: string;
  number: string;
  category: string;
  subject: string;
  status: TicketStatus;
  priority: string;
  slaDueAt: string;
  firstResponseAt: string | null;
  resolvedAt: string | null;
  closedAt: string | null;
  createdAt: string;
  overdue: boolean;
  retailer: { id: string; outletName: string; user: { phone: string | null; name: string } | null; area: { name: string } | null };
  order: {
    id: string;
    orderNumber: string;
    totalAmount: number;
    status: string;
    createdAt: string;
    items: { id: string; quantity: number; product: { name: string } }[];
  } | null;
  assignedTo: { id: string; name: string } | null;
  createdBy: Person;
  messages: Message[];
};
type Data = { ticket: Ticket; staff: { id: string; name: string }[]; feedback: { rating: number; tags: string[]; comment: string | null } | null };

/** What each status button says, by where the complaint is now. */
function moveLabel(from: TicketStatus, to: TicketStatus) {
  if (to === "IN_PROGRESS") return from === "OPEN" ? "Start work" : from === "RESOLVED" ? "Reopen" : "Back to in progress";
  if (to === "WAITING") return "Ask the shop";
  if (to === "RESOLVED") return "Mark resolved";
  return "Close";
}
const NEEDS_MESSAGE: TicketStatus[] = ["WAITING", "RESOLVED"];

export default function ComplaintPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const { data, error, reload } = useFetch<Data>(`/api/admin/tickets/${id}`);
  const now = useNow();
  const [flash, setFlash] = useState<string | null>(null);

  function done(msg: string) {
    setFlash(msg);
    setTimeout(() => setFlash(null), 4000);
    reload();
  }

  if (!data) {
    return (
      <div className="space-y-4">
        <BackLink />
        {error ? <ErrorBox message={error} onRetry={reload} /> : <p className="text-sm text-[var(--muted)]">Loading…</p>}
      </div>
    );
  }

  const t = data.ticket;
  const closed = t.status === "CLOSED";

  return (
    <div className="space-y-5 pb-16">
      <BackLink />

      <div className="panel-dark p-5 sm:p-6">
        <div className="flex flex-wrap items-center gap-2">
          <span className="font-mono text-xs text-white/70">{t.number}</span>
          <StatusChip status={t.status} />
          {t.priority === "high" && <span className="chip chip-kesar !py-0.5 !px-2 !text-[11.5px]">High priority</span>}
          <span className="text-xs text-white/70">{categoryLabel(t.category)}</span>
        </div>
        <h1 className="font-heading text-2xl sm:text-3xl font-bold mt-2 break-words">{t.subject}</h1>
        <p className="text-sm text-white/75 mt-1 break-words">
          {t.retailer.outletName}
          {t.retailer.area && ` · ${t.retailer.area.name}`} · raised {shortDate(t.createdAt, true)}
          {t.createdBy.role !== "RETAILER" && ` by ${t.createdBy.name} for the shop`}
        </p>
        <div className="mt-3 flex flex-wrap gap-x-5 gap-y-1 text-sm">
          {isOpenStatus(t.status) && (
            <span className={t.overdue ? "rounded-full bg-[#fde4e1] px-2.5 py-0.5 text-[#a8281e] font-bold" : "text-white/85"}>
              <SlaText status={t.status} slaDueAt={t.slaDueAt} now={now} className={t.overdue ? "!text-[#a8281e]" : "!text-white"} />
              <span className={t.overdue ? "font-normal" : "text-white/60"}> · due {shortDate(t.slaDueAt, true)}</span>
            </span>
          )}
          <span className="text-white/70">
            First reply:{" "}
            {t.firstResponseAt ? `${spanText(new Date(t.firstResponseAt).getTime() - new Date(t.createdAt).getTime())} after it was raised` : "not yet"}
          </span>
          {t.resolvedAt && <span className="text-white/70">Resolved {shortDate(t.resolvedAt, true)}</span>}
          {t.closedAt && <span className="text-white/70">Closed {shortDate(t.closedAt, true)}</span>}
        </div>
      </div>

      <Flash text={flash} />
      {error && <ErrorBox message={error} onRetry={reload} />}

      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_340px] items-start">
        <div className="space-y-5 min-w-0">
          <Thread messages={t.messages} />
          {closed ? (
            <p className="card p-4 text-sm text-[var(--muted)]">This complaint is closed. If the problem is back, the shop can raise a new one.</p>
          ) : (
            <ReplyBox ticket={t} onDone={done} />
          )}
        </div>

        <div className="space-y-5 min-w-0">
          {!closed && <Handling ticket={t} staff={data.staff} onDone={done} />}
          <ShopCard t={t} />
          {t.order && <OrderCard order={t.order} feedback={data.feedback} />}
        </div>
      </div>
    </div>
  );
}

function BackLink() {
  return (
    <Link href="/admin/complaints" className="inline-flex items-center gap-1 text-sm font-bold text-[var(--ink-2)]">
      <Icon name="arrow" className="h-4 w-4 rotate-180" /> All complaints
    </Link>
  );
}

// ───────────────────────────── thread ─────────────────────────────

function changeText(m: Message) {
  if (!m.change) return null;
  const [from, to] = m.change.split(">");
  const shop = m.author.role === "RETAILER";
  if (from === "RESOLVED" && to === "CLOSED") return "Closed";
  if (shop && from === "RESOLVED") return "The shop reopened it";
  if (shop && from === "WAITING") return "The shop answered: back to in progress";
  return `${m.author.name}: ${statusLabel(from)} → ${statusLabel(to)}`;
}

function Thread({ messages }: { messages: Message[] }) {
  return (
    <section className="card p-4 space-y-3">
      <h2 className="font-heading font-bold">Conversation</h2>
      {messages.length === 0 && <p className="text-sm text-[var(--muted)]">No messages.</p>}
      <ol className="space-y-3">
        {messages.map((m) => {
          const shop = m.author.role === "RETAILER";
          const change = changeText(m);
          return (
            <li key={m.id} className="space-y-1.5">
              {(m.body || m.photoKeys.length > 0) && (
                <div className={`flex ${shop ? "justify-start" : "justify-end"}`}>
                  <div
                    className={`max-w-[88%] sm:max-w-[80%] min-w-0 rounded-2xl px-3.5 py-2.5 ${
                      m.internal
                        ? "border-2 border-dashed border-[var(--genda)] bg-[var(--genda-tint)]"
                        : shop
                          ? "border border-[var(--line)] bg-white"
                          : "bg-[var(--mint-tint)]"
                    }`}
                  >
                    {m.internal && (
                      <p className="mb-1 flex items-center gap-1 text-[11px] font-extrabold uppercase tracking-[0.08em] text-[var(--genda-text)]">
                        <Icon name="eye" className="h-3.5 w-3.5" /> Internal note · Only staff see this
                      </p>
                    )}
                    <p className="text-xs font-bold text-[var(--ink-2)]">
                      {m.author.name}
                      <span className="font-normal text-[var(--muted)]">
                        {shop ? " · shop" : ""} · {shortDate(m.createdAt, true)}
                      </span>
                    </p>
                    {m.body && <p className="mt-1 whitespace-pre-wrap break-words text-sm">{m.body}</p>}
                    {m.photoKeys.length > 0 && (
                      <div className="mt-2 flex flex-wrap gap-2">
                        {m.photoKeys.map((k) => (
                          <a key={k} href={fileUrl(k)} target="_blank" rel="noreferrer" className="block h-20 w-20 overflow-hidden rounded-xl border border-[var(--line)] bg-white">
                            {/* eslint-disable-next-line @next/next/no-img-element */}
                            <img src={fileUrl(k)} alt="Photo" className="h-full w-full object-cover" loading="lazy" />
                          </a>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              )}
              {change && (
                <p className="flex items-center justify-center gap-2 text-center text-xs text-[var(--muted)]">
                  <span className="h-px w-6 bg-[var(--line)]" />
                  <span className="min-w-0 break-words">
                    {change} · {shortDate(m.createdAt, true)}
                  </span>
                  <span className="h-px w-6 bg-[var(--line)]" />
                </p>
              )}
            </li>
          );
        })}
      </ol>
    </section>
  );
}

// ───────────────────────────── reply ─────────────────────────────

function ReplyBox({ ticket, onDone }: { ticket: Ticket; onDone: (msg: string) => void }) {
  const [body, setBody] = useState("");
  const [internal, setInternal] = useState(false);
  const [photos, setPhotos] = useState<string[]>([]);
  const [uploading, setUploading] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const moves = NEXT[ticket.status];

  async function addPhoto(f: File | undefined) {
    if (!f) return;
    setUploading(true);
    setError(null);
    try {
      const key = await uploadImage(f, "ticket-photo");
      setPhotos((p) => [...p, key].slice(0, 4));
    } catch (e) {
      setError(errText(e));
    } finally {
      setUploading(false);
      if (fileInput.current) fileInput.current.value = "";
    }
  }

  async function go(status: TicketStatus | null) {
    const text = body.trim();
    if (status && NEEDS_MESSAGE.includes(status)) {
      if (!text) return setError(status === "RESOLVED" ? "Write how it was resolved in the box, then press Mark resolved." : "Write your question for the shop in the box, then press Ask the shop.");
      if (internal) return setError("The shop must see this message. Switch off “Internal note” first.");
    }
    if (!status && !text) return setError("Write a reply first.");
    setBusy(status ?? "reply");
    setError(null);
    try {
      await send(`/api/admin/tickets/${ticket.id}`, "PATCH", {
        ...(text ? { body: text, internal } : {}),
        ...(text && photos.length ? { photoKeys: photos } : {}),
        ...(status ? { status } : {}),
      });
      setBody("");
      setPhotos([]);
      setInternal(false);
      onDone(status ? `Moved to ${statusLabel(status).toLowerCase()}${text ? (internal ? " with a note" : " and the shop was told") : ""}` : internal ? "Note saved" : "Reply sent to the shop");
    } catch (e) {
      setError(errText(e));
    } finally {
      setBusy(null);
    }
  }

  return (
    <section className={`card p-4 space-y-3 ${internal ? "ring-2 ring-[var(--genda)]" : ""}`}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="font-heading font-bold">{internal ? "Internal note" : "Reply to the shop"}</h2>
        <Toggle checked={internal} onChange={setInternal} label="Internal note" hint="Only staff see it. The shop is not told." />
      </div>
      <textarea
        className={`input min-h-[110px] ${internal ? "!bg-[var(--genda-tint)]" : ""}`}
        value={body}
        maxLength={2000}
        placeholder={internal ? "Note for your team…" : "Write to the shop…"}
        onChange={(e) => {
          setBody(e.target.value);
          setError(null);
        }}
        aria-label={internal ? "Internal note" : "Reply"}
      />
      <div className="flex flex-wrap items-center gap-2">
        {photos.map((k) => (
          <span key={k} className="relative block h-14 w-14 overflow-hidden rounded-xl border border-[var(--line)]">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={fileUrl(k)} alt="Attached photo" className="h-full w-full object-cover" />
            <button
              type="button"
              className="absolute right-0.5 top-0.5 rounded-full bg-black/60 p-0.5 text-white"
              aria-label="Remove photo"
              onClick={() => setPhotos((p) => p.filter((x) => x !== k))}
            >
              <Icon name="x" className="h-3 w-3" />
            </button>
          </span>
        ))}
        {photos.length < 4 && (
          <button type="button" className="btn btn-quiet btn-xs" disabled={uploading} onClick={() => fileInput.current?.click()}>
            <Icon name="image" className="h-3.5 w-3.5" /> {uploading ? "Uploading…" : "Add photo"}
          </button>
        )}
        <input ref={fileInput} type="file" accept="image/jpeg,image/png,image/webp" className="hidden" onChange={(e) => addPhoto(e.target.files?.[0])} />
        <button type="button" className={`btn btn-sm ml-auto ${internal ? "btn-mor" : "btn-kesar"}`} disabled={!!busy || uploading} onClick={() => go(null)}>
          {busy === "reply" ? "Sending…" : internal ? "Save note" : "Send reply"}
        </button>
      </div>
      {ticket.status === "OPEN" && !internal && <p className="text-xs text-[var(--muted)]">Sending a reply the shop can see moves this complaint to In progress.</p>}

      {moves.length > 0 && (
        <div className="border-t border-[var(--line)] pt-3 space-y-2">
          <p className="text-sm font-medium text-[var(--ink-2)]">Change status{body.trim() ? " (sends the message above with it)" : ""}</p>
          <div className="flex flex-wrap gap-2">
            {moves.map((s) => (
              <button
                key={s}
                type="button"
                className={`btn btn-sm ${s === "RESOLVED" ? "btn-mor" : "btn-outline"}`}
                disabled={!!busy || uploading}
                onClick={() => go(s)}
              >
                {s === "RESOLVED" && <Icon name="check" className="h-4 w-4" />}
                {busy === s ? "Saving…" : moveLabel(ticket.status, s)}
              </button>
            ))}
          </div>
          <p className="text-xs text-[var(--muted)]">“Mark resolved” and “Ask the shop” need a message the shop can see.</p>
        </div>
      )}
      {error && (
        <p className="text-sm text-[#a8281e]" role="alert">
          {error}
        </p>
      )}
    </section>
  );
}

// ───────────────────────────── side ─────────────────────────────

function Handling({ ticket, staff, onDone }: { ticket: Ticket; staff: { id: string; name: string }[]; onDone: (msg: string) => void }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function patch(body: Record<string, unknown>, msg: string) {
    setBusy(true);
    setError(null);
    try {
      await send(`/api/admin/tickets/${ticket.id}`, "PATCH", body);
      onDone(msg);
    } catch (e) {
      setError(errText(e));
    } finally {
      setBusy(false);
    }
  }

  const current = ticket.assignedTo?.id ?? "";
  const known = !current || staff.some((s) => s.id === current);

  return (
    <section className="card p-4 space-y-3">
      <h2 className="font-heading font-bold">Handling</h2>
      <label className="block">
        <span className="block text-sm font-medium text-[var(--ink-2)] mb-1">Assigned to</span>
        <select
          className="input"
          value={current}
          disabled={busy}
          onChange={(e) => {
            const v = e.target.value;
            const name = staff.find((s) => s.id === v)?.name;
            patch({ assignedToId: v || null }, v ? `Assigned to ${name}` : "No one is assigned now");
          }}
        >
          <option value="">Not assigned</option>
          {!known && ticket.assignedTo && <option value={ticket.assignedTo.id}>{ticket.assignedTo.name}</option>}
          {staff.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
            </option>
          ))}
        </select>
        <span className="block text-xs text-[var(--muted)] mt-1">Only staff who handle complaints are listed.</span>
      </label>
      <Toggle
        checked={ticket.priority === "high"}
        disabled={busy}
        onChange={(v) => patch({ priority: v ? "high" : "normal" }, v ? "Marked high priority" : "Back to normal priority")}
        label="High priority"
        hint="Damaged, missing and expired goods start as high."
      />
      {error && (
        <p className="text-sm text-[#a8281e]" role="alert">
          {error}
        </p>
      )}
    </section>
  );
}

function ShopCard({ t }: { t: Ticket }) {
  const phone = t.retailer.user?.phone;
  return (
    <section className="card p-4 space-y-2">
      <h2 className="font-heading font-bold">Shop</h2>
      <div>
        <p className="font-bold break-words">{t.retailer.outletName}</p>
        {t.retailer.user?.name && t.retailer.user.name !== t.retailer.outletName && <p className="text-sm text-[var(--ink-2)]">{t.retailer.user.name}</p>}
        {t.retailer.area && (
          <p className="text-sm text-[var(--muted)]">
            <Icon name="pin" className="inline h-3.5 w-3.5 mr-1 -mt-0.5" />
            {t.retailer.area.name}
          </p>
        )}
      </div>
      <div className="flex flex-wrap gap-2">
        {phone && (
          <a href={`tel:${phone}`} className="btn btn-outline btn-xs">
            <Icon name="phone" className="h-3.5 w-3.5" /> {phone}
          </a>
        )}
        <Link href={`/admin/khata/${t.retailer.id}`} className="btn btn-quiet btn-xs">
          <Icon name="book" className="h-3.5 w-3.5" /> Khata
        </Link>
      </div>
    </section>
  );
}

function OrderCard({ order, feedback }: { order: NonNullable<Ticket["order"]>; feedback: Data["feedback"] }) {
  return (
    <section className="card p-4 space-y-3">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <h2 className="font-heading font-bold">Order {order.orderNumber}</h2>
          <p className="text-xs text-[var(--muted)]">
            {shortDate(order.createdAt)} · {order.status.toLowerCase().replace(/_/g, " ")}
          </p>
        </div>
        <p className="font-heading font-bold whitespace-nowrap">{formatINR(order.totalAmount)}</p>
      </div>
      <ul className="divide-y divide-[var(--line)] text-sm">
        {order.items.map((i) => (
          <li key={i.id} className="flex items-baseline justify-between gap-3 py-1.5">
            <span className="min-w-0 break-words">{i.product.name}</span>
            <span className="shrink-0 font-semibold">× {i.quantity}</span>
          </li>
        ))}
      </ul>
      <div className="border-t border-[var(--line)] pt-3">
        <p className="text-sm font-medium text-[var(--ink-2)]">Delivery rating</p>
        {feedback ? (
          <div className="mt-1 space-y-1.5">
            <p className="flex items-center gap-2">
              <Stars value={feedback.rating} className="text-lg" />
              <span className="text-sm font-bold">{feedback.rating} / 5</span>
            </p>
            {feedback.tags.length > 0 && (
              <div className="flex flex-wrap gap-1">
                {feedback.tags.map((tg) => (
                  <span key={tg} className={`chip !py-0.5 !px-2 !text-[11.5px] ${tagGood(tg) ? "chip-mint" : "chip-kesar"}`}>
                    {tagLabel(tg)}
                  </span>
                ))}
              </div>
            )}
            {feedback.comment && <p className="text-sm text-[var(--ink-2)] whitespace-pre-wrap break-words">“{feedback.comment}”</p>}
          </div>
        ) : (
          <p className="text-sm text-[var(--muted)]">Not rated.</p>
        )}
      </div>
    </section>
  );
}
