"use client";

import { useRef, useState } from "react";
import Icon from "@/components/Icon";
import { checkTemplate, isEventKey, placeholders } from "@/lib/notify-events";
import { ErrorBox, Field, Flash, Sheet, TabBar, api, errText, send, useFetch } from "@/components/admin/AdminKit";
import { EngageNav, Pills } from "@/components/engage/admin/kit";

type Lang = "en" | "hi";
type Wording = { title: string; body: string };
type Own = Wording & { waTemplate: string | null; dltId: string | null; params: string[] };
type Item = {
  event: string;
  label: string;
  audience: "retailer" | "staff";
  topic: string | null;
  vars: string[];
  defaults: Record<Lang, Wording>;
  own: Partial<Record<Lang, Own>>;
  defaultChannels: string[];
  on: Record<"push" | "whatsapp" | "sms", boolean>;
};

const FIXED = new Set(["announcement", "staff.announcement"]);
const LANGS = [
  { key: "en", label: "English" },
  { key: "hi", label: "हिन्दी (Hindi)" },
] as const;
const CHANNEL_TEXT = { push: "Push", whatsapp: "WhatsApp", sms: "SMS" } as const;

const FILTERS = [
  { key: "retailer", label: "To shops" },
  { key: "staff", label: "To staff" },
  { key: "own", label: "Changed by you" },
] as const;
type Filter = (typeof FILTERS)[number]["key"];

export default function WordingPage() {
  const { data, error, reload } = useFetch<{ items: Item[] }>("/api/admin/templates");
  const [filter, setFilter] = useState<Filter>("retailer");
  const [open, setOpen] = useState<string | null>(null);
  const [flash, setFlash] = useState<string | null>(null);

  const items = data?.items ?? [];
  const match = (i: Item, f: Filter) => (f === "own" ? Object.keys(i.own).length > 0 : i.audience === f);
  const pills = FILTERS.map((f) => ({ ...f, count: data ? items.filter((i) => match(i, f.key)).length : null }));
  const shown = items.filter((i) => match(i, filter));
  const current = open ? (items.find((i) => i.event === open) ?? null) : null;

  return (
    <div className="space-y-5 pb-16">
      <div className="page-head">
        <div className="min-w-0">
          <p className="page-kick">Engage</p>
          <h1 className="page-title">Message wording</h1>
          <p className="page-sub">What each message says, in English and Hindi. Use your own words or keep the built-in ones.</p>
        </div>
      </div>
      <EngageNav />

      <Pills items={pills} value={filter} onChange={setFilter} label="Show" />
      <Flash text={flash} />
      {error && <ErrorBox message={error} onRetry={reload} />}
      {!data && !error && <p className="text-sm text-[var(--muted)]">Loading…</p>}

      {data && (
        <ul className="card divide-y divide-[var(--line)] overflow-hidden">
          {shown.map((i) => {
            const fixed = FIXED.has(i.event);
            const langs = (Object.keys(i.own) as Lang[]).map((l) => (l === "en" ? "English" : "Hindi"));
            const channels = (Object.keys(CHANNEL_TEXT) as (keyof typeof CHANNEL_TEXT)[]).filter((c) => i.on[c]);
            return (
              <li key={i.event}>
                <button
                  type="button"
                  disabled={fixed}
                  onClick={() => {
                    setFlash(null);
                    setOpen(i.event);
                  }}
                  className="w-full px-4 py-3 text-left hover:bg-white/70 disabled:hover:bg-transparent flex items-start gap-3 min-w-0"
                >
                  <div className="min-w-0 flex-1 space-y-0.5">
                    <div className="flex flex-wrap items-center gap-1.5">
                      <p className="font-bold">{i.label}</p>
                      {langs.length > 0 && <span className="chip chip-mor !py-0.5 !px-2 !text-[11.5px]">Your wording: {langs.join(", ")}</span>}
                      {i.topic && <span className="chip !py-0.5 !px-2 !text-[11.5px]">{i.topic === "promo" ? "Offers (can be muted)" : "Reminders (can be muted)"}</span>}
                    </div>
                    <p className="text-sm text-[var(--ink-2)] break-words line-clamp-2">{i.own.en?.body ?? i.defaults.en.body}</p>
                    <p className="text-xs text-[var(--muted)]">
                      {fixed ? "Written each time you send an announcement." : `In the app${channels.length ? ` + ${channels.map((c) => CHANNEL_TEXT[c]).join(", ")}` : ""}`}
                    </p>
                  </div>
                  {!fixed && <Icon name="edit" className="h-4 w-4 text-[var(--muted)] shrink-0 mt-1" />}
                </button>
              </li>
            );
          })}
          {shown.length === 0 && <li className="px-4 py-5 text-sm text-[var(--muted)]">{filter === "own" ? "You have not changed any wording yet." : "Nothing here."}</li>}
        </ul>
      )}
      <p className="text-xs text-[var(--muted)]">Which channels each message goes on is set in Settings. Staff messages go in the app and on push only.</p>

      {current && (
        <WordingSheet
          key={current.event}
          item={current}
          onClose={() => setOpen(null)}
          onSaved={(msg) => {
            setFlash(msg);
            reload();
          }}
        />
      )}
    </div>
  );
}

