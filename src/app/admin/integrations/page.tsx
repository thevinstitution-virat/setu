"use client";

import { useState } from "react";
import Icon from "@/components/Icon";
import { ErrorBox, Field, Flash, TabBar, Toggle, api, errText, send, shortDate, useFetch } from "@/components/admin/AdminKit";
import CopyButton, { CopyLine } from "@/components/admin/CopyButton";

// ───────────────────────────── types ─────────────────────────────

type ApiKey = {
  id: string;
  name: string;
  prefix: string;
  hint: string;
  scopes: string[];
  lastUsedAt: string | null;
  lastUsedIp: string | null;
  revokedAt: string | null;
  createdAt: string;
  createdBy: string;
};

type Endpoint = {
  id: string;
  url: string;
  description: string | null;
  events: string[];
  active: boolean;
  failStreak: number;
  disabledReason: string | null;
  createdAt: string;
  last7Days: Record<string, number>;
};

type Data = {
  api: { base: string; scopes: Record<string, string>; allScopes: string[]; ratePerMinute: number };
  keys: ApiKey[];
  webhooks: { events: Record<string, string>; backoffMinutes: number[]; endpoints: Endpoint[] };
  maps: { provider: "google" | "none"; roadFactor: number; cityKmph: number; shops: number; unpinned: number };
};

type DeliveryStatus = "PENDING" | "SENT" | "FAILED" | "DEAD";

type Delivery = {
  id: string;
  event: string;
  status: DeliveryStatus;
  attempts: number;
  nextAttemptAt: string;
  lastCode: number | null;
  lastError: string | null;
  durationMs: number | null;
  sentAt: string | null;
  createdAt: string;
  payload: unknown;
};

type Tab = "api" | "webhooks" | "maps";

const TABS = [
  { key: "api", label: "API keys" },
  { key: "webhooks", label: "Webhooks" },
  { key: "maps", label: "Maps" },
] as const;

const RESOURCES = ["retailers", "products", "orders", "invoices", "payments", "stock"];

const DELIVERY: Record<DeliveryStatus, { label: string; chip: string }> = {
  PENDING: { label: "Waiting", chip: "" },
  SENT: { label: "Sent", chip: "chip-mint" },
  FAILED: { label: "Failed, will retry", chip: "chip-genda" },
  DEAD: { label: "Gave up", chip: "chip-kesar" },
};

const SMALL_CHIP = "chip !py-0.5 !px-2 !text-[11.5px]";

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

function waitText(m: number) {
  return m < 60 ? `${m} min` : `${m / 60} hr`;
}

// ───────────────────────────── page ─────────────────────────────

export default function IntegrationsPage() {
  const { data, error, reload } = useFetch<Data>("/api/admin/integrations");
  const [tab, setTab] = useState<Tab>("api");

  return (
    <div className="space-y-5 max-w-3xl pb-16">
      <div>
        <p className="page-kick">Settings</p>
        <h1 className="page-title">Integrations</h1>
        <p className="page-sub">Connect your own software. Read your data with an API key, get told about changes by webhook, and put shops on the map.</p>
      </div>

      <TabBar tabs={TABS} value={tab} onChange={setTab} />

      {error && <ErrorBox message={error} onRetry={reload} />}
      {!data && !error && <p className="text-sm text-[var(--muted)]">Loading…</p>}

      {data && tab === "api" && <ApiKeysTab data={data} onChanged={reload} />}
      {data && tab === "webhooks" && <WebhooksTab data={data} onChanged={reload} />}
      {data && tab === "maps" && <MapsTab maps={data.maps} onChanged={reload} />}
    </div>
  );
}

/** Tick boxes for a { key: label } list. */
function Checks({ options, value, onChange }: { options: Record<string, string>; value: string[]; onChange: (v: string[]) => void }) {
  const keys = Object.keys(options);
  const all = keys.every((k) => value.includes(k));
  return (
    <div className="space-y-2">
      <div className="grid gap-2 sm:grid-cols-2">
        {keys.map((k) => (
          <label key={k} className="flex items-start gap-3 rounded-2xl border border-[var(--line)] bg-white p-3 cursor-pointer min-w-0">
            <input
              type="checkbox"
              className="mt-0.5 h-5 w-5 shrink-0 accent-[var(--mor)]"
              checked={value.includes(k)}
              onChange={(e) => onChange(e.target.checked ? [...value, k] : value.filter((x) => x !== k))}
            />
            <span className="min-w-0">
              <span className="block text-sm font-semibold font-mono break-all">{k}</span>
              <span className="block text-xs text-[var(--muted)]">{options[k]}</span>
            </span>
          </label>
        ))}
      </div>
      <button type="button" className="btn btn-quiet btn-xs" onClick={() => onChange(all ? [] : keys)}>
        {all ? "Untick all" : "Tick all"}
      </button>
    </div>
  );
}

