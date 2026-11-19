"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Icon, { type IconName } from "@/components/Icon";
import { ErrorBox, Flash, TabBar, Toggle, errText, send, useFetch, api } from "@/components/admin/AdminKit";
import { ago, notifyChanged } from "@/components/engage/kit";
import PushCard, { type PushInfo } from "@/components/engage/PushCard";

type Note = { id: string; event: string; title: string; body: string; link: string | null; readAt: string | null; createdAt: string };
type Page = { items: Note[]; unread: number; more: boolean };

export type Prefs = {
  lang: "en" | "hi";
  mutes: string[];
  hasPhone: boolean;
  retailer: boolean;
  channels: { push: boolean; whatsapp: boolean; sms: boolean };
  push: PushInfo;
};

const LIMIT = 30;

function iconFor(event: string): IconName {
  if (event === "order.dispatched") return "truck";
  if (event.startsWith("order.") || event === "staff.order") return "box";
  if (event.startsWith("payment") || event === "dues.reminder") return "wallet";
  if (event === "invoice.issued" || event === "statement") return "receipt";
  if (event.includes("ticket")) return "chat";
  if (event.startsWith("referral")) return "gift";
  if (event.includes("announcement")) return "megaphone";
  if (event === "staff.feedback_low") return "star";
  if (event === "staff.leave") return "clock";
  if (event === "staff.lead") return "plus";
  return "bell";
}

/** The bell's page for every role: my messages, and what reaches me where. */
export default function NotificationsView() {
  const [tab, setTab] = useState<"inbox" | "settings">("inbox");
  return (
    <div className="space-y-5">
      <div>
        <p className="page-kick">Messages</p>
        <h1 className="page-title">Notifications</h1>
        <p className="page-sub">Updates about orders, payments and more. Choose below how they reach you.</p>
      </div>
      <TabBar
        tabs={[
          { key: "inbox", label: "All messages" },
          { key: "settings", label: "Settings" },
        ]}
        value={tab}
        onChange={setTab}
      />
      {tab === "inbox" ? <Inbox /> : <Settings />}
    </div>
  );
}

