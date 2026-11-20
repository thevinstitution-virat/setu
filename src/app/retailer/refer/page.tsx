"use client";

import { useState } from "react";
import Icon from "@/components/Icon";
import { formatINR } from "@/lib/money";
import { ErrorBox, shortDate, useFetch } from "@/components/admin/AdminKit";

type Referrals =
  | { on: false }
  | {
      on: true;
      code: string;
      link: string;
      message: string;
      offer: { reward: string; refereeReward: string | null; minOrder: string; validDays: number };
      earned: number;
      items: {
        id: string;
        shop: string;
        status: "PENDING" | "REWARDED" | "LAPSED";
        reward: number;
        createdAt: string;
        rewardedAt: string | null;
        expiresAt: string;
        note: string | null;
      }[];
    };

const STATUS = {
  PENDING: { label: "Waiting for first order", chip: "chip-genda" },
  REWARDED: { label: "Reward paid", chip: "chip-mint" },
  LAPSED: { label: "Did not qualify", chip: "" },
} as const;

/** Refer and earn: my code, the offer, share it, and the shops that joined with it. */
export default function ReferPage() {
  const { data, error, reload } = useFetch<Referrals>("/api/referrals");
  const [copied, setCopied] = useState<"code" | "message" | null>(null);

  async function copy(what: "code" | "message", text: string) {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(what);
      setTimeout(() => setCopied(null), 2000);
    } catch {
      setCopied(null);
    }
  }

  const head = (
    <div>
      <p className="page-kick">Refer &amp; earn</p>
      <h1 className="page-title">Invite a shop</h1>
    </div>
  );

  if (error && !data) {
    return (
      <div className="space-y-5">
        {head}
        <ErrorBox message={error} onRetry={reload} />
      </div>
    );
  }
  if (!data) {
    return (
      <div className="space-y-5">
        {head}
        <p className="text-sm text-[var(--muted)]">Loading…</p>
      </div>
    );
  }
  if (!data.on) {
    return (
      <div className="space-y-5">
        {head}
        <div className="card p-6 text-center space-y-2">
          <span className="icon-tile mx-auto bg-ink/5 text-[var(--muted)]">
            <Icon name="gift" />
          </span>
          <p className="text-sm text-[var(--ink-2)]">Refer and earn is not available right now.</p>
        </div>
      </div>
    );
  }

  const { offer } = data;
  return (
    <div className="space-y-5">
      {head}

      <div className="panel-dark p-5 space-y-4">
        <div>
          <p className="text-xs font-bold uppercase tracking-[0.12em] text-genda">You earn {offer.reward}</p>
          <p className="text-sm text-white/80 mt-1">
            for every shop that signs up with your code and gets a first order of {offer.minOrder} or more delivered within{" "}
            {offer.validDays} days.
            {offer.refereeReward ? ` They get ${offer.refereeReward} too.` : ""} Rewards go to your wallet.
          </p>
        </div>
        <div className="rounded-2xl bg-white/10 px-4 py-3 flex items-center justify-between gap-3">
          <div className="min-w-0">
            <p className="text-[11px] font-bold uppercase tracking-[0.12em] text-white/60">Your code</p>
            <p className="font-heading font-bold text-3xl tracking-[0.15em] break-all">{data.code}</p>
          </div>
          <button type="button" className="btn btn-glass btn-sm shrink-0" onClick={() => copy("code", data.code)}>
            {copied === "code" ? (
              <>
                <Icon name="check" className="h-4 w-4" /> Copied
              </>
            ) : (
              "Copy"
            )}
          </button>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
          <a
            href={`https://wa.me/?text=${encodeURIComponent(data.message)}`}
            target="_blank"
            rel="noopener noreferrer"
            className="btn btn-kesar w-full"
          >
            <Icon name="share" className="h-4 w-4" /> Share on WhatsApp
          </a>
          <button type="button" className="btn btn-glass w-full" onClick={() => copy("message", data.message)}>
            {copied === "message" ? "Message copied" : "Copy message with link"}
          </button>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div className="card p-4">
          <p className="stat-num !text-2xl">{data.items.length}</p>
          <p className="text-xs text-[var(--muted)] mt-1">Shops joined</p>
        </div>
        <div className="card p-4">
          <p className="stat-num !text-2xl">{formatINR(data.earned, { whole: true })}</p>
          <p className="text-xs text-[var(--muted)] mt-1">Earned so far</p>
        </div>
      </div>

      <section className="space-y-2">
        <h2 className="font-bold text-base">Shops you referred</h2>
        {data.items.length === 0 ? (
          <p className="card p-4 text-sm text-[var(--muted)]">No shops yet. Share your code with shops near you.</p>
        ) : (
          <ul className="card divide-y divide-[var(--line)]">
            {data.items.map((r) => (
              <li key={r.id} className="px-4 py-3 flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="font-bold text-sm break-words">{r.shop}</p>
                  <p className="text-xs text-[var(--muted)]">
                    Joined {shortDate(r.createdAt)}
                    {r.status === "PENDING" ? ` · First order by ${shortDate(r.expiresAt)}` : ""}
                    {r.status === "REWARDED" && r.rewardedAt ? ` · Paid ${shortDate(r.rewardedAt)}` : ""}
                  </p>
                  {r.note && <p className="text-xs text-[var(--muted)] mt-0.5 break-words">{r.note}</p>}
                </div>
                <div className="text-right shrink-0 max-w-[50%] space-y-1">
                  <span className={`chip !py-0.5 !px-2 !text-[11.5px] ${STATUS[r.status].chip}`}>{STATUS[r.status].label}</span>
                  {r.status !== "LAPSED" && <p className="text-xs font-semibold">{formatINR(r.reward, { whole: true })}</p>}
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