/** A secret or key shown once, with copy and a warning. */
function ShowOnce({ title, value, onDone, note }: { title: string; value: string; onDone: () => void; note?: string }) {
  return (
    <div className="card p-4 space-y-3 !bg-[var(--scheme-tint)]">
      <div className="flex items-start gap-2">
        <Icon name="alert" className="h-5 w-5 shrink-0 text-[var(--scheme-text)] mt-0.5" />
        <div className="min-w-0 text-sm">
          <p className="font-semibold">{title}</p>
          <p className="text-[var(--ink-2)]">{note ?? "Copy it now and keep it safe. It will not be shown again."}</p>
        </div>
      </div>
      <CopyLine value={value} />
      <button type="button" className="btn btn-quiet btn-xs" onClick={onDone}>
        I have copied it
      </button>
    </div>
  );
}

// ───────────────────────────── API keys ─────────────────────────────

function ApiKeysTab({ data, onChanged }: { data: Data; onChanged: () => void }) {
  const [made, setMade] = useState<{ name: string; key: string } | null>(null);
  const [flash, setFlash] = useState<string | null>(null);
  const { base, scopes, ratePerMinute } = data.api;
  const curl = `curl -H "Authorization: Bearer <key>" ${base}/orders?limit=10`;
  const live = data.keys.filter((k) => !k.revokedAt);
  const revoked = data.keys.filter((k) => k.revokedAt);

  function done(msg: string) {
    setFlash(msg);
    setTimeout(() => setFlash(null), 5000);
    onChanged();
  }

  return (
    <div className="space-y-5">
      {made && <ShowOnce title={`Your new key “${made.name}”`} value={made.key} onDone={() => setMade(null)} />}
      <Flash text={flash} />

      <section className="card p-5 space-y-4">
        <div>
          <p className="font-heading font-bold flex items-center gap-2">
            <Icon name="share" className="h-5 w-5" /> Your API
          </p>
          <p className="text-sm text-[var(--muted)] mt-1">
            Read only. Your other software (accounts, ERP, reports) can fetch data here with a key. Up to {ratePerMinute} requests a minute per key.
          </p>
        </div>
        <div className="space-y-1">
          <span className="block text-sm font-medium text-[var(--ink-2)]">API address</span>
          <CopyLine value={base} />
        </div>
        <div className="space-y-1">
          <span className="block text-sm font-medium text-[var(--ink-2)]">Try it</span>
          <CopyLine value={curl} />
          <p className="text-xs text-[var(--muted)]">Put your key in place of &lt;key&gt;.</p>
        </div>
        <details className="group">
          <summary className="cursor-pointer text-xs font-bold text-[var(--accent-text)] list-none">
            <span className="group-open:hidden">What you can read</span>
            <span className="hidden group-open:inline">Hide</span>
          </summary>
          <div className="pt-3 space-y-2 text-sm text-[var(--ink-2)]">
            <p>
              Lists:{" "}
              {RESOURCES.map((r, i) => (
                <span key={r}>
                  {i > 0 && ", "}
                  <code className="font-mono text-xs">/{r}</code>
                </span>
              ))}
              . One item: <code className="font-mono text-xs">/orders/&lt;id&gt;</code> (not for stock).
            </p>
            <ul className="list-disc pl-5 space-y-1">
              <li>
                <code className="font-mono text-xs">limit</code>: 1 to 200 per page (50 if not given).
              </li>
              <li>
                <code className="font-mono text-xs">cursor</code>: for the next page, send the <code className="font-mono text-xs">next_cursor</code> from the last
                answer. It is empty on the last page.
              </li>
              <li>
                <code className="font-mono text-xs">updated_since</code>: only what changed after this time, e.g. 2026-11-01T00:00:00Z.
              </li>
            </ul>
            <p>Each key only reads what it is allowed to (ticked below when you make it).</p>
          </div>
        </details>
      </section>

      <NewKey scopes={scopes} onMade={(m) => {
        setMade(m);
        onChanged();
      }} />

      <section className="space-y-2">
        <p className="font-heading font-bold">Keys</p>
        {data.keys.length === 0 ? (
          <div className="card p-6 text-center">
            <p className="text-sm text-[var(--muted)]">No keys yet.</p>
          </div>
        ) : (
          <ul className="card divide-y divide-[var(--line)] overflow-hidden">
            {[...live, ...revoked].map((k) => (
              <li key={k.id}>
                <KeyRow k={k} scopes={scopes} onRevoked={() => done(`“${k.name}” revoked. It stopped working at once.`)} />
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

function NewKey({ scopes, onMade }: { scopes: Record<string, string>; onMade: (m: { name: string; key: string }) => void }) {
  const [name, setName] = useState("");
  const [picked, setPicked] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function make(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) return setError("Name the key, e.g. which software uses it");
    if (!picked.length) return setError("Tick at least one thing the key may read");
    setBusy(true);
    setError(null);
    try {
      const r = await send<{ id: string; name: string; key: string }>("/api/admin/api-keys", "POST", { name: name.trim(), scopes: picked });
      setName("");
      setPicked([]);
      onMade({ name: r.name, key: r.key });
    } catch (err) {
      setError(errText(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={make} className="card p-5 space-y-4">
      <p className="font-heading font-bold">Make a key</p>
      <Field label="Name" hint="Which software or person uses it, so you know what to revoke later.">
        <input className="input" maxLength={60} placeholder="e.g. Tally bridge" value={name} onChange={(e) => setName(e.target.value)} />
      </Field>
      <div>
        <span className="block text-sm font-medium text-[var(--ink-2)] mb-1.5">It may read</span>
        <Checks options={scopes} value={picked} onChange={setPicked} />
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <button type="submit" className="btn btn-kesar btn-sm" disabled={busy}>
          <Icon name="plus" className="h-4 w-4" /> {busy ? "Making…" : "Make key"}
        </button>
        {error && <span className="text-sm text-[var(--risk-text)]">{error}</span>}
      </div>
    </form>
  );
}

function KeyRow({ k, scopes, onRevoked }: { k: ApiKey; scopes: Record<string, string>; onRevoked: () => void }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function revoke() {
    if (!window.confirm(`Revoke “${k.name}”? Software using it stops working at once. This cannot be undone.`)) return;
    setBusy(true);
    setError(null);
    try {
      await send(`/api/admin/api-keys/${k.id}`, "DELETE");
      onRevoked();
    } catch (e) {
      setError(errText(e));
      setBusy(false);
    }
  }

  return (
    <div className={`px-4 py-3 space-y-1.5 min-w-0 ${k.revokedAt ? "opacity-55" : ""}`}>
      <div className="flex flex-wrap items-center gap-1.5">
        <p className="font-semibold text-sm min-w-0 break-words">{k.name}</p>
        {k.revokedAt ? <span className={SMALL_CHIP}>Revoked {shortDate(k.revokedAt)}</span> : <span className={`${SMALL_CHIP} chip-mint`}>Working</span>}
      </div>
      <p className="font-mono text-xs text-[var(--muted)] break-all">{k.hint}</p>
      <div className="flex flex-wrap gap-1">
        {k.scopes.map((s) => (
          <span key={s} className={`${SMALL_CHIP} font-mono`} title={scopes[s]}>
            {s}
          </span>
        ))}
      </div>
      <p className="text-xs text-[var(--muted)]">
        Made {shortDate(k.createdAt)} by {k.createdBy} ·{" "}
        {k.lastUsedAt ? `last used ${shortDate(k.lastUsedAt, true)}${k.lastUsedIp ? ` from ${k.lastUsedIp}` : ""}` : "never used"}
      </p>
      {!k.revokedAt && (
        <div className="flex flex-wrap items-center gap-2 pt-1">
          <button type="button" className="btn btn-danger btn-xs" disabled={busy} onClick={revoke}>
            {busy ? "Revoking…" : "Revoke"}
          </button>
          {error && <span className="text-xs text-[var(--risk-text)]">{error}</span>}
        </div>
      )}
    </div>
  );
}

// ───────────────────────────── webhooks ─────────────────────────────

function WebhooksTab({ data, onChanged }: { data: Data; onChanged: () => void }) {
  const [secret, setSecret] = useState<{ title: string; value: string; note?: string } | null>(null);
  const [flash, setFlash] = useState<string | null>(null);
  const { events, backoffMinutes, endpoints } = data.webhooks;

  function done(msg?: string) {
    if (msg) {
      setFlash(msg);
      setTimeout(() => setFlash(null), 5000);
    }
    onChanged();
  }

  return (
    <div className="space-y-5">
      {secret && <ShowOnce title={secret.title} value={secret.value} note={secret.note} onDone={() => setSecret(null)} />}
      <Flash text={flash} />

      <section className="card p-5 space-y-3">
        <div>
          <p className="font-heading font-bold flex items-center gap-2">
            <Icon name="bell" className="h-5 w-5" /> How webhooks work
          </p>
          <p className="text-sm text-[var(--muted)] mt-1">
            When something happens, we POST it as JSON to your address. Answer with any 2xx code within 10 seconds. If not, we try again after{" "}
            {backoffMinutes.map(waitText).join(", ")}, then give up. An address that keeps failing is switched off.
          </p>
        </div>
        <details className="group">
          <summary className="cursor-pointer text-xs font-bold text-[var(--accent-text)] list-none">
            <span className="group-open:hidden">How to check a webhook is really from us</span>
            <span className="hidden group-open:inline">Hide</span>
          </summary>
          <div className="pt-3 space-y-2 text-sm text-[var(--ink-2)]">
            <p>Each POST has these headers:</p>
            <ul className="list-disc pl-5 space-y-1">
              <li>
                <code className="font-mono text-xs">Setu-Event</code>: what happened, e.g. order.placed.
              </li>
              <li>
                <code className="font-mono text-xs">Setu-Delivery</code>: an id that stays the same on retries. Use it to skip repeats.
              </li>
              <li>
                <code className="font-mono text-xs break-all">Setu-Signature: t=&lt;unix time&gt;,v1=&lt;signature&gt;</code>
              </li>
            </ul>
            <p>
              To check: join <code className="font-mono text-xs">t</code>, a dot and the raw body exactly as received, then work out HMAC-SHA256 of that with
              your address&apos;s signing secret, in hex. It must equal <code className="font-mono text-xs">v1</code>. Also refuse a{" "}
              <code className="font-mono text-xs">t</code> more than 5 minutes old.
            </p>
            <CopyLine value={'v1 == hex(HMAC_SHA256(secret, t + "." + raw_body))'} />
          </div>
        </details>
      </section>

      <NewEndpoint
        events={events}
        onMade={(r) => {
          setSecret({ title: `Signing secret for ${r.url}`, value: r.secret, note: "Copy it into your software now. You can see it again later with “Show secret”." });
          done();
        }}
      />

      <section className="space-y-2">
        <p className="font-heading font-bold">Addresses</p>
        {endpoints.length === 0 ? (
          <div className="card p-6 text-center">
            <p className="text-sm text-[var(--muted)]">No webhook addresses yet.</p>
          </div>
        ) : (
          endpoints.map((e) => (
            <EndpointCard
              key={e.id}
              e={e}
              events={events}
              onChanged={done}
              onSecret={(title, value, note) => setSecret({ title, value, note })}
            />
          ))
        )}
      </section>
    </div>
  );
}

function NewEndpoint({ events, onMade }: { events: Record<string, string>; onMade: (r: { url: string; secret: string }) => void }) {
  const [url, setUrl] = useState("");
  const [description, setDescription] = useState("");
  const [picked, setPicked] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function add(e: React.FormEvent) {
    e.preventDefault();
    if (!/^https:\/\/\S+$/i.test(url.trim())) return setError("The address must start with https://");
    if (!picked.length) return setError("Tick at least one event");
    setBusy(true);
    setError(null);
    try {
      const r = await send<{ url: string; secret: string }>("/api/admin/webhooks", "POST", { url: url.trim(), events: picked, description: description.trim() });
      setUrl("");
      setDescription("");
      setPicked([]);
      onMade(r);
    } catch (err) {
      setError(errText(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={add} className="card p-5 space-y-4">
      <p className="font-heading font-bold">Add an address</p>
      <Field label="Address (https)">
        <input
          className="input font-mono"
          type="url"
          inputMode="url"
          autoCapitalize="none"
          autoCorrect="off"
          spellCheck={false}
          placeholder="https://erp.example.com/setu-hook"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
        />
      </Field>
      <Field label="Note (optional)" hint="e.g. which software listens here.">
        <input className="input" maxLength={100} value={description} onChange={(e) => setDescription(e.target.value)} />
      </Field>
      <div>
        <span className="block text-sm font-medium text-[var(--ink-2)] mb-1.5">Send these events</span>
        <Checks options={events} value={picked} onChange={setPicked} />
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <button type="submit" className="btn btn-kesar btn-sm" disabled={busy}>
          <Icon name="plus" className="h-4 w-4" /> {busy ? "Adding…" : "Add address"}
        </button>
        {error && <span className="text-sm text-[var(--risk-text)]">{error}</span>}
      </div>
    </form>
  );
}

function EndpointCard({
  e,
  events,
  onChanged,
  onSecret,
}: {
  e: Endpoint;
  events: Record<string, string>;
  onChanged: (msg?: string) => void;
  onSecret: (title: string, value: string, note?: string) => void;
}) {
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [test, setTest] = useState<{ ok: boolean; code: number | null; error: string | null; ms: number | null } | null>(null);
  const [editing, setEditing] = useState(false);
  const [showLog, setShowLog] = useState(false);
  const [logTick, setLogTick] = useState(0);

  async function run<T>(what: string, fn: () => Promise<T>): Promise<T | null> {
    setBusy(what);
    setError(null);
    try {
      return await fn();
    } catch (err) {
      setError(errText(err));
      return null;
    } finally {
      setBusy(null);
    }
  }

  const url = `/api/admin/webhooks/${e.id}`;

  async function toggle(active: boolean) {
    const r = await run("active", () => send(url, "PATCH", { active }));
    if (r) onChanged(active ? "Address switched on" : "Address switched off");
  }

  async function sendTest() {
    setTest(null);
    const r = await run("test", () => send<{ ok: boolean; code: number | null; error: string | null; ms: number | null } | null>(url, "POST", { action: "test" }));
    if (r) {
      setTest(r);
      setLogTick((t) => t + 1);
    }
  }

  async function reveal() {
    const r = await run("reveal", () => send<{ secret: string }>(url, "POST", { action: "reveal" }));
    if (r) onSecret(`Signing secret for ${e.url}`, r.secret, "Keep it secret. Anyone with it can fake webhooks to your software.");
  }

  async function rotate() {
    if (!window.confirm("Make a new signing secret? The old one stops working at once, so update your software straight after.")) return;
    const r = await run("rotate", () => send<{ secret: string }>(url, "POST", { action: "rotate" }));
    if (r) onSecret(`New signing secret for ${e.url}`, r.secret, "The old secret no longer works. Put this one in your software now.");
  }

  async function remove() {
    if (!window.confirm(`Delete ${e.url}? Nothing more is sent there and its delivery log goes too.`)) return;
    const r = await run("delete", () => send(url, "DELETE"));
    if (r) onChanged("Address deleted");
  }

  const n = (s: DeliveryStatus) => e.last7Days[s] ?? 0;

  return (
    <div className={`card p-4 space-y-3 min-w-0 ${e.active ? "" : "!bg-ink/5"}`}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="font-mono text-sm font-semibold break-all">{e.url}</p>
          {e.description && <p className="text-sm text-[var(--ink-2)] break-words">{e.description}</p>}
          <p className="text-xs text-[var(--muted)]">Added {shortDate(e.createdAt)}</p>
        </div>
        <span className={`${SMALL_CHIP} shrink-0 ${e.active ? "chip-mint" : ""}`}>{e.active ? "On" : "Off"}</span>
      </div>

      <Toggle
        checked={e.active}
        disabled={busy === "active"}
        onChange={toggle}
        label="Send to this address"
        hint={e.active ? undefined : "Off: nothing is sent. Turning it on also clears the failure count."}
      />
      {!e.active && e.disabledReason && (
        <p className="rounded-xl bg-[var(--accent-tint)] px-3 py-2 text-xs text-[var(--accent-text)] break-words flex items-start gap-1.5">
          <Icon name="alert" className="h-4 w-4 shrink-0" />
          <span>{e.disabledReason}</span>
        </p>
      )}
      {e.active && e.failStreak > 0 && (
        <p className="text-xs text-[var(--scheme-text)]">{plural(e.failStreak, "failed send")} in a row.</p>
      )}

      <div className="flex flex-wrap gap-1">
        {e.events.map((ev) => (
          <span key={ev} className={`${SMALL_CHIP} font-mono`} title={events[ev]}>
            {ev}
          </span>
        ))}
      </div>

      <div>
        <p className="text-xs text-[var(--muted)]">Last 7 days</p>
        <div className="flex flex-wrap gap-x-3 gap-y-1 text-sm">
          <span>
            <b>{n("SENT")}</b> sent
          </span>
          <span className={n("DEAD") ? "text-[var(--risk-text)]" : ""}>
            <b>{n("DEAD")}</b> gave up
          </span>
          {n("FAILED") > 0 && <span className="text-[var(--scheme-text)]">{n("FAILED")} retrying</span>}
          {n("PENDING") > 0 && <span className="text-[var(--muted)]">{n("PENDING")} waiting</span>}
        </div>
      </div>

      {test && (
        <p className={`text-sm break-words ${test.ok ? "text-[var(--success-text)]" : "text-[var(--risk-text)]"}`}>
          {test.ok ? "Test reached your address" : "Test failed"}
          {test.code !== null && ` · answered ${test.code}`}
          {test.ms !== null && ` · ${test.ms} ms`}
          {!test.ok && test.error && ` · ${test.error}`}
        </p>
      )}

      <div className="flex flex-wrap gap-2">
        <button type="button" className="btn btn-outline btn-xs" disabled={!!busy} onClick={sendTest}>
          {busy === "test" ? "Sending…" : "Send test event"}
        </button>
        <button type="button" className="btn btn-quiet btn-xs" onClick={() => setShowLog((v) => !v)} aria-expanded={showLog}>
          {showLog ? "Hide deliveries" : "Deliveries"}
        </button>
        <button type="button" className="btn btn-quiet btn-xs" onClick={() => setEditing((v) => !v)} aria-expanded={editing}>
          <Icon name="edit" className="h-3.5 w-3.5" /> Edit
        </button>
        <button type="button" className="btn btn-quiet btn-xs" disabled={!!busy} onClick={reveal}>
          <Icon name="eye" className="h-3.5 w-3.5" /> {busy === "reveal" ? "Opening…" : "Show secret"}
        </button>
        <button type="button" className="btn btn-quiet btn-xs" disabled={!!busy} onClick={rotate}>
          {busy === "rotate" ? "Making…" : "New secret"}
        </button>
        <button type="button" className="btn btn-danger btn-xs" disabled={!!busy} onClick={remove}>
          <Icon name="trash" className="h-3.5 w-3.5" /> {busy === "delete" ? "Deleting…" : "Delete"}
        </button>
      </div>
      {error && <p className="text-xs text-[var(--risk-text)]">{error}</p>}

      {editing && (
        <EditEndpoint
          e={e}
          events={events}
          onCancel={() => setEditing(false)}
          onSaved={() => {
            setEditing(false);
            onChanged("Address saved");
          }}
        />
      )}
      {showLog && <Deliveries endpointId={e.id} tick={logTick} />}
    </div>
  );
}

function EditEndpoint({ e, events, onCancel, onSaved }: { e: Endpoint; events: Record<string, string>; onCancel: () => void; onSaved: () => void }) {
  const [url, setUrl] = useState(e.url);
  const [description, setDescription] = useState(e.description ?? "");
  const [picked, setPicked] = useState<string[]>(e.events);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save(ev: React.FormEvent) {
    ev.preventDefault();
    if (!/^https:\/\/\S+$/i.test(url.trim())) return setError("The address must start with https://");
    if (!picked.length) return setError("Tick at least one event");
    const patch: Record<string, unknown> = {};
    if (url.trim() !== e.url) patch.url = url.trim();
    if (description.trim() !== (e.description ?? "")) patch.description = description.trim();
    if ([...picked].sort().join() !== [...e.events].sort().join()) patch.events = picked;
    if (!Object.keys(patch).length) return onCancel();
    setBusy(true);
    setError(null);
    try {
      await send(`/api/admin/webhooks/${e.id}`, "PATCH", patch);
      onSaved();
    } catch (err) {
      setError(errText(err));
      setBusy(false);
    }
  }

  return (
    <form onSubmit={save} className="rounded-2xl border border-[var(--line)] bg-white/70 p-4 space-y-4">
      <Field label="Address (https)">
        <input
          className="input font-mono"
          type="url"
          inputMode="url"
          autoCapitalize="none"
          autoCorrect="off"
          spellCheck={false}
          value={url}
          onChange={(ev) => setUrl(ev.target.value)}
        />
      </Field>
      <Field label="Note (optional)">
        <input className="input" maxLength={100} value={description} onChange={(ev) => setDescription(ev.target.value)} />
      </Field>
      <div>
        <span className="block text-sm font-medium text-[var(--ink-2)] mb-1.5">Send these events</span>
        <Checks options={events} value={picked} onChange={setPicked} />
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <button type="submit" className="btn btn-kesar btn-sm" disabled={busy}>
          {busy ? "Saving…" : "Save"}
        </button>
        <button type="button" className="btn btn-quiet btn-sm" disabled={busy} onClick={onCancel}>
          Cancel
        </button>
        {error && <span className="text-sm text-[var(--risk-text)]">{error}</span>}
      </div>
    </form>
  );
}

function Deliveries({ endpointId, tick }: { endpointId: string; tick: number }) {
  const [status, setStatus] = useState<"" | DeliveryStatus>("");
  const [again, setAgain] = useState(0);
  const { data, error, reload } = useFetch<{ deliveries: Delivery[] }>(
    `/api/admin/webhooks/${endpointId}?${new URLSearchParams({ ...(status ? { status } : {}), t: String(tick + again) })}`
  );

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm font-semibold">Recent deliveries</p>
        <div className="flex items-center gap-2">
          <select className="input !min-h-[36px] !py-1 !w-auto" value={status} onChange={(ev) => setStatus(ev.target.value as "" | DeliveryStatus)} aria-label="Delivery status">
            <option value="">Any status</option>
            {(Object.keys(DELIVERY) as DeliveryStatus[]).map((s) => (
              <option key={s} value={s}>
                {DELIVERY[s].label}
              </option>
            ))}
          </select>
          <button type="button" className="btn btn-quiet btn-xs" onClick={reload}>
            Refresh
          </button>
        </div>
      </div>
      {error && <ErrorBox message={error} onRetry={reload} />}
      {!data && !error && <p className="text-sm text-[var(--muted)]">Loading…</p>}
      {data &&
        (data.deliveries.length === 0 ? (
          <p className="text-sm text-[var(--muted)]">{status ? "None with this status." : "Nothing sent yet."}</p>
        ) : (
          <ul className="rounded-2xl border border-[var(--line)] bg-white/70 divide-y divide-[var(--line)] overflow-hidden">
            {data.deliveries.map((d) => (
              <li key={d.id}>
                <DeliveryRow d={d} onAgain={() => setAgain((x) => x + 1)} />
              </li>
            ))}
          </ul>
        ))}
      {data && data.deliveries.length >= 50 && <p className="text-xs text-[var(--muted)]">Showing the newest 50.</p>}
    </div>
  );
}

function DeliveryRow({ d, onAgain }: { d: Delivery; onAgain: () => void }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const s = DELIVERY[d.status];

  async function sendAgain() {
    setBusy(true);
    setError(null);
    try {
      await send(`/api/admin/webhooks/deliveries/${d.id}`, "POST");
      onAgain();
    } catch (e) {
      setError(errText(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="px-3 py-2.5 space-y-1 min-w-0">
      <div className="flex flex-wrap items-center gap-1.5">
        <span className={`${SMALL_CHIP} ${s?.chip ?? ""}`}>{s?.label ?? d.status}</span>
        <span className="text-xs font-semibold font-mono">{d.event === "ping" ? "ping (test)" : d.event}</span>
        <span className="text-xs text-[var(--muted)] ml-auto whitespace-nowrap">{shortDate(d.createdAt, true)}</span>
      </div>
      <p className="text-xs text-[var(--muted)] break-words">
        {plural(d.attempts, "try", "tries")}
        {d.lastCode !== null && ` · answered ${d.lastCode}`}
        {d.durationMs !== null && ` · ${d.durationMs} ms`}
        {d.status === "SENT" && d.sentAt && ` · sent ${shortDate(d.sentAt, true)}`}
        {d.status === "FAILED" && ` · next try ${shortDate(d.nextAttemptAt, true)}`}
      </p>
      {d.lastError && d.status !== "SENT" && <p className="text-xs text-[var(--risk-text)] break-words">{d.lastError}</p>}
      <div className="flex flex-wrap items-center gap-2">
        <details className="group min-w-0 flex-1">
          <summary className="cursor-pointer text-xs font-bold text-[var(--accent-text)] list-none">
            <span className="group-open:hidden">Show body</span>
            <span className="hidden group-open:inline">Hide body</span>
          </summary>
          <div className="pt-2 space-y-1">
            <pre className="rounded-xl bg-ink/5 p-2 text-[11px] font-mono whitespace-pre-wrap break-all max-h-64 overflow-y-auto">
              {JSON.stringify({ id: d.id, ...(d.payload as object) }, null, 2)}
            </pre>
            <CopyButton text={JSON.stringify({ id: d.id, ...(d.payload as object) })} label="Copy body" />
          </div>
        </details>
        {(d.status === "FAILED" || d.status === "DEAD") && (
          <button type="button" className="btn btn-outline btn-xs self-start" disabled={busy} onClick={sendAgain}>
            {busy ? "Queuing…" : "Send again"}
          </button>
        )}
      </div>
      {error && <p className="text-xs text-[var(--risk-text)]">{error}</p>}
    </div>
  );
}

// ───────────────────────────── maps ─────────────────────────────

function MapsTab({ maps, onChanged }: { maps: Data["maps"]; onChanged: () => void }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<string | null>(null);
  const google = maps.provider === "google";

  async function locate() {
    setBusy(true);
    setError(null);
    setResult(null);
    try {
      const r = await api<{ tried: number; found: number }>("/api/admin/integrations", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "locate" }),
      });
      setResult(
        r.tried === 0
          ? "No shops without a pin."
          : `Looked up ${plural(r.tried, "address", "addresses")} and found ${plural(r.found, "pin")}.${r.tried > r.found ? " The rest need a clearer address, or get a pin at their next delivery." : ""}`
      );
      onChanged();
    } catch (e) {
      setError(errText(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-5">
      <section className="card p-5 space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="font-heading font-bold flex items-center gap-2">
            <Icon name="map" className="h-5 w-5" /> Maps
          </p>
          <span className={`${SMALL_CHIP} ${google ? "chip-mint" : ""}`}>{google ? "Google Maps" : "None"}</span>
        </div>
        <p className="text-sm text-[var(--ink-2)]">
          {google ? (
            "Distances, driving times and pins from addresses come from Google Maps."
          ) : (
            <>
              None: distances are straight-line × {maps.roadFactor} at {maps.cityKmph} km/h.
            </>
          )}
        </p>
        {!google && (
          <p className="text-xs text-[var(--muted)]">
            To use Google Maps, set <code className="font-mono">MAPS_PROVIDER=google</code> and <code className="font-mono">GOOGLE_MAPS_API_KEY</code> on the server, then
            restart it.
          </p>
        )}
      </section>

      <section className="card p-5 space-y-4">
        <div className="flex items-start gap-3">
          <Icon name="pin" className="h-5 w-5 shrink-0 mt-0.5" />
          <div className="min-w-0">
            <p className="font-heading font-bold">Shops without a pin</p>
            <p className="text-sm text-[var(--ink-2)] mt-1">
              <b className="text-lg">{maps.unpinned}</b> of {plural(maps.shops, "shop")}
            </p>
            <p className="text-xs text-[var(--muted)] mt-1">Shops need a pin for route planning and delivery distances.</p>
          </div>
        </div>
        <div className="space-y-1.5">
          <button type="button" className="btn btn-kesar btn-sm" disabled={!google || busy || maps.unpinned === 0} onClick={locate}>
            <Icon name="search" className="h-4 w-4" /> {busy ? "Finding pins…" : "Find pins from addresses"}
          </button>
          {!google && <p className="text-xs text-[var(--muted)]">Needs Google Maps on the server (see above).</p>}
          {google && maps.unpinned > 50 && <p className="text-xs text-[var(--muted)]">Up to 50 shops at a time. Press again for more.</p>}
        </div>
        {result && <Flash text={result} />}
        {error && <p className="text-sm text-[var(--risk-text)]">{error}</p>}
      </section>
    </div>
  );
}
