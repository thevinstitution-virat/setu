"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import Icon from "@/components/Icon";
import { Bar, ErrorLine, SMALL_CHIP, getJson, jsonInit } from "@/components/saas/SaasKit";

type StepState = "done" | "skipped" | "todo";
type Step = { key: string; title: string; href: string; optional: boolean; state: StepState; detail?: string };
type Checklist = { steps: Step[]; done: number; total: number; dismissed: boolean };

/** One line under each step: what it is for. */
const WHY: Record<string, string> = {
  business: "Your address and GSTIN go on every invoice.",
  brand: "Your logo and colours on the app, invoices and the phone icon.",
  areas: "Group shops by area so orders and deliveries are planned by route.",
  products: "Add products and prices yourself or upload a sheet.",
  retailers: "Add the shops you sell to. They can then order from their phone.",
  staff: "Sales and delivery staff get their own logins.",
  payments: "Let shops pay online with a payment link or UPI QR.",
  domain: "Open the app on your own address, like order.yourbusiness.in.",
};

export default function SetupPage() {
  const [list, setList] = useState<Checklist | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);

  async function load() {
    const r = await getJson<Checklist>("/api/admin/setup");
    setLoadError(r.ok ? null : r.error);
    if (r.ok) setList(r.data);
  }

  useEffect(() => {
    load();
  }, []);

  async function patch(key: string, body: Record<string, unknown>, after?: (c: Checklist) => void) {
    setBusy(key);
    setError(null);
    setNote(null);
    const r = await getJson<Checklist>("/api/admin/setup", jsonInit("PATCH", body));
    setBusy(null);
    if (!r.ok) {
      setError(r.error);
      return;
    }
    setList(r.data);
    after?.(r.data);
  }

  function undo(step: Step) {
    patch(step.key, { step: step.key, state: "todo" }, (c) => {
      const now = c.steps.find((s) => s.key === step.key);
      if (now?.state === "done") setNote(`“${step.title}” is done from what you have already added, so it stays ticked.`);
    });
  }

  if (loadError)
    return (
      <div className="max-w-2xl space-y-3">
        <ErrorLine text={loadError} />
        <button type="button" className="btn btn-quiet btn-sm" onClick={load}>
          Try again
        </button>
      </div>
    );
  if (!list) return <p className="text-sm text-[var(--muted)]">Loading…</p>;

  const allDone = list.done >= list.total;
  const fresh = list.done <= 1;
  const next = list.steps.find((s) => s.state === "todo");

  return (
    <div className="space-y-5 max-w-2xl pb-16">
      <div>
        <p className="page-kick">Set up</p>
        <h1 className="page-title">{allDone ? "Your business is all set" : fresh ? "Welcome! Let's get your business ready" : "Finish setting up"}</h1>
        <p className="page-sub">
          {allDone
            ? "Every step is done or skipped. You can change any of it later from Settings."
            : "A few steps and your shops can start ordering. Do them in any order; optional ones can be skipped."}
        </p>
      </div>

      <section className="card p-5 space-y-3">
        <div className="flex flex-wrap items-end justify-between gap-2">
          <div>
            <p className="stat-num">
              {list.done}
              <span className="text-[var(--muted)] text-lg"> / {list.total}</span>
            </p>
            <p className="stat-lbl">steps done or skipped</p>
          </div>
          {next && (
            <Link href={next.href} className="btn btn-primary btn-sm">
              Next: {next.title}
              <Icon name="arrow" className="h-4 w-4" />
            </Link>
          )}
        </div>
        <Bar value={list.done} max={list.total} tone="kesar" />
      </section>

      <ErrorLine text={error} />
      {note && <p className="text-sm text-[var(--ink-2)] rounded-xl bg-ink/5 px-3 py-2">{note}</p>}

      <ol className="space-y-3">
        {list.steps.map((s, i) => (
          <li key={s.key} className={`card p-4 flex items-start gap-3 ${s.state !== "todo" ? "opacity-90" : ""}`}>
            <span
              className={`icon-tile !h-9 !w-9 text-sm font-bold ${
                s.state === "done" ? "bg-[var(--mint-tint)] text-[var(--mint-text)]" : s.state === "skipped" ? "bg-ink/5 text-[var(--muted)]" : "bg-[var(--kesar-tint)] text-[var(--kesar-text)]"
              }`}
              aria-hidden="true"
            >
              {s.state === "done" ? <Icon name="check" /> : s.state === "skipped" ? <Icon name="x" /> : i + 1}
            </span>
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2">
                <p className={`font-semibold ${s.state === "skipped" ? "line-through text-[var(--muted)]" : ""}`}>{s.title}</p>
                {s.optional && <span className={SMALL_CHIP}>Optional</span>}
                {s.state === "done" && <span className={`${SMALL_CHIP} chip-mint`}>Done</span>}
                {s.state === "skipped" && <span className={SMALL_CHIP}>Skipped</span>}
              </div>
              <p className="text-sm text-[var(--muted)] mt-0.5">{s.detail ? `${s.detail}. ` : ""}{WHY[s.key] ?? ""}</p>
              <div className="flex flex-wrap gap-2 mt-3">
                <Link href={s.href} className={`btn btn-xs ${s.state === "todo" ? "btn-secondary" : "btn-quiet"}`}>
                  {s.state === "todo" ? "Open" : "Change"}
                </Link>
                {s.state === "todo" && (
                  <button type="button" className="btn btn-quiet btn-xs" disabled={busy !== null} onClick={() => patch(s.key, { step: s.key, state: "done" })}>
                    <Icon name="check" className="h-3.5 w-3.5" />
                    {busy === s.key ? "Saving…" : "Mark done"}
                  </button>
                )}
                {s.state === "todo" && s.optional && (
                  <button type="button" className="btn btn-quiet btn-xs" disabled={busy !== null} onClick={() => patch(s.key, { step: s.key, state: "skipped" })}>
                    Skip
                  </button>
                )}
                {s.state !== "todo" && (
                  <button type="button" className="btn btn-quiet btn-xs" disabled={busy !== null} onClick={() => undo(s)}>
                    {busy === s.key ? "Saving…" : s.state === "skipped" ? "Don't skip" : "Not done yet"}
                  </button>
                )}
              </div>
            </div>
          </li>
        ))}
      </ol>

      <section className="card p-4 flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-[var(--ink-2)] min-w-0 flex-1">
          {list.dismissed ? "Set-up reminders are hidden. This page stays here under Set up." : "Done for now? Hide the set-up reminders. This page stays here under Set up."}
        </p>
        <button type="button" className="btn btn-quiet btn-sm" disabled={busy !== null} onClick={() => patch("dismiss", { dismiss: !list.dismissed })}>
          {busy === "dismiss" ? "Saving…" : list.dismissed ? "Show reminders" : "Hide reminders"}
        </button>
      </section>
    </div>
  );
}
