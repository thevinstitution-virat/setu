"use client";

import { useEffect, useState } from "react";
import Icon from "@/components/Icon";
import { EVENTS } from "@/lib/notify-events";
import { ErrorBox, Flash, api, errText, send, shortDate, useFetch } from "@/components/admin/AdminKit";
import { EngageNav, plural } from "@/components/engage/admin/kit";

type Status = "QUEUED" | "SENT" | "FAILED" | "LOGGED" | "SKIPPED";
type Channel = "SMS" | "WHATSAPP" | "PUSH";
type Message = {
  id: string;
  userId: string | null;
  name: string | null;
  channel: Channel;
  to: string;
  event: string;
  lang: string;
  title: string | null;
  body: string;
  status: Status;
  provider: string | null;
  error: string | null;
  attempts: number;
  createdAt: string;
  sentAt: string | null;
};
type Data = {
  channels: { push: string; whatsapp: string; sms: string };
  counts: { status: Status; channel: Channel; count: number }[];
  items: Message[];
  more: boolean;
};

const STATUS: Record<Status, { label: string; chip: string; hint: string }> = {
  QUEUED: { label: "Waiting", chip: "chip-genda", hint: "Waiting to be sent" },
  SENT: { label: "Sent", chip: "chip-mint", hint: "Handed to the provider" },
  FAILED: { label: "Failed", chip: "chip-kesar", hint: "The provider refused it or could not be reached" },
  LOGGED: { label: "Only logged", chip: "", hint: "No provider is set up, so it was only written here" },
  SKIPPED: { label: "Skipped", chip: "", hint: "The person turned it off, has no number, or no phone subscribed" },
};
const CHANNELS: { key: Channel; set: keyof Data["channels"]; label: string }[] = [
  { key: "PUSH", set: "push", label: "Push" },
  { key: "WHATSAPP", set: "whatsapp", label: "WhatsApp" },
  { key: "SMS", set: "sms", label: "SMS" },
];
const channelLabel = (c: string) => CHANNELS.find((x) => x.key === c)?.label ?? c;
const eventLabel = (e: string) => (EVENTS as Record<string, { label: string }>)[e]?.label ?? (e.startsWith("test") ? "Test" : e);
const EVENT_OPTIONS = Object.entries(EVENTS).map(([k, v]) => ({ key: k, label: `${v.label}${v.audience === "staff" ? " (staff)" : ""}` }));

