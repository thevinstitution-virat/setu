"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Icon from "@/components/Icon";
import { ErrorLine, SMALL_CHIP, fileSize, getJson, istDate, jsonInit } from "@/components/saas/SaasKit";

type ExportStatus = "QUEUED" | "RUNNING" | "READY" | "FAILED" | "EXPIRED";
type DataExport = {
  id: string;
  status: ExportStatus;
  bytes: number | null;
  rows: number | null;
  createdAt: string;
  readyAt: string | null;
  expiresAt: string | null;
  forDeletion: boolean;
  error: string | null;
  downloadUrl: string | null;
};
type SupportSession = {
  id: string;
  by: string;
  reason: string;
  mode: "READ" | "WRITE";
  startedAt: string;
  expiresAt: string;
  endedAt: string | null;
  used: boolean;
  live: boolean;
};
type Account = { slug: string; deleteAfter: string | null; status: string };

const EXPORT: Record<ExportStatus, { label: string; chip: string }> = {
  QUEUED: { label: "Waiting", chip: "chip-genda" },
  RUNNING: { label: "Being made", chip: "chip-genda" },
  READY: { label: "Ready", chip: "chip-mint" },
  FAILED: { label: "Failed", chip: "chip-kesar" },
  EXPIRED: { label: "Expired", chip: "" },
};

export default function AccountPage() {
  const router = useRouter();
  const [account, setAccount] = useState<Account | null>(null);
  const [accountError, setAccountError] = useState<string | null>(null);
  const [exports, setExports] = useState<DataExport[] | null>(null);
  const [exportsError, setExportsError] = useState<string | null>(null);
  const [sessions, setSessions] = useState<SupportSession[] | null>(null);
  const [sessionsError, setSessionsError] = useState<string | null>(null);

  const loadAccount = useCallback(async () => {
    const r = await getJson<Account>("/api/admin/account");
    if (r.ok) {
      setAccount(r.data);
      setAccountError(null);
    } else setAccountError(r.error);
  }, []);
  const loadExports = useCallback(async () => {
    const r = await getJson<{ exports: DataExport[] }>("/api/admin/export");
    if (r.ok) {
      setExports(r.data.exports);
      setExportsError(null);
    } else setExportsError(r.error);
  }, []);
  const loadSessions = useCallback(async () => {
    const r = await getJson<{ sessions: SupportSession[] }>("/api/admin/support-sessions");
    if (r.ok) {
      setSessions(r.data.sessions);
      setSessionsError(null);
    } else setSessionsError(r.status === 423 ? "The support access list opens again when the business is back on." : r.error);
  }, []);

  useEffect(() => {
    loadAccount();
    loadExports();
    loadSessions();
  }, [loadAccount, loadExports, loadSessions]);

  // While a copy is being made, look again every few seconds.
  const making = !!exports?.some((e) => e.status === "QUEUED" || e.status === "RUNNING");
  useEffect(() => {
    if (!making) return;
    const t = setInterval(loadExports, 5000);
    return () => clearInterval(t);
  }, [making, loadExports]);

  return (
    <div className="space-y-5 max-w-2xl pb-16">
      <div>
        <p className="page-kick">Settings</p>
        <h1 className="page-title">Your data</h1>
        <p className="page-sub">Download a copy of everything, see when our support team worked in your business, or close the business.</p>
      </div>

      <ExportSection exports={exports} error={exportsError} onChanged={loadExports} making={making} />
      <SupportSection sessions={sessions} error={sessionsError} onChanged={loadSessions} />
      <DeleteSection
        account={account}
        error={accountError}
        onChanged={async () => {
          await Promise.all([loadAccount(), loadExports()]);
          // The deletion banner is drawn by the shell on the server.
          router.refresh();
        }}
      />
    </div>
  );
}

// ───────────────────────────── export ─────────────────────────────

