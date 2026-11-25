"use client";

import Link from "next/link";
import Icon, { type IconName } from "@/components/Icon";
import { formatINR } from "@/lib/money";
import { useFetch } from "@/components/admin/AdminKit";
import { EngageNav, plural, useNow } from "@/components/engage/admin/kit";
import { announcementState, type Announcement } from "@/components/engage/admin/announcement-types";

type Tickets = { counts: { open: number; overdue: number; mine: number; resolved: number } };
type Feedback = { count: number; average: number | null };
type Referrals = { counts: Record<string, number>; rewardsPaid: number };
type Messages = { counts: { status: string; channel: string; count: number }[] };
type Templates = { items: { own: Record<string, unknown> }[] };

export default function EngagePage() {
  const now = useNow();
  const tickets = useFetch<Tickets>("/api/admin/tickets?view=open");
  const ann = useFetch<{ items: Announcement[] }>("/api/admin/announcements");
  const fb = useFetch<Feedback>("/api/admin/feedback?days=30");
  const refs = useFetch<Referrals>("/api/admin/referrals");
  const msgs = useFetch<Messages>("/api/admin/messages");
  const tpl = useFetch<Templates>("/api/admin/templates");

  const live = ann.data ? ann.data.items.filter((a) => announcementState(a, now) === "live").length : null;
  const drafts = ann.data ? ann.data.items.filter((a) => announcementState(a, now) === "draft").length : null;
  const failed = msgs.data ? msgs.data.counts.filter((c) => c.status === "FAILED").reduce((s, c) => s + c.count, 0) : null;
  const sent = msgs.data ? msgs.data.counts.reduce((s, c) => s + c.count, 0) : null;
  const custom = tpl.data ? tpl.data.items.reduce((s, i) => s + Object.keys(i.own).length, 0) : null;
  const pending = refs.data ? (refs.data.counts.PENDING ?? 0) : null;

  return (
    <div className="space-y-5 pb-16">
      <div className="page-head">
        <div className="min-w-0">
          <p className="page-kick">Communication</p>
          <h1 className="page-title">Engage</h1>
          <p className="page-sub">Announcements, ratings, refer and earn, and every message the app sends.</p>
        </div>
      </div>
      <EngageNav />

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        <HubCard
          href="/admin/complaints"
          icon="chat"
          title="Complaints"
          value={tickets.data ? String(tickets.data.counts.open) : null}
          label="open"
          note={tickets.data ? (tickets.data.counts.overdue ? `${tickets.data.counts.overdue} past the deadline` : "None past the deadline") : null}
          alert={!!tickets.data?.counts.overdue}
          error={tickets.error}
        />
        <HubCard
          href="/admin/engage/announcements"
          icon="megaphone"
          title="Announcements"
          value={live === null ? null : String(live)}
          label="live now"
          note={drafts === null ? null : drafts ? `${plural(drafts, "draft")} not sent yet` : "Notices to shops and staff"}
          error={ann.error}
        />
        <HubCard
          href="/admin/engage/ratings"
          icon="star"
          title="Delivery ratings"
          value={fb.data ? (fb.data.average === null ? "—" : `${fb.data.average}★`) : null}
          label="average, last 30 days"
          note={fb.data ? `${plural(fb.data.count, "rating")}` : null}
          alert={fb.data?.average !== null && fb.data?.average !== undefined && fb.data.average < 3.5}
          error={fb.error}
        />
        <HubCard
          href="/admin/engage/referrals"
          icon="gift"
          title="Refer and earn"
          value={pending === null ? null : String(pending)}
          label="waiting for a first order"
          note={refs.data ? `${formatINR(refs.data.rewardsPaid, { whole: true })} rewards paid` : null}
          error={refs.error}
        />
        <HubCard
          href="/admin/engage/messages"
          icon="bell"
          title="Message log"
          value={failed === null ? null : String(failed)}
          label="failed, last 7 days"
          note={sent === null ? null : `${plural(sent, "message")} in the last 7 days`}
          alert={!!failed}
          error={msgs.error}
        />
        <HubCard
          href="/admin/engage/wording"
          icon="edit"
          title="Message wording"
          value={custom === null ? null : String(custom)}
          label={custom === 1 ? "wording of your own" : "wordings of your own"}
          note="English and Hindi, per message"
          error={tpl.error}
        />
      </div>

      <p className="text-xs text-[var(--muted)]">
        Which channels each message goes on, payment reminders and refer-and-earn rewards are set in{" "}
        <Link href="/admin/settings" className="font-bold text-[var(--accent-text)]">
          Settings
        </Link>
        .
      </p>
    </div>
  );
}

function HubCard({
  href,
  icon,
  title,
  value,
  label,
  note,
  alert,
  error,
}: {
  href: string;
  icon: IconName;
  title: string;
  value: string | null;
  label: string;
  note: string | null;
  alert?: boolean;
  error: string | null;
}) {
  return (
    <Link href={href} className="card p-4 block min-w-0 transition hover:shadow-lg">
      <div className="flex items-center gap-3">
        <span className={`icon-tile ${alert ? "bg-[var(--risk-tint)] text-[var(--risk-text)]" : "bg-[var(--success-tint)] text-[var(--success-text)]"}`}>
          <Icon name={icon} />
        </span>
        <p className="font-heading font-bold flex-1 min-w-0 truncate">{title}</p>
        <Icon name="arrow" className="h-4 w-4 text-[var(--muted)] shrink-0" />
      </div>
      <div className="mt-3">
        {error ? (
          <p className="text-sm text-[var(--risk-text)]">{error}</p>
        ) : value === null ? (
          <p className="stat-num !text-2xl text-[var(--muted)]">…</p>
        ) : (
          <p className={`stat-num !text-2xl ${alert ? "text-[var(--risk-text)]" : ""}`}>{value}</p>
        )}
        <p className="stat-lbl">{label}</p>
        {note && !error && <p className="text-xs text-[var(--muted)] mt-1">{note}</p>}
      </div>
    </Link>
  );
}
