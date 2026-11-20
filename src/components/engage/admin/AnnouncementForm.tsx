"use client";

import { useState } from "react";
import Icon from "@/components/Icon";
import { Field, ImageField, MultiPick, Sheet, Toggle, errText, isoToLocal, localToIso, send, shortDate, type Option } from "@/components/admin/AdminKit";
import { AUDIENCE_TEXT, CHANNEL_TEXT, STAFF_ROLES, announcementState, type Announcement, type Audience } from "./announcement-types";
import { plural } from "./kit";

type Form = {
  title: string;
  body: string;
  audience: Audience;
  areaIds: string[];
  groupIds: string[];
  roles: string[];
  link: string;
  imageKey: string | null;
  pinned: boolean;
  startsAt: string;
  endsAt: string;
  channels: string[];
};

function toForm(a: Announcement | null): Form {
  return {
    title: a?.title ?? "",
    body: a?.body ?? "",
    audience: a?.audience ?? "RETAILERS",
    areaIds: a?.areaIds ?? [],
    groupIds: a?.groupIds ?? [],
    roles: a?.roles ?? [],
    link: a?.link ?? "",
    imageKey: a?.imageKey ?? null,
    pinned: a?.pinned ?? false,
    startsAt: isoToLocal(a?.startsAt),
    endsAt: isoToLocal(a?.endsAt),
    channels: a?.channels ?? ["push"],
  };
}

function toBody(f: Form): Record<string, unknown> | string {
  if (!f.title.trim()) return "Write a title";
  if (!f.body.trim()) return "Write the message";
  const link = f.link.trim();
  if (link && !link.startsWith("/")) return "Link must be a page in this app, starting with /, like /retailer/catalogue";
  if (f.startsAt && f.endsAt && localToIso(f.endsAt)! <= localToIso(f.startsAt)!) return "The end must be after the start";
  return {
    title: f.title.trim(),
    body: f.body.trim(),
    audience: f.audience,
    areaIds: f.audience === "STAFF" ? [] : f.areaIds,
    groupIds: f.audience === "STAFF" ? [] : f.groupIds,
    roles: f.audience === "RETAILERS" ? [] : f.roles,
    link: link || null,
    imageKey: f.imageKey,
    pinned: f.pinned,
    startsAt: localToIso(f.startsAt),
    endsAt: localToIso(f.endsAt),
    channels: f.channels,
  };
}

const AUDIENCES: { key: Audience; label: string; hint: string }[] = [
  { key: "RETAILERS", label: "Shops", hint: "Retailers in the app" },
  { key: "STAFF", label: "Staff", hint: "Office and field team" },
  { key: "ALL", label: "Everyone", hint: "Shops and staff" },
];

const names = (ids: string[], opts: Option[]) => ids.map((id) => opts.find((o) => o.id === id)?.label ?? "removed").join(", ");

