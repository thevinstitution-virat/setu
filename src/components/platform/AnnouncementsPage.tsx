"use client";

import { useMemo, useState } from "react";
import Icon from "@/components/Icon";
import { ErrorBox, Field, Flash, MultiPick, errText, send, useFetch } from "@/components/admin/AdminKit";
import { ConfirmButton, ErrLine, StatusChip, isoToIst, istToIso, when } from "./kit";

type Announcement = {
  id: string;
  title: string;
  body: string;
  level: "info" | "warning";
  audience: "ADMINS" | "STAFF";
  tenantIds: string[];
  startsAt: string;
  endsAt: string | null;
  createdAt: string;
  createdBy: { name: string } | null;
};

type Form = { title: string; body: string; level: "info" | "warning"; audience: "ADMINS" | "STAFF"; tenantIds: string[]; startsAt: string; endsAt: string };

const empty: Form = { title: "", body: "", level: "info", audience: "ADMINS", tenantIds: [], startsAt: "", endsAt: "" };

function stateOf(a: Announcement) {
  const now = Date.now();
  if (a.endsAt && new Date(a.endsAt).getTime() <= now) return { label: "Ended", tone: undefined, live: false };
  if (new Date(a.startsAt).getTime() > now) return { label: "Scheduled", tone: "genda" as const, live: true };
  return { label: "Showing", tone: "mint" as const, live: true };
}

/** Prefill the form from an announcement; past start / end times are left blank. */
function formFrom(a: Announcement, asCopy: boolean): Form {
  const now = Date.now();
  return {
    title: a.title,
    body: a.body,
    level: a.level,
    audience: a.audience,
    tenantIds: a.tenantIds,
    startsAt: asCopy || new Date(a.startsAt).getTime() <= now ? "" : isoToIst(a.startsAt),
    endsAt: a.endsAt && new Date(a.endsAt).getTime() > now ? isoToIst(a.endsAt) : "",
  };
}

