"use client";

import { useState } from "react";
import Link from "next/link";
import Icon from "@/components/Icon";
import { formatINR } from "@/lib/money";
import { ErrorBox, Flash, errText, send, shortDate, useFetch } from "@/components/admin/AdminKit";
import { EngageNav, Pills } from "@/components/engage/admin/kit";

type Status = "PENDING" | "REWARDED" | "LAPSED";
type Referral = {
  id: string;
  code: string;
  status: Status;
  referrerReward: number;
  refereeReward: number;
  minOrder: number;
  expiresAt: string;
  orderId: string | null;
  rewardedAt: string | null;
  note: string | null;
  createdAt: string;
  referrer: { id: string; outletName: string };
  referee: { id: string; outletName: string };
};
type Data = { items: Referral[]; counts: Partial<Record<Status, number>>; rewardsPaid: number };

const STATUS: Record<Status, { label: string; chip: string }> = {
  PENDING: { label: "Waiting for first order", chip: "chip-genda" },
  REWARDED: { label: "Rewarded", chip: "chip-mint" },
  LAPSED: { label: "Lapsed", chip: "" },
};

const FILTERS = [
  { key: "", label: "All" },
  { key: "PENDING", label: "Pending" },
  { key: "REWARDED", label: "Rewarded" },
  { key: "LAPSED", label: "Lapsed / cancelled" },
] as const;
type Filter = (typeof FILTERS)[number]["key"];

export default function ReferralsPage() {
  const [filter, setFilter] = useState<Filter>("");
  const { data, error, reload } = useFetch<Data>(`/api/admin/referrals${filter ? `?status=${filter}` : ""}`);
  const [flash, setFlash] = useState<string | null>(null);

  const c = data?.counts ?? {};
  const total = (c.PENDING ?? 0) + (c.REWARDED ?? 0) + (c.LAPSED ?? 0);
  const pills = FILTERS.map((f) => ({ ...f, count: data ? (f.key ? (c[f.key] ?? 0) : total) : null }));

  return (
    <div className="space-y-5 pb-16">
      <div className="page-head">
        <div className="min-w-0">
          <p className="page-kick">Engage</p>
          <h1 className="page-title">Refer and earn</h1>
          <p className="page-sub">Shops that joined with another shop&apos;s code. The reward is paid into the wallet when the new shop&apos;s first order is delivered.</p>
        </div>
        <Link href="/admin/settings" className="btn btn-quiet btn-sm">
          <Icon name="settings" className="h-4 w-4" /> Rewards and rules
        </Link>
      </div>
      <EngageNav />

      {data && (
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          <Tile value={String(c.PENDING ?? 0)} label="Waiting for a first order" />
          <Tile value={String(c.REWARDED ?? 0)} label="Rewarded" />
          <Tile value={String(c.LAPSED ?? 0)} label="Lapsed or cancelled" />
          <Tile value={formatINR(data.rewardsPaid, { whole: true })} label="Rewards paid so far" />
        </div>
      )}

      <Pills items={pills} value={filter} onChange={setFilter} label="Show" />
      <Flash text={flash} />
      {error && <ErrorBox message={error} onRetry={reload} />}
      {!data && !error && <p className="text-sm text-[var(--muted)]">Loading…</p>}

      {data && (
        <div className="space-y-2">
          {data.items.map((r) => (
            <ReferralCard
              key={r.id}
              r={r}
              onCancelled={(msg) => {
                setFlash(msg);
                reload();
              }}
            />
          ))}
          {data.items.length === 0 && (
            <p className="card p-5 text-sm text-[var(--muted)]">{total ? "Nothing in this list." : "No shop has joined with a referral code yet."}</p>
          )}
          {data.items.length >= 200 && <p className="text-xs text-[var(--muted)]">Showing the latest 200.</p>}
        </div>
      )}
    </div>
  );
}

function Tile({ value, label }: { value: string; label: string }) {
  return (
    <div className="card p-4 min-w-0">
      <p className="stat-num !text-2xl break-words">{value}</p>
      <p className="stat-lbl">{label}</p>
    </div>
  );
}