export default function AnnouncementForm({
  announcement,
  areas,
  groups,
  onClose,
  onDone,
}: {
  announcement: Announcement | null;
  areas: Option[];
  groups: Option[];
  onClose: () => void;
  onDone: (msg: string) => void;
}) {
  const [current, setCurrent] = useState<Announcement | null>(announcement);
  const [f, setF] = useState<Form>(() => toForm(announcement));
  const [savedBody, setSavedBody] = useState<string | null>(() => (announcement ? JSON.stringify(toBody(toForm(announcement))) : null));
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [reach, setReach] = useState<{ n: number; body: string } | null>(null);
  const [confirm, setConfirm] = useState<number | null>(null);
  const [now] = useState(() => Date.now());

  const locked = !!current?.publishedAt;
  const state = current ? announcementState(current, now) : "draft";
  const set = <K extends keyof Form>(k: K, v: Form[K]) => {
    setF((x) => ({ ...x, [k]: v }));
    setError(null);
    setConfirm(null);
  };
  const toggleIn = (k: "roles" | "channels", v: string) => set(k, f[k].includes(v) ? f[k].filter((x) => x !== v) : [...f[k], v]);

  const bodyNow = toBody(f);
  const bodyKey = typeof bodyNow === "string" ? null : JSON.stringify(bodyNow);
  const dirty = !current || bodyKey !== savedBody;

  /** Save if new or changed; returns the saved announcement's id. */
  async function persist(): Promise<string | null> {
    if (typeof bodyNow === "string") {
      setError(bodyNow);
      return null;
    }
    if (current && !dirty) return current.id;
    const res = current
      ? await send<{ result: Announcement }>(`/api/admin/announcements/${current.id}`, "PATCH", bodyNow)
      : await send<{ result: Announcement }>("/api/admin/announcements", "POST", bodyNow);
    setCurrent(res.result);
    setSavedBody(bodyKey);
    return res.result.id;
  }

  async function run(label: string, fn: () => Promise<void>) {
    setBusy(label);
    setError(null);
    try {
      await fn();
    } catch (e) {
      setError(errText(e));
    } finally {
      setBusy(null);
    }
  }

  const countReach = async (id: string) => (await send<{ result: { reach: number } }>(`/api/admin/announcements/${id}`, "POST", { action: "count" })).result.reach;

  const save = () =>
    run("save", async () => {
      const id = await persist();
      if (id) onDone(current ? "Saved" : "Saved as a draft");
    });

  const count = () =>
    run("count", async () => {
      const id = await persist();
      if (!id) return;
      setReach({ n: await countReach(id), body: bodyKey ?? "" });
    });

  const askPublish = () =>
    run("publish", async () => {
      const id = await persist();
      if (!id) return;
      const n = await countReach(id);
      setReach({ n, body: bodyKey ?? "" });
      if (!n) return setError("Nobody matches this audience. Change who it is for.");
      setConfirm(n);
    });

  const publish = () =>
    run("publish", async () => {
      if (!current) return;
      const res = await send<{ result: Announcement }>(`/api/admin/announcements/${current.id}`, "POST", { action: "publish" });
      onDone(`Published “${res.result.title}” to ${plural(res.result.sentCount, "person", "people")}`);
    });

  const end = () =>
    run("end", async () => {
      if (!current || !window.confirm("Take this announcement down now? It stops showing in the app.")) return;
      await send(`/api/admin/announcements/${current.id}`, "POST", { action: "end" });
      onDone(`Ended “${current.title}”`);
    });

  const remove = () =>
    run("delete", async () => {
      if (!current || !window.confirm("Delete this draft? This can't be undone.")) return;
      await send(`/api/admin/announcements/${current.id}`, "DELETE");
      onDone("Draft deleted");
    });

  const staffNote = f.audience !== "RETAILERS" && (f.channels.includes("whatsapp") || f.channels.includes("sms"));
  const chosenChannels = f.channels.map((c) => CHANNEL_TEXT[c] ?? c);

  return (
    <Sheet
      title={current ? (locked ? "Sent announcement" : "Edit draft") : "New announcement"}
      onClose={onClose}
      wide
      footer={
        confirm !== null ? (
          <div className="space-y-2">
            <p className="text-sm">
              Send <b>“{f.title.trim()}”</b> to <b>{plural(confirm, "person", "people")}</b> now
              {chosenChannels.length ? ` in the app and on ${chosenChannels.join(", ")}` : " in the app only"}? It goes out once and can&apos;t be called back.
            </p>
            {error && <p className="text-sm text-[#a8281e]">{error}</p>}
            <div className="flex flex-wrap justify-end gap-2">
              <button type="button" className="btn btn-quiet btn-sm" disabled={!!busy} onClick={() => setConfirm(null)}>
                Not yet
              </button>
              <button type="button" className="btn btn-kesar btn-sm" disabled={!!busy} onClick={publish}>
                <Icon name="megaphone" className="h-4 w-4" /> {busy === "publish" ? "Sending…" : "Yes, publish"}
              </button>
            </div>
          </div>
        ) : (
          <div className="space-y-2">
            {error && <p className="text-sm text-[#a8281e]">{error}</p>}
            <div className="flex flex-wrap items-center gap-2">
              {current && !locked && (
                <button type="button" className="btn btn-quiet btn-sm text-[#a8281e]" disabled={!!busy} onClick={remove}>
                  <Icon name="trash" className="h-4 w-4" /> {busy === "delete" ? "Deleting…" : "Delete draft"}
                </button>
              )}
              {locked && state !== "ended" && (
                <button type="button" className="btn btn-quiet btn-sm text-[#a8281e]" disabled={!!busy} onClick={end}>
                  {busy === "end" ? "Ending…" : "End now"}
                </button>
              )}
              <div className="flex flex-wrap gap-2 ml-auto">
                <button type="button" className={`btn btn-sm ${locked ? "btn-kesar" : "btn-outline"}`} disabled={!!busy || (!!current && !dirty)} onClick={save}>
                  {busy === "save" ? "Saving…" : locked ? "Save changes" : "Save draft"}
                </button>
                {!locked && (
                  <button type="button" className="btn btn-kesar btn-sm" disabled={!!busy} onClick={askPublish}>
                    <Icon name="megaphone" className="h-4 w-4" /> {busy === "publish" ? "Checking…" : "Publish…"}
                  </button>
                )}
              </div>
            </div>
          </div>
        )
      }
    >
      {locked && current && (
        <div className="rounded-2xl bg-[var(--mint-tint)] p-4 text-sm text-[var(--mint-text)] space-y-1">
          <p className="font-bold">
            <Icon name="check" className="inline h-4 w-4 mr-1 -mt-0.5" />
            Sent {shortDate(current.publishedAt, true)} to {plural(current.sentCount, "person", "people")}
          </p>
          <p>Who gets it and the channels are fixed now. You can still change the text, link, picture, pin and dates; people see the new text in the app.</p>
        </div>
      )}

      <div className="grid gap-3">
        <Field label="Title" hint={`${f.title.length} / 80`}>
          <input className="input" value={f.title} maxLength={80} placeholder="e.g. Shop closed on Sunday for the festival" onChange={(e) => set("title", e.target.value)} />
        </Field>
        <Field label="Message" hint={`${f.body.length} / 600`}>
          <textarea className="input min-h-[110px]" value={f.body} maxLength={600} onChange={(e) => set("body", e.target.value)} />
        </Field>
      </div>

      <section className="card p-4 space-y-3">
        <div className="flex items-center justify-between gap-2">
          <p className="font-heading font-bold">Who gets it</p>
          {locked && <span className="chip !py-0.5 !px-2 !text-[11.5px]">Locked after sending</span>}
        </div>
        {locked ? (
          <div className="text-sm text-[var(--ink-2)] space-y-1">
            <p>
              <b>{AUDIENCE_TEXT[f.audience]}</b>
            </p>
            {f.audience !== "STAFF" && (
              <p>
                Shops:{" "}
                {f.areaIds.length || f.groupIds.length
                  ? [f.areaIds.length ? `in ${names(f.areaIds, areas)}` : "", f.groupIds.length ? `group ${names(f.groupIds, groups)}` : ""].filter(Boolean).join("; ")
                  : "every shop"}
              </p>
            )}
            {f.audience !== "RETAILERS" && (
              <p>Staff: {f.roles.length ? f.roles.map((r) => STAFF_ROLES.find((x) => x.key === r)?.label ?? r).join(", ") : "everyone on the team"}</p>
            )}
          </div>
        ) : (
          <>
            <div className="grid grid-cols-3 gap-2" role="radiogroup" aria-label="Audience">
              {AUDIENCES.map((a) => {
                const on = f.audience === a.key;
                return (
                  <button
                    key={a.key}
                    type="button"
                    role="radio"
                    aria-checked={on}
                    onClick={() => set("audience", a.key)}
                    className={`rounded-xl p-2.5 sm:p-3 text-left transition border min-w-0 ${
                      on ? "bg-gradient-to-br from-mor to-[#0c3634] text-white border-transparent" : "bg-white/70 border-[var(--line)]"
                    }`}
                  >
                    <span className="block text-sm font-bold">{a.label}</span>
                    <span className={`block text-[11.5px] ${on ? "text-white/75" : "text-[var(--muted)]"}`}>{a.hint}</span>
                  </button>
                );
              })}
            </div>
            {f.audience !== "STAFF" && (
              <div className="space-y-3">
                <p className="text-xs text-[var(--muted)]">Leave areas and groups empty for every shop. Otherwise shops in any of them get it.</p>
                <Field label="Areas">
                  <MultiPick options={areas} value={f.areaIds} onChange={(v) => set("areaIds", v)} placeholder="Search areas" emptyText="All areas" />
                </Field>
                <Field label="Shop groups">
                  <MultiPick options={groups} value={f.groupIds} onChange={(v) => set("groupIds", v)} placeholder="Search groups" emptyText="All groups" />
                </Field>
              </div>
            )}
            {f.audience !== "RETAILERS" && (
              <div className="space-y-2">
                <p className="text-sm font-medium text-[var(--ink-2)]">Staff roles</p>
                <div className="flex flex-wrap gap-2">
                  {STAFF_ROLES.map((r) => {
                    const on = f.roles.includes(r.key);
                    return (
                      <button
                        key={r.key}
                        type="button"
                        aria-pressed={on}
                        onClick={() => toggleIn("roles", r.key)}
                        className={`rounded-full border px-3 py-1.5 text-sm font-medium ${on ? "border-[var(--mor)] bg-[var(--mor)] text-white" : "border-foreground/15 bg-white/60"}`}
                      >
                        {on && <Icon name="check" className="inline h-3.5 w-3.5 mr-1 -mt-0.5" />}
                        {r.label}
                      </button>
                    );
                  })}
                </div>
                <p className="text-xs text-[var(--muted)]">None picked = everyone on the team.</p>
              </div>
            )}
          </>
        )}
        <div className="flex flex-wrap items-center gap-2 border-t border-[var(--line)] pt-3">
          <button type="button" className="btn btn-quiet btn-xs" disabled={!!busy} onClick={count}>
            <Icon name="users" className="h-3.5 w-3.5" /> {busy === "count" ? "Counting…" : "How many will get it?"}
          </button>
          {reach && reach.body === bodyKey ? (
            <span className="text-sm">
              <b>{plural(reach.n, "person", "people")}</b>
              <span className="text-[var(--muted)]"> {locked ? "match it now" : "right now"}</span>
            </span>
          ) : (
            <span className="text-xs text-[var(--muted)]">{current ? (dirty ? "Saves your changes first." : "") : "Saves it as a draft first."}</span>
          )}
        </div>
      </section>

      <section className="card p-4 space-y-3">
        <div className="flex items-center justify-between gap-2">
          <p className="font-heading font-bold">Send it on</p>
          {locked && <span className="chip !py-0.5 !px-2 !text-[11.5px]">Locked after sending</span>}
        </div>
        <p className="text-xs text-[var(--muted)]">Everyone sees it in the app. These send it once more when you publish, only on channels switched on in Settings.</p>
        <div className="flex flex-wrap gap-2">
          {(["push", "whatsapp", "sms"] as const).map((c) => {
            const on = f.channels.includes(c);
            return (
              <button
                key={c}
                type="button"
                disabled={locked}
                aria-pressed={on}
                onClick={() => toggleIn("channels", c)}
                className={`rounded-full border px-3 py-1.5 text-sm font-medium disabled:opacity-60 ${on ? "border-[var(--mor)] bg-[var(--mor)] text-white" : "border-foreground/15 bg-white/60"}`}
              >
                {on && <Icon name="check" className="inline h-3.5 w-3.5 mr-1 -mt-0.5" />}
                {CHANNEL_TEXT[c]}
              </button>
            );
          })}
        </div>
        {f.audience !== "RETAILERS" && (
          <p className={`text-xs ${staffNote ? "font-semibold text-[var(--genda-text)]" : "text-[var(--muted)]"}`}>Staff get push only, never WhatsApp or SMS.</p>
        )}
        {f.channels.includes("sms") && f.audience !== "STAFF" && <p className="text-xs text-[var(--muted)]">SMS costs money per message and shops who muted offers get it in the app only.</p>}
      </section>

      <section className="card p-4 space-y-3">
        <p className="font-heading font-bold">Details</p>
        <Field label="Link (optional)" hint="A page in this app the card opens, like /retailer/catalogue">
          <input className="input font-mono" value={f.link} maxLength={200} placeholder="/retailer/catalogue" onChange={(e) => set("link", e.target.value.trim())} />
        </Field>
        <div>
          <p className="text-sm font-medium text-[var(--ink-2)] mb-1">Picture (optional)</p>
          <ImageField value={f.imageKey} onChange={(v) => set("imageKey", v)} kind="announcement" wide />
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Shows from" hint="Blank = from now">
            <input className="input" type="datetime-local" value={f.startsAt} onChange={(e) => set("startsAt", e.target.value)} />
          </Field>
          <Field label="Until" hint="Blank = until you end it">
            <input className="input" type="datetime-local" value={f.endsAt} onChange={(e) => set("endsAt", e.target.value)} />
          </Field>
        </div>
        {!locked && <p className="text-xs text-[var(--muted)]">Push, WhatsApp and SMS go out the moment you publish, even if it shows in the app later.</p>}
        <Toggle checked={f.pinned} onChange={(v) => set("pinned", v)} label="Pin to the top" hint="Pinned ones show first on the home screen." />
      </section>
    </Sheet>
  );
}
