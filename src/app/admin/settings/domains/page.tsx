"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import Icon from "@/components/Icon";
import CopyButton from "@/components/admin/CopyButton";
import { ErrorLine, SMALL_CHIP, UpgradeNote, getJson, istDate, jsonInit } from "@/components/saas/SaasKit";

type DnsRecord = { type: string; name: string; value: string };
type Domain = {
  id: string;
  host: string;
  verified: boolean;
  verifiedAt: string | null;
  checkedAt: string | null;
  lastError: string | null;
  tlsStatus: string | null;
  records: DnsRecord[];
};
type Data = { max: number; defaultHost: string; domains: Domain[] };

/** The certificate status in plain words (the server keeps an operator status line). */
function tlsText(d: Domain): { text: string; tone: "ok" | "wait" | "bad" } {
  if (!d.verified) return { text: "Set up after the address is confirmed", tone: "wait" };
  const s = (d.tlsStatus ?? "").toLowerCase();
  if (/first visit|already listed|issued|added/.test(s)) return { text: "Secure (https) from the first visit", tone: "ok" };
  if (s.startsWith("manual") || !s) return { text: "Our team adds the secure certificate. This can take up to a day.", tone: "wait" };
  return { text: "The secure certificate is not set up yet. Contact support if this lasts more than a day.", tone: "bad" };
}