export default function MessagesPage() {
  const [status, setStatus] = useState("");
  const [channel, setChannel] = useState("");
  const [event, setEvent] = useState("");
  const [q, setQ] = useState("");
  const [query, setQuery] = useState("");
  const [flash, setFlash] = useState<string | null>(null);
  const [older, setOlder] = useState<{ key: string; items: Message[]; more: boolean } | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const [moreError, setMoreError] = useState<string | null>(null);

  useEffect(() => {
    const t = setTimeout(() => setQuery(q.trim()), 300);
    return () => clearTimeout(t);
  }, [q]);

  const params = new URLSearchParams();
  if (status) params.set("status", status);
  if (channel) params.set("channel", channel);
  if (event) params.set("event", event);
  if (query) params.set("q", query);
  const key = params.toString();
  const { data, error, reload } = useFetch<Data>(`/api/admin/messages${key ? `?${key}` : ""}`);

  // Older pages belong to one filter; a new filter starts again from the newest.
  const extra = older && older.key === key ? older : null;
  const items = [...(data?.items ?? []), ...(extra?.items ?? [])];
  const more = extra ? extra.more : (data?.more ?? false);

  async function loadMore() {
    const last = items[items.length - 1];
    if (!last) return;
    setLoadingMore(true);
    setMoreError(null);
    try {
      const p = new URLSearchParams(params);
      p.set("before", last.createdAt);
      const d = await api<Data>(`/api/admin/messages?${p}`);
      setOlder({ key, items: [...(extra?.items ?? []), ...d.items], more: d.more });
    } catch (e) {
      setMoreError(errText(e));
    } finally {
      setLoadingMore(false);
    }
  }

  function refresh(msg?: string) {
    setOlder(null);
    reload();
    if (msg) {
      setFlash(msg);
      setTimeout(() => setFlash(null), 5000);
    }
  }

  return (
    <div className="space-y-5 pb-16">
      <div className="page-head">
        <div className="min-w-0">
          <p className="page-kick">Engage</p>
          <h1 className="page-title">Message log</h1>
          <p className="page-sub">Every push, WhatsApp and SMS the app has sent or tried to send. In-app notifications are not listed here.</p>
        </div>
        <TestPush onDone={refresh} />
      </div>
      <EngageNav />

      {data && <ChannelCards data={data} />}
      <Flash text={flash} />

      <div className="grid gap-2 grid-cols-2 lg:grid-cols-[minmax(0,1fr)_160px_160px_220px]">
        <div className="relative col-span-2 lg:col-span-1">
          <Icon name="search" className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--muted)]" />
          <input className="input !pl-9" type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search phone number or text" aria-label="Search messages" />
        </div>
        <select className="input" value={status} onChange={(e) => setStatus(e.target.value)} aria-label="Status">
          <option value="">Any status</option>
          {(Object.keys(STATUS) as Status[]).map((s) => (
            <option key={s} value={s}>
              {STATUS[s].label}
            </option>
          ))}
        </select>
        <select className="input" value={channel} onChange={(e) => setChannel(e.target.value)} aria-label="Channel">
          <option value="">Any channel</option>
          {CHANNELS.map((c) => (
            <option key={c.key} value={c.key}>
              {c.label}
            </option>
          ))}
        </select>
        <select className="input col-span-2 lg:col-span-1" value={event} onChange={(e) => setEvent(e.target.value)} aria-label="Message">
          <option value="">Any message</option>
          {EVENT_OPTIONS.map((o) => (
            <option key={o.key} value={o.key}>
              {o.label}
            </option>
          ))}
        </select>
      </div>

      {error && <ErrorBox message={error} onRetry={reload} />}
      {!data && !error && <p className="text-sm text-[var(--muted)]">Loading…</p>}

      {data &&
        (items.length === 0 ? (
          <div className="card p-6 text-center">
            <p className="text-sm text-[var(--muted)]">{key ? "No message matches these filters." : "Nothing sent yet."}</p>
          </div>
        ) : (
          <ul className="card divide-y divide-[var(--line)] overflow-hidden">
            {items.map((m) => (
              <li key={m.id}>
                <MessageRow m={m} onRetried={() => refresh("Sending it again")} />
              </li>
            ))}
          </ul>
        ))}
      {moreError && <p className="text-sm text-[var(--risk-text)]">{moreError}</p>}
      {data && more && (
        <button type="button" className="btn btn-quiet btn-sm" disabled={loadingMore} onClick={loadMore}>
          {loadingMore ? "Loading…" : "Show older"}
        </button>
      )}
    </div>
  );
}

function ChannelCards({ data }: { data: Data }) {
  const ready = (s: string) => s === "ready";
  return (
    <div className="space-y-2">
      <div className="grid gap-3 sm:grid-cols-3">
        {CHANNELS.map((c) => {
          const st = data.channels[c.set];
          const rows = data.counts.filter((x) => x.channel === c.key);
          const n = (s: Status) => rows.find((x) => x.status === s)?.count ?? 0;
          return (
            <div key={c.key} className="card p-4 min-w-0 space-y-2">
              <div className="flex items-center justify-between gap-2">
                <p className="font-heading font-bold">{c.label}</p>
                <span className={`chip !py-0.5 !px-2 !text-[11.5px] ${ready(st) ? "chip-mint" : "chip-genda"}`}>{ready(st) ? "Ready" : "Not set up"}</span>
              </div>
              {!ready(st) && st !== "not set up" && <p className="text-xs text-[var(--muted)] break-words">{st}</p>}
              <p className="text-xs text-[var(--muted)]">Last 7 days</p>
              <div className="flex flex-wrap gap-x-3 gap-y-1 text-sm">
                <span>
                  <b>{n("SENT")}</b> sent
                </span>
                <span className={n("FAILED") ? "text-[var(--risk-text)]" : ""}>
                  <b>{n("FAILED")}</b> failed
                </span>
                <span className="text-[var(--muted)]">{n("LOGGED")} only logged</span>
                <span className="text-[var(--muted)]">{n("SKIPPED")} skipped</span>
                {n("QUEUED") > 0 && <span className="text-[var(--scheme-text)]">{n("QUEUED")} waiting</span>}
              </div>
            </div>
          );
        })}
      </div>
      <p className="text-xs text-[var(--muted)]">
        A channel that is not set up has no provider yet: its messages are only logged here, nothing reaches the phone. Everyone still gets the message in the app&apos;s bell.
      </p>
    </div>
  );
}

