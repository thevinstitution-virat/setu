"use client";

import { useState } from "react";
import Link from "next/link";
import Icon from "@/components/Icon";
import { CHANNELS, type Channel, type NotifySettings } from "@/lib/engage-settings";
import { EVENTS, type EventKey } from "@/lib/notify-events";
import { Toggle } from "@/components/admin/AdminKit";

/** GET /api/admin/settings `channels`: "ready", "not set up" or another note per provider. */
export type ChannelStatus = Record<Channel, string>;

type Row = Record<Channel, boolean>;

type Form = {
  channels: Row;
  events: Record<EventKey, Row>;
  remindersOn: boolean;
  days: number[];
  monthlyStatement: boolean;
};

const CHANNEL_INFO: Record<Channel, { label: string; short: string; hint: string }> = {
  push: { label: "Push notifications", short: "Push", hint: "Free. Shows on the phone or browser of anyone who allowed notifications." },
  whatsapp: { label: "WhatsApp", short: "WhatsApp", hint: "Sent from your business WhatsApp number. Each message may cost a little." },
  sms: { label: "SMS", short: "SMS", hint: "For shops without WhatsApp. Each message costs a little." },
};

const KEYS = Object.keys(EVENTS) as EventKey[];
const RETAILER_KEYS = KEYS.filter((k) => EVENTS[k].audience === "retailer");
const STAFF_KEYS = KEYS.filter((k) => EVENTS[k].audience === "staff");
const MAX_DAYS = 6;
/** Announcements carry their own channels, chosen when each one is sent. */
const PICKED_PER_SEND: EventKey[] = ["announcement", "staff.announcement"];

const isStaff = (k: EventKey) => EVENTS[k].audience === "staff";
const byDefault = (k: EventKey, ch: Channel) => (EVENTS[k].channels as readonly string[]).includes(ch);

function toForm(n: NotifySettings): Form {
  const events = {} as Record<EventKey, Row>;
  for (const k of KEYS) {
    const row = {} as Row;
    for (const ch of CHANNELS) {
      const own = n.events[k]?.[ch];
      row[ch] = isStaff(k) && ch !== "push" ? false : typeof own === "boolean" ? own : byDefault(k, ch);
    }
    events[k] = row;
  }
  return {
    channels: { ...n.channels },
    events,
    remindersOn: n.reminders.on,
    days: [...n.reminders.days].sort((a, b) => a - b),
    monthlyStatement: n.monthlyStatement,
  };
}

/** Per-message choices that differ from each message's own default (the API stores this map whole). */
function eventOverrides(events: Form["events"]): NotifySettings["events"] {
  const out: NotifySettings["events"] = {};
  for (const k of KEYS) {
    const row: Partial<Row> = {};
    for (const ch of CHANNELS) {
      if (isStaff(k) && ch !== "push") continue;
      if (events[k][ch] !== byDefault(k, ch)) row[ch] = events[k][ch];
    }
    if (Object.keys(row).length) out[k] = row;
  }
  return out;
}

/** Only the changed parts as the API's `notify` patch, or an error message. */
function toPatch(f: Form, was: Form): Partial<NotifySettings> | string {
  const out: Partial<NotifySettings> = {};
  if (JSON.stringify(f.channels) !== JSON.stringify(was.channels)) out.channels = f.channels;
  if (JSON.stringify(f.events) !== JSON.stringify(was.events)) out.events = eventOverrides(f.events);
  if (f.remindersOn !== was.remindersOn || JSON.stringify(f.days) !== JSON.stringify(was.days)) {
    if (f.remindersOn && !f.days.length) return "Add at least one reminder day, or turn payment reminders off";
    out.reminders = { on: f.remindersOn, days: f.days };
  }
  if (f.monthlyStatement !== was.monthlyStatement) out.monthlyStatement = f.monthlyStatement;
  return out;
}