function Inbox() {
  const router = useRouter();
  const [items, setItems] = useState<Note[] | null>(null);
  const [unread, setUnread] = useState(0);
  const [more, setMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(
    (before?: string) =>
      api<Page>(`/api/notifications?limit=${LIMIT}${before ? `&before=${encodeURIComponent(before)}` : ""}`)
        .then((d) => {
          setItems((cur) => (before && cur ? [...cur, ...d.items.filter((n) => !cur.some((c) => c.id === n.id))] : d.items));
          setUnread(d.unread);
          setMore(d.more);
          setError(null);
        })
        .catch((e) => setError(errText(e)))
        .finally(() => setBusy(false)),
    []
  );

  useEffect(() => {
    load();
  }, [load]);

  async function older() {
    setBusy(true);
    await load(items?.[items.length - 1]?.createdAt);
  }

  async function markRead(ids: string[] | "all") {
    const now = new Date().toISOString();
    setItems((cur) => cur?.map((n) => (ids === "all" || ids.includes(n.id) ? { ...n, readAt: n.readAt ?? now } : n)) ?? cur);
    setUnread((u) => (ids === "all" ? 0 : Math.max(0, u - ids.length)));
    try {
      await send("/api/notifications", "POST", ids === "all" ? { all: true } : { ids });
    } catch {
      // Not saved: it shows as unread again next time. Nothing else to do.
    }
    notifyChanged();
  }

  async function open(n: Note) {
    if (!n.readAt) await markRead([n.id]);
    if (n.link) router.push(n.link);
  }

  if (error && !items) return <ErrorBox message={error} onRetry={() => older()} />;
  if (!items) return <p className="text-sm text-[var(--muted)]">Loading…</p>;

  if (!items.length) {
    return (
      <div className="card p-6 text-center space-y-2">
        <span className="icon-tile mx-auto bg-ink/5 text-[var(--muted)]">
          <Icon name="bell" />
        </span>
        <p className="text-sm text-[var(--ink-2)]">No messages yet. Order updates and offers will show here.</p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-3">
        <p className="text-sm text-[var(--muted)]">{unread ? `${unread} unread` : "All read"}</p>
        {unread > 0 && (
          <button type="button" className="btn btn-quiet btn-xs" onClick={() => markRead("all")}>
            <Icon name="check" className="h-3.5 w-3.5" /> Mark all read
          </button>
        )}
      </div>

      <ul className="card divide-y divide-[var(--line)] overflow-hidden">
        {items.map((n) => {
          const fresh = !n.readAt;
          return (
            <li key={n.id} className={fresh ? "bg-[var(--kesar-tint)]/50" : ""}>
              <button
                type="button"
                onClick={() => open(n)}
                className="w-full text-left flex items-start gap-3 px-4 py-3 min-h-[64px] hover:bg-black/[0.03]"
              >
                <span
                  className={`icon-tile !h-10 !w-10 shrink-0 ${
                    fresh ? "bg-[var(--kesar-tint)] text-[var(--kesar-text)]" : "bg-ink/5 text-[var(--muted)]"
                  }`}
                >
                  <Icon name={iconFor(n.event)} className="h-5 w-5" />
                </span>
                <span className="flex-1 min-w-0">
                  <span className="flex items-start justify-between gap-2">
                    <span className={`text-sm break-words ${fresh ? "font-bold" : "font-semibold text-[var(--ink-2)]"}`}>{n.title}</span>
                    <span className="text-[11px] text-[var(--muted)] shrink-0 mt-0.5">{ago(n.createdAt)}</span>
                  </span>
                  {n.body && <span className="block text-xs text-[var(--muted)] mt-0.5 break-words line-clamp-3">{n.body}</span>}
                </span>
                {fresh && <span className="mt-2 h-2 w-2 shrink-0 rounded-full bg-[var(--kesar)]" aria-label="Unread" />}
              </button>
            </li>
          );
        })}
      </ul>

      {error && <p className="text-sm text-[#a8281e]">{error}</p>}
      {more && (
        <button type="button" className="btn btn-quiet w-full" disabled={busy} onClick={older}>
          {busy ? "Loading…" : "Show older"}
        </button>
      )}
    </div>
  );
}

const CHANNEL_TEXT = {
  push: { label: "Phone notifications", hint: "Pop-up alerts on phones and browsers where you turned them on." },
  whatsapp: { label: "WhatsApp", hint: "Messages to your mobile number on WhatsApp." },
  sms: { label: "SMS", hint: "Text messages to your mobile number." },
} as const;

function Settings() {
  const { data, error, reload, setData } = useFetch<Prefs>("/api/notifications/prefs");
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  async function save(patch: { lang?: "en" | "hi"; mutes?: string[] }) {
    if (!data) return;
    const before = data;
    setData({ ...data, ...patch });
    setSaving(true);
    setMsg(null);
    try {
      await send("/api/notifications/prefs", "PATCH", patch);
      setMsg({ ok: true, text: "Saved" });
    } catch (e) {
      setData(before);
      setMsg({ ok: false, text: errText(e) });
    } finally {
      setSaving(false);
    }
  }

  if (error && !data) return <ErrorBox message={error} onRetry={reload} />;
  if (!data) return <p className="text-sm text-[var(--muted)]">Loading…</p>;

  const muted = (k: string) => data.mutes.includes(k);
  const setMuted = (k: string, off: boolean) =>
    save({ mutes: off ? [...new Set([...data.mutes, k])] : data.mutes.filter((m) => m !== k) });
  // Staff messages are in-app and push only; retailers also get WhatsApp and SMS where the business uses them.
  const channels = (["push", "whatsapp", "sms"] as const).filter((c) => data.channels[c] && (c === "push" || data.retailer));

  return (
    <div className="space-y-4">
      <PushCard push={data.push} pushChannelOn={data.channels.push} onDevicesChange={reload} />

      <section className="card p-4 space-y-3">
        <div>
          <h2 className="font-bold text-base">Language of messages</h2>
          <p className="text-xs text-[var(--muted)] mt-0.5">Notifications, WhatsApp and SMS come in this language.</p>
        </div>
        <div className="flex rounded-2xl p-1 bg-ink/5" role="radiogroup" aria-label="Language of messages">
          {(
            [
              ["en", "English"],
              ["hi", "हिंदी"],
            ] as const
          ).map(([k, label]) => (
            <button
              key={k}
              type="button"
              role="radio"
              aria-checked={data.lang === k}
              disabled={saving}
              onClick={() => data.lang !== k && save({ lang: k })}
              className={`flex-1 min-h-[44px] rounded-xl text-sm font-bold transition ${
                data.lang === k ? "bg-white text-[var(--ink)] shadow-sm" : "text-[var(--ink-2)]"
              }`}
            >
              {label}
            </button>
          ))}
        </div>
      </section>

      <section className="card p-4 space-y-4">
        <div>
          <h2 className="font-bold text-base">Where messages reach me</h2>
          <p className="text-xs text-[var(--muted)] mt-0.5">Everything always shows here in the app too.</p>
        </div>
        {channels.length === 0 ? (
          <p className="text-sm text-[var(--muted)]">Messages only show here in the app for now.</p>
        ) : (
          channels.map((c) => (
            <Toggle
              key={c}
              checked={!muted(c)}
              disabled={saving}
              onChange={(on) => setMuted(c, !on)}
              label={CHANNEL_TEXT[c].label}
              hint={c !== "push" && !data.hasPhone ? "Add a mobile number to your account to get these." : CHANNEL_TEXT[c].hint}
            />
          ))
        )}
      </section>

      {data.retailer && (
        <section className="card p-4 space-y-4">
          <div>
            <h2 className="font-bold text-base">What to send me</h2>
            <p className="text-xs text-[var(--muted)] mt-0.5">
              Order, delivery, payment and complaint updates always come. You can turn these off.
            </p>
          </div>
          <Toggle
            checked={!muted("reminders")}
            disabled={saving}
            onChange={(on) => setMuted("reminders", !on)}
            label="Payment reminders"
            hint="When a bill is past its due date."
          />
          <Toggle
            checked={!muted("promo")}
            disabled={saving}
            onChange={(on) => setMuted("promo", !on)}
            label="Offers and announcements"
            hint="New schemes, products and news from us."
          />
        </section>
      )}

      {msg && (msg.ok ? <Flash text={msg.text} /> : <p className="text-sm text-[#a8281e]">{msg.text}</p>)}
    </div>
  );
}