export default function AnnouncementsPage() {
  const { data, error, reload } = useFetch<{ announcements: Announcement[] }>("/api/platform/announcements");
  const tenants = useFetch<{ tenants: { id: string; name: string; slug: string }[] }>("/api/platform/tenants?take=500");
  const options = useMemo(() => (tenants.data?.tenants ?? []).map((t) => ({ id: t.id, label: t.name, sub: t.slug })), [tenants.data]);
  const names = useMemo(() => new Map(options.map((o) => [o.id, o.label])), [options]);

  const [form, setForm] = useState<Form>(empty);
  const [replacing, setReplacing] = useState<Announcement | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error2, setError2] = useState<string | null>(null);
  const [rowError, setRowError] = useState<{ id: string; text: string } | null>(null);
  const [flash, setFlash] = useState<string | null>(null);
  const set = <K extends keyof Form>(k: K, v: Form[K]) => setForm((f) => ({ ...f, [k]: v }));

  function edit(a: Announcement, asCopy: boolean) {
    setForm(formFrom(a, asCopy));
    setReplacing(asCopy ? null : a);
    setError2(null);
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setBusy("save");
    setError2(null);
    setFlash(null);
    try {
      await send("/api/platform/announcements", "POST", {
        title: form.title.trim(),
        body: form.body.trim(),
        level: form.level,
        audience: form.audience,
        tenantIds: form.tenantIds,
        startsAt: istToIso(form.startsAt) ?? undefined,
        endsAt: istToIso(form.endsAt) ?? undefined,
      });
      if (replacing && stateOf(replacing).live) await send(`/api/platform/announcements/${replacing.id}`, "DELETE");
      setFlash(replacing ? "Saved. The old version was ended." : "Announcement saved");
      setForm(empty);
      setReplacing(null);
      reload();
    } catch (err) {
      setError2(errText(err));
    } finally {
      setBusy(null);
    }
  }

  async function end(a: Announcement) {
    setBusy(a.id);
    setRowError(null);
    try {
      await send(`/api/platform/announcements/${a.id}`, "DELETE");
      reload();
    } catch (err) {
      setRowError({ id: a.id, text: errText(err) });
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="space-y-5 pb-16">
      <div>
        <p className="page-kick">Platform</p>
        <h1 className="page-title">Announcements</h1>
        <p className="page-sub">A banner in the office app of businesses: maintenance, new features, billing notices.</p>
      </div>

      <div className="grid gap-5 xl:grid-cols-2 items-start">
      <form onSubmit={save} className="card p-4 sm:p-5 space-y-4 xl:sticky xl:top-20">
        <p className="font-heading font-bold">{replacing ? `Edit “${replacing.title}”` : "New announcement"}</p>
        {replacing && <p className="text-sm text-[var(--muted)]">Saving publishes this as a new announcement and ends the old one, so the record keeps both.</p>}
        <Field label="Title" hint="3–100 characters">
          <input className="input" value={form.title} maxLength={100} onChange={(e) => set("title", e.target.value)} />
        </Field>
        <Field label="Message" hint={`${form.body.length} / 1000`}>
          <textarea className="input min-h-24" value={form.body} maxLength={1000} onChange={(e) => set("body", e.target.value)} />
        </Field>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Kind">
            <select className="input" value={form.level} onChange={(e) => set("level", e.target.value as Form["level"])}>
              <option value="info">Info</option>
              <option value="warning">Warning</option>
            </select>
          </Field>
          <Field label="Who sees it">
            <select className="input" value={form.audience} onChange={(e) => set("audience", e.target.value as Form["audience"])}>
              <option value="ADMINS">Office (admins)</option>
              <option value="STAFF">Every staff login</option>
            </select>
          </Field>
          <Field label="Starts (India time)" hint="Blank = now">
            <input className="input" type="datetime-local" value={form.startsAt} onChange={(e) => set("startsAt", e.target.value)} />
          </Field>
          <Field label="Ends (India time)" hint="Blank = until you end it">
            <input className="input" type="datetime-local" value={form.endsAt} onChange={(e) => set("endsAt", e.target.value)} />
          </Field>
        </div>
        <div className="space-y-1">
          <span className="block text-sm font-medium text-[var(--ink-2)]">Only these businesses</span>
          <MultiPick options={options} value={form.tenantIds} onChange={(ids) => set("tenantIds", ids)} placeholder="Search businesses" emptyText="Everyone" />
          {tenants.error && <ErrLine text={`Businesses did not load: ${tenants.error}`} />}
        </div>
        <ErrLine text={error2} />
        <div className="flex flex-wrap gap-2">
          <button type="submit" className="btn btn-primary btn-sm" disabled={!!busy || form.title.trim().length < 3 || form.body.trim().length < 3}>
            {busy === "save" ? "Saving…" : replacing ? "Save changes" : "Publish"}
          </button>
          {(replacing || form !== empty) && (
            <button
              type="button"
              className="btn btn-quiet btn-sm"
              disabled={!!busy}
              onClick={() => {
                setForm(empty);
                setReplacing(null);
                setError2(null);
              }}
            >
              Clear
            </button>
          )}
        </div>
        <Flash text={flash} />
      </form>

      <div className="space-y-3 min-w-0">
      <p className="font-heading font-bold">Sent so far</p>
      {error && <ErrorBox message={error} onRetry={reload} />}
      {!data && !error && <p className="text-sm text-[var(--muted)]">Loading…</p>}
      {data && (
        <div className="space-y-3">
          {data.announcements.length === 0 && <p className="text-sm text-[var(--muted)]">No announcements yet.</p>}
          {data.announcements.map((a) => {
            const st = stateOf(a);
            return (
              <div key={a.id} className={`card p-4 space-y-2 ${st.live ? "" : "opacity-75"}`}>
                <div className="flex flex-wrap items-start gap-2">
                  <p className="font-semibold flex-1 min-w-0 break-words flex items-center gap-2">
                    {a.level === "warning" && <Icon name="alert" className="h-4 w-4 shrink-0 text-[var(--genda-text)]" />}
                    {a.title}
                  </p>
                  <StatusChip value={a.level} />
                  <StatusChip value="x" label={st.label} tone={st.tone} />
                </div>
                <p className="text-sm text-[var(--ink-2)] whitespace-pre-line break-words">{a.body}</p>
                <p className="text-xs text-[var(--muted)]">
                  {a.audience === "STAFF" ? "Every staff login" : "Office"} ·{" "}
                  {a.tenantIds.length ? a.tenantIds.map((id) => names.get(id) ?? id).join(", ") : "all businesses"} · {when(a.startsAt, true)}
                  {a.endsAt ? ` to ${when(a.endsAt, true)}` : " onwards"}
                  {a.createdBy && ` · by ${a.createdBy.name}`}
                </p>
                <div className="flex flex-wrap gap-2">
                  {st.live && (
                    <button type="button" className="btn btn-quiet btn-xs" disabled={!!busy} onClick={() => edit(a, false)}>
                      <Icon name="edit" className="h-3.5 w-3.5" /> Edit
                    </button>
                  )}
                  <button type="button" className="btn btn-quiet btn-xs" disabled={!!busy} onClick={() => edit(a, true)}>
                    <Icon name="clipboard" className="h-3.5 w-3.5" /> Copy to new
                  </button>
                  {st.live && <ConfirmButton label="End now" question="End this announcement now?" yes="Yes, end it" busy={busy === a.id} disabled={!!busy && busy !== a.id} onConfirm={() => end(a)} />}
                </div>
                {rowError?.id === a.id && <ErrLine text={rowError.text} />}
              </div>
            );
          })}
        </div>
      )}
      </div>
      </div>
    </div>
  );
}