function StatusChip({ status }: { status: string }) {
  if (status === "ready") return <span className="chip chip-mint !py-0.5 !px-2 !text-[11.5px]">Ready</span>;
  return <span className="chip chip-genda !py-0.5 !px-2 !text-[11.5px]">Not set up</span>;
}

function statusNote(ch: Channel, status: string) {
  if (status === "ready") return null;
  const what = ch === "push" ? "Push notifications" : CHANNEL_INFO[ch].label;
  const extra = status !== "not set up" ? ` (${status})` : "";
  return `${what} isn't connected yet${extra}. Until it is set up, these messages are only logged here, not sent.`;
}

/** One channel on one message: a small tappable chip that wraps on phones. */
function ChannelChip({
  label,
  checked,
  onChange,
  disabled,
  dim,
}: {
  label: string;
  checked: boolean;
  onChange: (v: boolean) => void;
  disabled?: boolean;
  dim?: boolean;
}) {
  return (
    <label
      className={`chip !py-1.5 select-none transition ${checked && !disabled ? "chip-mint" : "text-[var(--muted)]"} ${
        disabled ? "opacity-40 cursor-not-allowed" : dim ? "opacity-60 cursor-pointer" : "cursor-pointer"
      } has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-mor`}
    >
      <input type="checkbox" className="sr-only" checked={checked && !disabled} disabled={disabled} onChange={(e) => onChange(e.target.checked)} />
      <span
        aria-hidden="true"
        className={`grid h-3.5 w-3.5 place-items-center rounded-[4px] border ${checked && !disabled ? "border-transparent bg-[var(--mint-text)] text-white" : "border-current"}`}
      >
        {checked && !disabled && <Icon name="check" className="h-2.5 w-2.5" />}
      </span>
      {label}
    </label>
  );
}