function ReferralCard({ r, onCancelled }: { r: Referral; onCancelled: (msg: string) => void }) {
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function cancel() {
    if (!reason.trim()) return setError("Say why it is cancelled");
    setBusy(true);
    setError(null);
    try {
      await send(`/api/admin/referrals/${r.id}`, "PATCH", { note: reason.trim() });
      onCancelled(`Cancelled the referral of ${r.referee.outletName}. No reward will be paid.`);
    } catch (e) {
      setError(errText(e));
      setBusy(false);
    }
  }

  return (
    <div className="card p-4 space-y-2 min-w-0">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="font-bold break-words">
            <Link href={`/admin/khata/${r.referrer.id}`} className="hover:underline">
              {r.referrer.outletName}
            </Link>
            <Icon name="arrow" className="inline h-4 w-4 mx-1.5 -mt-0.5 text-[var(--muted)]" />
            <Link href={`/admin/khata/${r.referee.id}`} className="hover:underline">
              {r.referee.outletName}
            </Link>
          </p>
          <p className="text-xs text-[var(--muted)]">
            Code <span className="font-mono">{r.code}</span> · joined {shortDate(r.createdAt)}
          </p>
        </div>
        <span className={`chip !py-0.5 !px-2 !text-[11.5px] ${STATUS[r.status].chip}`}>{STATUS[r.status].label}</span>
      </div>

      <div className="flex flex-wrap gap-x-4 gap-y-1 text-sm">
        <span>
          <span className="text-[var(--muted)]">Referring shop gets</span> <b>{formatINR(r.referrerReward, { whole: true })}</b>
        </span>
        <span>
          <span className="text-[var(--muted)]">New shop gets</span> <b>{r.refereeReward ? formatINR(r.refereeReward, { whole: true }) : "nothing"}</b>
        </span>
        <span>
          <span className="text-[var(--muted)]">First order of at least</span> <b>{formatINR(r.minOrder, { whole: true })}</b>
        </span>
      </div>
      <p className="text-xs text-[var(--muted)]">
        {r.status === "PENDING" && `Needs a delivered order by ${shortDate(r.expiresAt)}`}
        {r.status === "REWARDED" && r.rewardedAt && `Rewarded ${shortDate(r.rewardedAt, true)}`}
        {r.status === "LAPSED" && !r.note?.startsWith("Cancelled") && `Offer ran until ${shortDate(r.expiresAt)}`}
      </p>
      {r.note && <p className="text-sm text-[var(--ink-2)] rounded-xl bg-ink/5 px-3 py-2 break-words">{r.note}</p>}

      {r.status === "PENDING" &&
        (open ? (
          <div className="border-t border-[var(--line)] pt-3 space-y-2">
            <label className="block">
              <span className="block text-sm font-medium text-[var(--ink-2)] mb-1">Why cancel it?</span>
              <input
                className="input"
                value={reason}
                maxLength={200}
                autoFocus
                placeholder="e.g. Same owner as the referring shop"
                onChange={(e) => {
                  setReason(e.target.value);
                  setError(null);
                }}
              />
            </label>
            <p className="text-xs text-[var(--muted)]">A cancelled referral never pays. This can&apos;t be undone.</p>
            {error && <p className="text-sm text-[var(--risk-text)]">{error}</p>}
            <div className="flex flex-wrap gap-2">
              <button type="button" className="btn btn-danger btn-xs" disabled={busy} onClick={cancel}>
                {busy ? "Cancelling…" : "Cancel referral"}
              </button>
              <button type="button" className="btn btn-quiet btn-xs" disabled={busy} onClick={() => setOpen(false)}>
                Keep it
              </button>
            </div>
          </div>
        ) : (
          <button type="button" className="btn btn-quiet btn-xs" onClick={() => setOpen(true)}>
            Cancel…
          </button>
        ))}
    </div>
  );
}
