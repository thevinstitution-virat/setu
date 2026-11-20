"use client";

import { useMemo, useState } from "react";
import Icon from "@/components/Icon";
import { ErrorBox, Flash, Thumb, shortDate, useFetch } from "@/components/admin/AdminKit";
import { EngageNav, Pills, plural, useNow } from "@/components/engage/admin/kit";
import AnnouncementForm from "@/components/engage/admin/AnnouncementForm";
import { AUDIENCE_TEXT, CHANNEL_TEXT, STAFF_ROLES, announcementState, type AnnState, type Announcement } from "@/components/engage/admin/announcement-types";

type Data = { items: Announcement[]; areas: { id: string; name: string; region?: { name: string } | null }[]; groups: { id: string; name: string }[] };

const STATE: Record<AnnState, { label: string; chip: string }> = {
  draft: { label: "Draft", chip: "chip-genda" },
  scheduled: { label: "Scheduled", chip: "chip-mor" },
  live: { label: "Live", chip: "chip-mint" },
  ended: { label: "Ended", chip: "" },
};

const FILTERS = [
  { key: "all", label: "All" },
  { key: "live", label: "Live" },
  { key: "scheduled", label: "Scheduled" },
  { key: "draft", label: "Drafts" },
  { key: "ended", label: "Ended" },
] as const;
type Filter = (typeof FILTERS)[number]["key"];

export default function AnnouncementsPage() {
  const { data, error, reload } = useFetch<Data>("/api/admin/announcements");
  const now = useNow();
  const [filter, setFilter] = useState<Filter>("all");
  const [editing, setEditing] = useState<Announcement | "new" | null>(null);
  const [flash, setFlash] = useState<string | null>(null);

  const areas = useMemo(() => (data?.areas ?? []).map((a) => ({ id: a.id, label: a.region?.name ? `${a.name} (${a.region.name})` : a.name })), [data]);
  const groups = useMemo(() => (data?.groups ?? []).map((g) => ({ id: g.id, label: g.name })), [data]);
  const items = data?.items ?? [];
  const withState = items.map((a) => ({ a, state: announcementState(a, now) }));
  const shown = withState.filter((x) => filter === "all" || x.state === filter);
  const counts = FILTERS.map((f) => ({ ...f, count: data ? withState.filter((x) => f.key === "all" || x.state === f.key).length : null }));

  function audienceText(a: Announcement) {
    const parts: string[] = [];
    if (a.audience !== "STAFF") {
      const where = [
        a.areaIds.length ? a.areaIds.map((id) => areas.find((x) => x.id === id)?.label ?? "removed area").join(", ") : "",
        a.groupIds.length ? `group ${a.groupIds.map((id) => groups.find((x) => x.id === id)?.label ?? "removed").join(", ")}` : "",
      ].filter(Boolean);
      parts.push(where.length ? `Shops in ${where.join("; ")}` : "All shops");
    }
    if (a.audience !== "RETAILERS") {
      parts.push(a.roles.length ? a.roles.map((r) => STAFF_ROLES.find((x) => x.key === r)?.label ?? r).join(", ") : "All staff");
    }
    return parts.join(" + ") || AUDIENCE_TEXT[a.audience];
  }

  return (
    <div className="space-y-5 pb-16">
      <div className="page-head">
        <div className="min-w-0">
          <p className="page-kick">Engage</p>
          <h1 className="page-title">Announcements</h1>
          <p className="page-sub">Notices on the home screen of shops or staff, sent once on push, WhatsApp or SMS when you publish.</p>
        </div>
        <button
          type="button"
          className="btn btn-kesar btn-sm"
          onClick={() => {
            setFlash(null);
            setEditing("new");
          }}
        >
          <Icon name="plus" className="h-4 w-4" /> New announcement
        </button>
      </div>
      <EngageNav />

      <Pills items={counts} value={filter} onChange={setFilter} label="Show" />
      <Flash text={flash} />
      {error && <ErrorBox message={error} onRetry={reload} />}
      {!data && !error && <p className="text-sm text-[var(--muted)]">Loading…</p>}

      {data && (
        <div className="space-y-2">
          {shown.map(({ a, state }) => (
            <button key={a.id} type="button" onClick={() => setEditing(a)} className="card p-4 w-full text-left hover:bg-white/80 flex gap-3 min-w-0">
              {a.imageKey && <Thumb imageKey={a.imageKey} className="h-14 w-14 sm:h-16 sm:w-24" />}
              <div className="min-w-0 flex-1 space-y-1">
                <div className="flex flex-wrap items-center gap-1.5">
                  <p className="font-bold break-words">{a.title}</p>
                  <span className={`chip !py-0.5 !px-2 !text-[11.5px] ${STATE[state].chip}`}>{STATE[state].label}</span>
                  {a.pinned && <span className="chip !py-0.5 !px-2 !text-[11.5px]">Pinned</span>}
                </div>
                <p className="text-sm text-[var(--ink-2)] line-clamp-2 break-words">{a.body}</p>
                <div className="flex flex-wrap gap-x-4 gap-y-0.5 text-xs text-[var(--muted)]">
                  <span>{audienceText(a)}</span>
                  <span>In the app{a.channels.length ? ` + ${a.channels.map((c) => CHANNEL_TEXT[c] ?? c).join(", ")}` : ""}</span>
                  <span>
                    {shortDate(a.startsAt, true)} → {a.endsAt ? shortDate(a.endsAt, true) : "no end"}
                  </span>
                  {a.publishedAt ? (
                    <span className="text-[var(--mint-text)] font-semibold">Sent to {plural(a.sentCount, "person", "people")}</span>
                  ) : (
                    <span>Not sent yet{a.createdBy ? ` · by ${a.createdBy.name}` : ""}</span>
                  )}
                </div>
              </div>
              <Icon name="edit" className="h-4 w-4 text-[var(--muted)] shrink-0 mt-1" />
            </button>
          ))}
          {shown.length === 0 && (
            <p className="card p-5 text-sm text-[var(--muted)]">{items.length ? "Nothing in this list." : "No announcements yet. Press “New announcement” to write one."}</p>
          )}
        </div>
      )}

      {editing && (
        <AnnouncementForm
          announcement={editing === "new" ? null : editing}
          areas={areas}
          groups={groups}
          onClose={() => {
            setEditing(null);
            reload();
          }}
          onDone={(msg) => {
            setEditing(null);
            setFlash(msg);
            reload();
          }}
        />
      )}
    </div>
  );
}