type Draft = { title: string; body: string; waTemplate: string; dltId: string };
const toDraft = (i: Item, l: Lang): Draft => {
  const o = i.own[l];
  return { title: o?.title ?? i.defaults[l].title, body: o?.body ?? i.defaults[l].body, waTemplate: o?.waTemplate ?? "", dltId: o?.dltId ?? "" };
};

function WordingSheet({ item, onClose, onSaved }: { item: Item; onClose: () => void; onSaved: (msg: string) => void }) {
  const [lang, setLang] = useState<Lang>("en");
  const [drafts, setDrafts] = useState<Record<Lang, Draft>>(() => ({ en: toDraft(item, "en"), hi: toDraft(item, "hi") }));
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const bodyRef = useRef<HTMLTextAreaElement>(null);
  const d = drafts[lang];
  const own = item.own[lang];
  const def = item.defaults[lang];
  const retailer = item.audience === "retailer";
  const set = (patch: Partial<Draft>) => {
    setDrafts((x) => ({ ...x, [lang]: { ...x[lang], ...patch } }));
    setError(null);
  };

  const check = isEventKey(item.event) ? checkTemplate(item.event, d.title, d.body) : null;
  const saved = toDraft(item, lang);
  const dirty = d.title !== saved.title || d.body !== saved.body || d.waTemplate !== saved.waTemplate || d.dltId !== saved.dltId;
  const params = placeholders(d.body);
  const langName = lang === "en" ? "English" : "Hindi";

  function insert(v: string) {
    const el = bodyRef.current;
    const token = `{${v}}`;
    if (!el) return set({ body: d.body + token });
    const start = el.selectionStart ?? d.body.length;
    const end = el.selectionEnd ?? d.body.length;
    set({ body: d.body.slice(0, start) + token + d.body.slice(end) });
    requestAnimationFrame(() => {
      el.focus();
      el.setSelectionRange(start + token.length, start + token.length);
    });
  }

  async function save() {
    if (check) return setError(check);
    setBusy("save");
    setError(null);
    try {
      await api("/api/admin/templates", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ event: item.event, lang, title: d.title, body: d.body, waTemplate: d.waTemplate, dltId: d.dltId }),
      });
      onSaved(`Saved your ${langName} wording for “${item.label}”`);
    } catch (e) {
      setError(errText(e));
    } finally {
      setBusy(null);
    }
  }

  async function reset() {
    if (!window.confirm(`Go back to the built-in ${langName} wording for “${item.label}”? Your own wording will be removed.`)) return;
    setBusy("reset");
    setError(null);
    try {
      await send("/api/admin/templates", "DELETE", { event: item.event, lang });
      setDrafts((x) => ({ ...x, [lang]: { title: def.title, body: def.body, waTemplate: "", dltId: "" } }));
      onSaved(`“${item.label}” is back to the built-in ${langName} wording`);
    } catch (e) {
      setError(errText(e));
    } finally {
      setBusy(null);
    }
  }

  return (
    <Sheet
      title={item.label}
      onClose={onClose}
      wide
      footer={
        <div className="space-y-2">
          {(error || (dirty && check)) && <p className="text-sm text-[#a8281e]">{error ?? check}</p>}
          <div className="flex flex-wrap items-center gap-2">
            {own && (
              <button type="button" className="btn btn-quiet btn-sm" disabled={!!busy} onClick={reset}>
                {busy === "reset" ? "Resetting…" : "Reset to built-in"}
              </button>
            )}
            <div className="flex gap-2 ml-auto">
              <button type="button" className="btn btn-quiet btn-sm" disabled={!!busy} onClick={onClose}>
                Close
              </button>
              <button type="button" className="btn btn-kesar btn-sm" disabled={!!busy || !dirty} onClick={save}>
                {busy === "save" ? "Saving…" : `Save ${langName}`}
              </button>
            </div>
          </div>
        </div>
      }
    >
      <TabBar tabs={LANGS} value={lang} onChange={(l) => { setLang(l); setError(null); }} />

      <div className="flex flex-wrap items-center gap-2 text-xs">
        <span className={`chip !py-0.5 !px-2 !text-[11.5px] ${own ? "chip-mor" : ""}`}>{own ? "Your wording" : "Built-in wording"}</span>
        <span className="text-[var(--muted)]">Sent to {retailer ? "shops" : "staff"}. People get the language they picked in the app.</span>
      </div>

      <div className="rounded-2xl bg-ink/5 p-4 text-sm space-y-1">
        <p className="text-xs font-bold uppercase tracking-wider text-[var(--muted)]">Built-in {langName}</p>
        <p className="font-bold break-words">{def.title}</p>
        <p className="text-[var(--ink-2)] break-words">{def.body}</p>
        {own && (
          <button type="button" className="btn btn-quiet btn-xs mt-1" onClick={() => set({ title: def.title, body: def.body })}>
            Copy into the boxes below
          </button>
        )}
      </div>

      <div className="space-y-2">
        <p className="text-sm font-medium text-[var(--ink-2)]">Placeholders (tap to add to the message)</p>
        <div className="flex flex-wrap gap-1.5">
          {item.vars.map((v) => (
            <button key={v} type="button" className="chip chip-genda !py-1 font-mono" onClick={() => insert(v)}>
              {`{${v}}`}
            </button>
          ))}
        </div>
        <p className="text-xs text-[var(--muted)]">Each is filled in when the message goes out. Only these can be used here.</p>
      </div>

      <Field label="Title" hint={`${d.title.length} / 120 · shown on push and in the bell`}>
        <input className="input" value={d.title} maxLength={120} lang={lang} onChange={(e) => set({ title: e.target.value })} />
      </Field>
      <Field label="Message" hint={`${d.body.length} / 900`}>
        <textarea ref={bodyRef} className="input min-h-[120px]" value={d.body} maxLength={900} lang={lang} onChange={(e) => set({ body: e.target.value })} />
      </Field>

      {retailer ? (
        <section className="card p-4 space-y-3">
          <div>
            <p className="font-heading font-bold">WhatsApp and SMS</p>
            <p className="text-xs text-[var(--muted)]">Only needed once these channels are set up. Each wording must be approved by the provider first.</p>
          </div>
          <Field
            label="WhatsApp template name"
            hint={
              <>
                Small letters, digits and _ only, exactly as approved.
                {params.length > 0 && (
                  <>
                    {" "}
                    The template&apos;s values, in order: {params.map((p, n) => `{{${n + 1}}} = ${p}`).join(", ")}.
                  </>
                )}
              </>
            }
          >
            <input
              className="input font-mono"
              value={d.waTemplate}
              maxLength={100}
              placeholder="e.g. order_placed_en"
              onChange={(e) => set({ waTemplate: e.target.value.toLowerCase().replace(/\s/g, "_") })}
            />
          </Field>
          <Field label="SMS DLT template id" hint="In India every SMS wording is registered on DLT; paste its 10 to 25 digit id.">
            <input className="input font-mono" inputMode="numeric" value={d.dltId} maxLength={25} onChange={(e) => set({ dltId: e.target.value.replace(/\D/g, "") })} />
          </Field>
        </section>
      ) : (
        <p className="text-xs text-[var(--muted)]">Staff get this in the app and on push only, so there is no WhatsApp or SMS setup.</p>
      )}
    </Sheet>
  );
}