function MessageRow({ m, onRetried }: { m: Message; onRetried: () => void }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function retry() {
    setBusy(true);
    setError(null);
    try {
      await send(`/api/admin/messages/${m.id}`, "POST");
      onRetried();
    } catch (e) {
      setError(errText(e));
      setBusy(false);
    }
  }

  const s = STATUS[m.status];
  return (
    <div className="px-4 py-3 space-y-1 min-w-0">
      <div className="flex flex-wrap items-center gap-1.5">
        <span className="chip chip-mor !py-0.5 !px-2 !text-[11.5px]">{channelLabel(m.channel)}</span>
        <span className={`chip !py-0.5 !px-2 !text-[11.5px] ${s?.chip ?? ""}`} title={s?.hint}>
          {s?.label ?? m.status}
        </span>
        <span className="text-xs font-semibold text-[var(--ink-2)]">{eventLabel(m.event)}</span>
        <span className="text-xs text-[var(--muted)] ml-auto whitespace-nowrap">{shortDate(m.createdAt, true)}</span>
      </div>
      <p className="text-sm">
        <b>{m.name ?? "Unknown person"}</b>
        {m.to !== "push" && <span className="text-[var(--muted)]"> · {m.to}</span>}
        <span className="text-[var(--muted)]"> · {m.lang === "hi" ? "Hindi" : "English"}</span>
      </p>
      {m.title && <p className="text-sm font-semibold break-words">{m.title}</p>}
      <p className="text-sm text-[var(--ink-2)] break-words line-clamp-3">{m.body}</p>
      {(m.error || m.status === "FAILED") && (
        <p className={`text-xs break-words ${m.status === "FAILED" ? "text-[var(--risk-text)]" : "text-[var(--muted)]"}`}>
          {m.error ?? s?.hint}
          {m.attempts > 0 && ` · ${plural(m.attempts, "try", "tries")}`}
        </p>
      )}
      {m.status === "FAILED" && (
        <div className="flex flex-wrap items-center gap-2 pt-1">
          <button type="button" className="btn btn-outline btn-xs" disabled={busy} onClick={retry}>
            {busy ? "Sending…" : "Send again"}
          </button>
          {error && <span className="text-xs text-[var(--risk-text)]">{error}</span>}
        </div>
      )}
    </div>
  );
}

function TestPush({ onDone }: { onDone: (msg: string) => void }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function go() {
    setBusy(true);
    setError(null);
    try {
      const r = await send<{ result: { inApp: number; messages: number } }>("/api/admin/messages", "POST");
      onDone(
        r.result.messages
          ? "Test push queued. If Push shows Ready below, it pops up on this browser in a few seconds; if not, it is only logged. It is also in your bell."
          : "Test is in your bell. No push was sent: push is off in Settings, or this browser has not turned on notifications yet."
      );
    } catch (e) {
      setError(errText(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col items-start sm:items-end gap-1">
      <button type="button" className="btn btn-outline btn-sm" disabled={busy} onClick={go}>
        <Icon name="bell" className="h-4 w-4" /> {busy ? "Sending…" : "Send me a test push"}
      </button>
      {error && <p className="text-xs text-[var(--risk-text)]">{error}</p>}
    </div>
  );
}