export default function MessageSettings({ notify, channels }: { notify: NotifySettings; channels: ChannelStatus }) {
  const [saved, setSaved] = useState(() => toForm(notify));
  const [f, setF] = useState(saved);
  const [day, setDay] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [savedAt, setSavedAt] = useState<Date | null>(null);

  const dirty = JSON.stringify(f) !== JSON.stringify(saved);
  const set = <K extends keyof Form>(k: K, v: Form[K]) => {
    setF((prev) => ({ ...prev, [k]: v }));
    setError(null);
  };
  const setEvent = (k: EventKey, ch: Channel, v: boolean) => {
    setF((prev) => ({ ...prev, events: { ...prev.events, [k]: { ...prev.events[k], [ch]: v } } }));
    setError(null);
  };

  const dayNum = Number(day);
  const dayOk = day.trim() !== "" && Number.isInteger(dayNum) && dayNum >= 0 && dayNum <= 120;
  function addDay() {
    if (!dayOk) return setError("A reminder day must be a whole number from 0 to 120");
    if (f.days.includes(dayNum)) return setDay("");
    if (f.days.length >= MAX_DAYS) return setError(`Up to ${MAX_DAYS} reminder days`);
    set("days", [...f.days, dayNum].sort((a, b) => a - b));
    setDay("");
  }

  async function save(e: React.FormEvent) {
    e.preventDefault();
    const patch = toPatch(f, saved);
    if (typeof patch === "string") return setError(patch);
    if (!Object.keys(patch).length) return setF(saved);
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/admin/settings", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ notify: patch }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error ?? "Could not save");
      if (data.notify) {
        const next = toForm(data.notify);
        setSaved(next);
        setF(next);
      }
      setSavedAt(new Date());
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save");
    } finally {
      setBusy(false);
    }
  }

  const eventRow = (k: EventKey) => {
    const ev = EVENTS[k];
    const topic = "topic" in ev ? ev.topic : undefined;
    return (
      <li key={k} className="flex flex-col gap-2 py-3 sm:flex-row sm:items-center sm:justify-between sm:gap-4">
        <div className="min-w-0">
          <p className="text-sm font-medium">{ev.label}</p>
          {topic && <p className="text-xs text-[var(--muted)]">Shops can turn {topic === "promo" ? "announcements" : "reminders"} off for themselves.</p>}
        </div>
        {PICKED_PER_SEND.includes(k) ? (
          <p className="text-xs text-[var(--muted)] sm:text-right sm:max-w-[14rem]">You pick the channels each time you send an announcement.</p>
        ) : (
          <div className="flex flex-wrap gap-1.5 sm:shrink-0" role="group" aria-label={`Channels for ${ev.label}`}>
            {CHANNELS.map((ch) => (
              <ChannelChip
                key={ch}
                label={CHANNEL_INFO[ch].short}
                checked={f.events[k][ch]}
                disabled={isStaff(k) && ch !== "push"}
                dim={!f.channels[ch]}
                onChange={(v) => setEvent(k, ch, v)}
              />
            ))}
          </div>
        )}
      </li>
    );
  };

  const offChannels = CHANNELS.filter((ch) => !f.channels[ch]).map((ch) => CHANNEL_INFO[ch].short);

  return (
    <form onSubmit={save} className="space-y-5">
      <div id="messages" className="pt-4 scroll-mt-20">
        <p className="page-kick">Messages</p>
        <h2 className="font-heading font-bold text-xl text-[var(--ink)] mt-1">What the app tells shops and staff</h2>
        <p className="text-sm text-[var(--muted)] mt-1">
          Every message also shows in the app&apos;s bell. Here you choose which ones go out on push, WhatsApp and SMS as well.
        </p>
      </div>

      <section className="card p-5 space-y-4">
        <p className="font-heading font-bold">Channels for your business</p>
        <div className="space-y-4">
          {CHANNELS.map((ch) => {
            const note = statusNote(ch, channels[ch]);
            return (
              <div key={ch} className="space-y-1.5">
                <div className="flex items-start justify-between gap-3">
                  <Toggle checked={f.channels[ch]} onChange={(v) => set("channels", { ...f.channels, [ch]: v })} label={CHANNEL_INFO[ch].label} hint={CHANNEL_INFO[ch].hint} />
                  <span className="shrink-0 mt-0.5">
                    <StatusChip status={channels[ch]} />
                  </span>
                </div>
                {note && f.channels[ch] && (
                  <p className="ml-14 rounded-xl bg-[var(--genda-tint)] px-3 py-2 text-xs text-[var(--ink-2)] flex items-start gap-1.5">
                    <Icon name="alert" className="h-3.5 w-3.5 shrink-0 mt-0.5" />
                    <span>{note}</span>
                  </p>
                )}
              </div>
            );
          })}
        </div>
      </section>

      <section className="card p-5 space-y-4">
        <div>
          <p className="font-heading font-bold">Which message goes where</p>
          <p className="text-sm text-[var(--muted)] mt-1">
            Tap a channel to turn it on or off for that message. Each person can also turn channels off for themselves.
            {offChannels.length > 0 && ` Faded channels (${offChannels.join(", ")}) are off for your business above, so nothing goes out on them.`}
          </p>
        </div>
        <div>
          <p className="text-xs font-bold uppercase tracking-wide text-[var(--muted)]">To shops</p>
          <ul className="divide-y divide-[var(--line)]">{RETAILER_KEYS.map(eventRow)}</ul>
        </div>
        <div className="border-t border-[var(--line)] pt-4">
          <p className="text-xs font-bold uppercase tracking-wide text-[var(--muted)]">To your staff</p>
          <p className="text-xs text-[var(--muted)] mt-0.5">Staff get these in the app and by push only, so there is no WhatsApp or SMS cost.</p>
          <ul className="divide-y divide-[var(--line)]">{STAFF_KEYS.map(eventRow)}</ul>
        </div>
        <p className="text-xs text-[var(--muted)] flex items-start gap-1.5">
          <Icon name="edit" className="h-4 w-4 shrink-0" />
          <span>
            Want different words in a message?{" "}
            <Link href="/admin/engage/wording" className="font-semibold underline">
              Change the wording
            </Link>
            .
          </span>
        </p>
      </section>

      <section className="card p-5 space-y-4">
        <p className="font-heading font-bold">Payment reminders and statements</p>
        <Toggle
          checked={f.remindersOn}
          onChange={(v) => set("remindersOn", v)}
          label="Remind shops about overdue bills"
          hint="Sent at 10 am on the days below, counted from the bill's due date."
        />
        <div className={`space-y-2 ${f.remindersOn ? "" : "opacity-50"}`}>
          <span className="block text-sm font-medium text-[var(--ink-2)]">Days after the due date</span>
          <div className="flex flex-wrap gap-1.5">
            {f.days.length === 0 && <span className="text-xs text-[var(--muted)] py-1">No days added.</span>}
            {f.days.map((d) => (
              <span key={d} className="chip chip-mor !py-1">
                {d === 0 ? "On the due date" : `${d} day${d === 1 ? "" : "s"}`}
                <button
                  type="button"
                  className="opacity-80 hover:opacity-100"
                  aria-label={`Remove reminder day ${d}`}
                  disabled={!f.remindersOn}
                  onClick={() => set("days", f.days.filter((x) => x !== d))}
                >
                  <Icon name="x" className="h-3.5 w-3.5" />
                </button>
              </span>
            ))}
          </div>
          <div className="flex gap-2 max-w-xs">
            <input
              className="input"
              inputMode="numeric"
              placeholder="e.g. 30"
              aria-label="Reminder day to add"
              disabled={!f.remindersOn || f.days.length >= MAX_DAYS}
              value={day}
              onChange={(e) => {
                setDay(e.target.value.replace(/\D/g, "").slice(0, 3));
                setError(null);
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  addDay();
                }
              }}
            />
            <button type="button" className="btn btn-quiet btn-sm !min-h-[44px] shrink-0" disabled={!f.remindersOn || !day || f.days.length >= MAX_DAYS} onClick={addDay}>
              <Icon name="plus" className="h-4 w-4" /> Add
            </button>
          </div>
          <span className="block text-xs text-[var(--muted)]">0 = on the due date. 0 to 120 days, up to {MAX_DAYS} days.</span>
        </div>
        <div className="border-t border-[var(--line)] pt-4">
          <Toggle
            checked={f.monthlyStatement}
            onChange={(v) => set("monthlyStatement", v)}
            label="Send a statement on the 1st of every month"
            hint="Every shop with money to pay gets its balance and a link to its khata."
          />
        </div>
      </section>

      <div className="sticky bottom-[5.5rem] md:bottom-3 z-10">
        <div className="card p-3 flex flex-wrap items-center justify-between gap-2">
          <p className="text-sm min-w-0">
            {error ? (
              <span className="text-[#a8281e]">{error}</span>
            ) : dirty ? (
              <span className="text-[var(--ink-2)]">Unsaved message changes.</span>
            ) : savedAt ? (
              <span className="text-[var(--mint-text)] inline-flex items-center gap-1.5">
                <Icon name="check" className="h-4 w-4" />
                Saved at {savedAt.toLocaleTimeString("en-IN", { hour: "numeric", minute: "2-digit" })}
              </span>
            ) : (
              <span className="text-[var(--muted)]">Message settings saved.</span>
            )}
          </p>
          <div className="flex gap-2">
            {dirty && (
              <button
                type="button"
                className="btn btn-quiet btn-sm"
                disabled={busy}
                onClick={() => {
                  setF(saved);
                  setDay("");
                  setError(null);
                }}
              >
                Undo
              </button>
            )}
            <button type="submit" className="btn btn-kesar btn-sm" disabled={!dirty || busy}>
              {busy ? "Saving…" : dirty ? "Save message settings" : "Saved"}
            </button>
          </div>
        </div>
      </div>
    </form>
  );
}