function ExportSection({ exports, error, onChanged, making }: { exports: DataExport[] | null; error: string | null; onChanged: () => void; making: boolean }) {
  const [now] = useState(() => Date.now());
  const [busy, setBusy] = useState(false);
  const [askError, setAskError] = useState<string | null>(null);

  async function ask() {
    setBusy(true);
    setAskError(null);
    const r = await getJson<DataExport>("/api/admin/export", jsonInit("POST"));
    setBusy(false);
    if (!r.ok) setAskError(r.error);
    else onChanged();
  }

  return (
    <section className="card p-5 space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <p className="font-heading font-bold flex items-center gap-2">
            <Icon name="download" className="h-5 w-5" /> Download your data
          </p>
          <p className="text-sm text-[var(--muted)] mt-1">
            One file with all your business&apos;s data: shops, products, orders, invoices, payments and more. It takes a few minutes to make. Download it within 7 days. One copy an hour.
          </p>
        </div>
        <button type="button" className="btn btn-secondary btn-sm" disabled={busy || making} onClick={ask}>
          {busy ? "Asking…" : making ? "Making a copy…" : "Make a copy"}
        </button>
      </div>
      <ErrorLine text={askError} />
      <ErrorLine text={error} />
      {!exports && !error && <p className="text-sm text-[var(--muted)]">Loading…</p>}
      {exports && exports.length === 0 && <p className="text-sm text-[var(--muted)]">No copies made yet.</p>}
      {exports && exports.length > 0 && (
        <ul>
          {exports.map((e) => {
            const valid = !!e.downloadUrl && (!e.expiresAt || new Date(e.expiresAt).getTime() > now);
            const status = e.status === "READY" && !valid ? EXPORT.EXPIRED : EXPORT[e.status];
            return (
              <li key={e.id} className="flex flex-wrap items-center gap-3 py-3 border-b border-[var(--line)] last:border-0">
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="font-semibold text-sm">{istDate(e.createdAt, true)}</p>
                    <span className={`${SMALL_CHIP} ${status.chip}`}>{status.label}</span>
                    {e.forDeletion && <span className={SMALL_CHIP}>Final copy before deletion</span>}
                  </div>
                  <p className="text-xs text-[var(--muted)] mt-0.5">
                    {e.error ??
                      (valid
                        ? [e.rows !== null ? `${e.rows.toLocaleString("en-IN")} records` : null, fileSize(e.bytes) || null, e.expiresAt ? `download until ${istDate(e.expiresAt, true)}` : null]
                            .filter(Boolean)
                            .join(" · ")
                        : e.status === "QUEUED" || e.status === "RUNNING"
                          ? "This page updates on its own."
                          : "")}
                  </p>
                </div>
                {valid && e.downloadUrl && (
                  <a href={e.downloadUrl} className="btn btn-primary btn-sm" download>
                    <Icon name="download" className="h-4 w-4" /> Download
                  </a>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

// ───────────────────────────── support access ─────────────────────────────

function SupportSection({ sessions, error, onChanged }: { sessions: SupportSession[] | null; error: string | null; onChanged: () => void }) {
  const [busy, setBusy] = useState<string | null>(null);
  const [endError, setEndError] = useState<string | null>(null);

  async function end(id: string) {
    setBusy(id);
    setEndError(null);
    const r = await getJson<{ ok: true }>("/api/admin/support-sessions", jsonInit("POST", { id }));
    setBusy(null);
    if (!r.ok) setEndError(r.error);
    else onChanged();
  }

  return (
    <section className="card p-5 space-y-4">
      <div>
        <p className="font-heading font-bold flex items-center gap-2">
          <Icon name="eye" className="h-5 w-5" /> Support access
        </p>
        <p className="text-sm text-[var(--muted)] mt-1">
          Our support team can only open your business for a short time, with a reason, and every visit is listed here. You can end one at any time.
        </p>
      </div>
      <ErrorLine text={endError} />
      <ErrorLine text={error} />
      {!sessions && !error && <p className="text-sm text-[var(--muted)]">Loading…</p>}
      {sessions && sessions.length === 0 && <p className="text-sm text-[var(--muted)]">Support has never opened your business.</p>}
      {sessions && sessions.length > 0 && (
        <ul>
          {sessions.map((s) => (
            <li key={s.id} className="flex flex-wrap items-start gap-3 py-3 border-b border-[var(--line)] last:border-0">
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <p className="font-semibold text-sm">{s.by}</p>
                  {s.live ? <span className={`${SMALL_CHIP} chip-kesar`}>Open now</span> : <span className={SMALL_CHIP}>Ended</span>}
                  <span className={SMALL_CHIP}>{s.mode === "WRITE" ? "Can make changes" : "Look only"}</span>
                </div>
                <p className="text-sm text-[var(--ink-2)] mt-0.5 break-words">{s.reason}</p>
                <p className="text-xs text-[var(--muted)] mt-0.5">
                  From {istDate(s.startedAt, true)}
                  {s.endedAt ? ` to ${istDate(s.endedAt, true)}` : s.live ? `, ends by ${istDate(s.expiresAt, true)}` : `, ran out ${istDate(s.expiresAt, true)}`}
                  {s.used ? "" : " · not used"}
                </p>
              </div>
              {s.live && (
                <button type="button" className="btn btn-danger btn-sm" disabled={busy !== null} onClick={() => end(s.id)}>
                  {busy === s.id ? "Ending…" : "End now"}
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

// ───────────────────────────── delete ─────────────────────────────

function DeleteSection({ account, error, onChanged }: { account: Account | null; error: string | null; onChanged: () => Promise<void> }) {
  const [open, setOpen] = useState(false);
  const [typed, setTyped] = useState("");
  const [busy, setBusy] = useState(false);
  const [actError, setActError] = useState<string | null>(null);

  async function requestDelete() {
    if (!account) return;
    setBusy(true);
    setActError(null);
    const r = await getJson<{ ok: true; deleteAfter: string }>("/api/admin/account", jsonInit("POST", { confirm: typed.trim() }));
    setBusy(false);
    if (!r.ok) {
      setActError(r.error);
      return;
    }
    setOpen(false);
    setTyped("");
    await onChanged();
  }

  async function cancelDelete() {
    setBusy(true);
    setActError(null);
    const r = await getJson<{ ok: true }>("/api/admin/account", jsonInit("DELETE"));
    setBusy(false);
    if (!r.ok) {
      setActError(r.error);
      return;
    }
    await onChanged();
  }

  return (
    <section className="rounded-2xl border-2 border-[#f3c3bd] bg-[#fff7f6] p-5 space-y-4">
      <p className="font-heading font-bold text-[var(--risk-text)] flex items-center gap-2">
        <Icon name="trash" className="h-5 w-5" /> Close and delete the business
      </p>
      <ErrorLine text={error} />
      {!account && !error && <p className="text-sm text-[var(--muted)]">Loading…</p>}

      {account?.deleteAfter && (
        <div className="space-y-3">
          <p className="text-sm text-ink">
            Your business and all its data will be deleted on <b>{istDate(account.deleteAfter, true)}</b>. A final copy of your data is being made: download it
            under Download your data above.
          </p>
          <p className="text-sm text-[var(--ink-2)]">Changed your mind? Cancel before then and everything stays as it is.</p>
          <button type="button" className="btn btn-secondary" disabled={busy} onClick={cancelDelete}>
            {busy ? "Cancelling…" : "Cancel deletion"}
          </button>
        </div>
      )}

      {account && !account.deleteAfter && (
        <div className="space-y-3">
          <ul className="text-sm text-[var(--ink-2)] space-y-1.5 list-disc pl-5">
            <li>We make a final copy of all your data first, for you to download.</li>
            <li>You have 7 days to change your mind and cancel. Until then the app keeps working.</li>
            <li>After 7 days the business, its shops, staff logins, orders and invoices are deleted for good. This cannot be undone.</li>
          </ul>
          {!open ? (
            <button type="button" className="btn btn-danger" onClick={() => setOpen(true)}>
              Delete my business
            </button>
          ) : (
            <div className="space-y-3">
              <label className="block">
                <span className="block text-sm font-medium text-[var(--ink-2)] mb-1">
                  To confirm, type your business&apos;s address name: <b className="font-mono select-all">{account.slug}</b>
                </span>
                <input
                  className="input font-mono"
                  value={typed}
                  autoCapitalize="none"
                  autoCorrect="off"
                  spellCheck={false}
                  autoComplete="off"
                  onChange={(e) => {
                    setTyped(e.target.value);
                    setActError(null);
                  }}
                />
              </label>
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  className="btn !bg-[var(--risk-text)] !text-white"
                  disabled={busy || typed.trim() !== account.slug}
                  onClick={requestDelete}
                >
                  {busy ? "Asking…" : "Delete in 7 days"}
                </button>
                <button
                  type="button"
                  className="btn btn-quiet"
                  disabled={busy}
                  onClick={() => {
                    setOpen(false);
                    setTyped("");
                    setActError(null);
                  }}
                >
                  Keep my business
                </button>
              </div>
            </div>
          )}
        </div>
      )}
      <ErrorLine text={actError} />
    </section>
  );
}