export default function DomainsPage() {
  const [data, setData] = useState<Data | null>(null);
  const [locked, setLocked] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [host, setHost] = useState("");
  const [adding, setAdding] = useState(false);
  const [addError, setAddError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [rowError, setRowError] = useState<Record<string, string>>({});
  const [confirmRemove, setConfirmRemove] = useState<string | null>(null);

  async function load() {
    const r = await getJson<Data>("/api/admin/domains");
    setLoadError(null);
    if (r.ok) {
      setData(r.data);
      setLocked(false);
    } else if (r.status === 402) setLocked(true);
    else setLoadError(r.error);
  }

  useEffect(() => {
    load();
  }, []);

  const replace = (d: Domain) => setData((cur) => (cur ? { ...cur, domains: cur.domains.map((x) => (x.id === d.id ? d : x)) } : cur));
  const setErr = (id: string, msg: string | null) =>
    setRowError((cur) => {
      const next = { ...cur };
      if (msg) next[id] = msg;
      else delete next[id];
      return next;
    });

  async function add(e: React.FormEvent) {
    e.preventDefault();
    if (!host.trim()) return;
    setAdding(true);
    setAddError(null);
    const r = await getJson<Domain>("/api/admin/domains", jsonInit("POST", { host }));
    setAdding(false);
    if (!r.ok) {
      if (r.status === 402) setLocked(true);
      setAddError(r.error);
      return;
    }
    setHost("");
    setData((cur) => (cur ? { ...cur, domains: [...cur.domains, r.data] } : cur));
  }

  async function check(d: Domain) {
    setBusy(d.id);
    setErr(d.id, null);
    const r = await getJson<Domain>(`/api/admin/domains/${d.id}`, jsonInit("POST"));
    setBusy(null);
    if (r.ok) replace(r.data);
    else setErr(d.id, r.error);
  }

  async function remove(d: Domain) {
    setBusy(d.id);
    setErr(d.id, null);
    const r = await getJson<{ ok: true }>(`/api/admin/domains/${d.id}`, jsonInit("DELETE"));
    setBusy(null);
    setConfirmRemove(null);
    if (r.ok) setData((cur) => (cur ? { ...cur, domains: cur.domains.filter((x) => x.id !== d.id) } : cur));
    else setErr(d.id, r.error);
  }

  return (
    <div className="space-y-5 max-w-2xl pb-16">
      <div>
        <Link href="/admin/settings" className="text-xs font-bold text-[var(--accent-text)] inline-flex items-center gap-1">
          <Icon name="chevronLeft" className="h-3.5 w-3.5" /> Settings
        </Link>
        <h1 className="page-title">Your web address</h1>
        <p className="page-sub">Open the app on your own address, like order.yourbusiness.in, instead of ours.</p>
      </div>

      {loadError && (
        <div className="space-y-2">
          <ErrorLine text={loadError} />
          <button type="button" className="btn btn-quiet btn-sm" onClick={load}>
            Try again
          </button>
        </div>
      )}

      {locked && (
        <UpgradeNote title="Your own web address is not in your plan">
          Your app keeps working on our address. Move to a plan with a custom domain to add yours.
        </UpgradeNote>
      )}

      {!data && !locked && !loadError && <p className="text-sm text-[var(--muted)]">Loading…</p>}

      {data && (
        <>
          <section className="card p-5 space-y-3">
            <p className="text-sm text-[var(--ink-2)]">Your app is always at</p>
            <div className="flex items-center gap-2 rounded-xl bg-ink/5 px-3 py-2 min-w-0">
              <code className="flex-1 min-w-0 font-mono text-sm break-all">{data.defaultHost}</code>
              <CopyButton text={data.defaultHost} />
            </div>
          </section>

          <form onSubmit={add} className="card p-5 space-y-3">
            <p className="font-heading font-bold">Add an address</p>
            <p className="text-sm text-[var(--muted)]">
              Use a part of a domain you own, like <span className="font-mono">order.yourbusiness.in</span>. Up to {data.max} addresses.
            </p>
            <div className="flex flex-col sm:flex-row gap-2">
              <input
                className="input"
                placeholder="order.yourbusiness.in"
                autoCapitalize="none"
                autoCorrect="off"
                spellCheck={false}
                inputMode="url"
                value={host}
                onChange={(e) => {
                  setHost(e.target.value);
                  setAddError(null);
                }}
                disabled={adding || data.domains.length >= data.max}
              />
              <button type="submit" className="btn btn-primary shrink-0" disabled={adding || !host.trim() || data.domains.length >= data.max}>
                <Icon name="plus" className="h-4 w-4" />
                {adding ? "Adding…" : "Add"}
              </button>
            </div>
            {data.domains.length >= data.max && <p className="text-xs text-[var(--muted)]">You have {data.max} addresses. Remove one to add another.</p>}
            <ErrorLine text={addError} />
          </form>

          {data.domains.map((d) => {
            const tls = tlsText(d);
            return (
              <section key={d.id} className="card p-5 space-y-4">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="font-heading font-bold break-all">{d.host}</p>
                    <p className="text-xs text-[var(--muted)] mt-0.5">
                      {d.verified ? `Confirmed ${istDate(d.verifiedAt, true)}` : d.checkedAt ? `Last checked ${istDate(d.checkedAt, true)}` : "Not checked yet"}
                    </p>
                  </div>
                  <span className={`${SMALL_CHIP} ${d.verified ? "chip-mint" : "chip-genda"}`}>{d.verified ? "Working" : "Waiting for DNS"}</span>
                </div>

                {!d.verified && (
                  <div className="space-y-2">
                    <p className="text-sm text-[var(--ink-2)]">
                      Add these two records where you manage your domain (your domain seller&apos;s DNS page), then press Check now.
                    </p>
                    <div className="space-y-2">
                      {d.records.map((rec) => (
                        <div key={rec.type + rec.name} className="rounded-xl border border-[var(--line)] bg-white p-3 space-y-2 min-w-0">
                          <span className={`${SMALL_CHIP} chip-mor`}>{rec.type}</span>
                          <div className="grid gap-2 sm:grid-cols-[90px_minmax(0,1fr)] items-start text-sm">
                            <span className="text-[var(--muted)] sm:pt-1">Name</span>
                            <div className="flex items-start gap-2 min-w-0">
                              <code className="flex-1 min-w-0 font-mono text-xs break-all bg-ink/5 rounded-lg px-2 py-1.5 select-all">{rec.name}</code>
                              <CopyButton text={rec.name} />
                            </div>
                            <span className="text-[var(--muted)] sm:pt-1">{rec.type === "CNAME" ? "Points to" : "Value"}</span>
                            <div className="flex items-start gap-2 min-w-0">
                              <code className="flex-1 min-w-0 font-mono text-xs break-all bg-ink/5 rounded-lg px-2 py-1.5 select-all">{rec.value}</code>
                              <CopyButton text={rec.value} />
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                    <p className="text-xs text-[var(--muted)]">
                      Some DNS pages add your domain to the name by themselves. Then type only the part before it (for example{" "}
                      <span className="font-mono">_setu-verify.order</span>). Changes can take up to an hour to show.
                    </p>
                  </div>
                )}

                {d.lastError && !d.verified && (
                  <p className="text-sm rounded-xl bg-[var(--scheme-tint)] text-[var(--scheme-text)] px-3 py-2 flex items-start gap-2">
                    <Icon name="alert" className="h-4 w-4 shrink-0 mt-0.5" />
                    <span className="min-w-0 break-words">{d.lastError}</span>
                  </p>
                )}

                <div className="flex items-start gap-2 text-sm">
                  <Icon name="lock" className={`h-4 w-4 shrink-0 mt-0.5 ${tls.tone === "ok" ? "text-[var(--success-text)]" : tls.tone === "bad" ? "text-[var(--risk-text)]" : "text-[var(--muted)]"}`} />
                  <span className="min-w-0 text-[var(--ink-2)]">Secure certificate: {tls.text}</span>
                </div>

                <ErrorLine text={rowError[d.id]} />

                <div className="flex flex-wrap gap-2">
                  {!d.verified && (
                    <button type="button" className="btn btn-secondary btn-sm" disabled={busy !== null} onClick={() => check(d)}>
                      {busy === d.id && confirmRemove !== d.id ? "Checking…" : "Check now"}
                    </button>
                  )}
                  {d.verified && (
                    <a href={`https://${d.host}`} target="_blank" rel="noopener noreferrer" className="btn btn-quiet btn-sm">
                      Open
                    </a>
                  )}
                  {confirmRemove === d.id ? (
                    <>
                      <button type="button" className="btn btn-danger btn-sm" disabled={busy !== null} onClick={() => remove(d)}>
                        {busy === d.id ? "Removing…" : "Yes, remove"}
                      </button>
                      <button type="button" className="btn btn-quiet btn-sm" disabled={busy !== null} onClick={() => setConfirmRemove(null)}>
                        Keep it
                      </button>
                    </>
                  ) : (
                    <button type="button" className="btn btn-quiet btn-sm" disabled={busy !== null} onClick={() => setConfirmRemove(d.id)}>
                      <Icon name="trash" className="h-4 w-4" /> Remove
                    </button>
                  )}
                </div>
                {confirmRemove === d.id && (
                  <p className="text-xs text-[var(--muted)]">
                    The app stops opening on {d.host}. {d.verified ? "Shops using that address will need the other one." : ""}
                  </p>
                )}
              </section>
            );
          })}
        </>
      )}
    </div>
  );
}
