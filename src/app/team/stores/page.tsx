"use client";

import { useState } from "react";
import Icon from "@/components/Icon";
import { ApiError, ErrorBox, Field, Sheet, Thumb, errText, fileUrl, send, shortDate, useFetch } from "@/components/admin/AdminKit";
import { Empty, Loading, errorText, mapsUrl, type Member } from "@/components/team/kit";

type Lead = {
  id: string;
  outletName: string;
  ownerName: string;
  phone: string;
  gstin: string | null;
  fssai: string | null;
  shopNumber: string;
  complexName: string;
  pinCode: string;
  areaId: string;
  area: { name: string };
  lat: number | null;
  lng: number | null;
  accuracy: number | null;
  photoKey: string | null;
  note: string | null;
  status: "PENDING" | "APPROVED" | "REJECTED";
  createdAt: string;
  createdBy: { name: string };
  decidedBy: { name: string } | null;
  decidedAt: string | null;
  decisionNote: string | null;
  retailerId: string | null;
  salesAgentId?: string | null;
  salesAgent?: { id: string; user: { name: string } } | null;
};

type Leads = { leads: Lead[]; canApprove: boolean };

const STATUS: Record<Lead["status"], { label: string; cls: string }> = {
  PENDING: { label: "Waiting", cls: "chip chip-genda" },
  APPROVED: { label: "Approved", cls: "chip chip-mint" },
  REJECTED: { label: "Refused", cls: "chip chip-kesar" },
};

export default function TeamStoresPage() {
  const pending = useFetch<Leads>("/api/leads?status=PENDING");
  const all = useFetch<Leads>("/api/leads");
  const canApprove = !!(pending.data?.canApprove ?? all.data?.canApprove);
  const members = useFetch<{ members: Member[] }>(canApprove ? "/api/team/members" : null);
  const [open, setOpen] = useState<Lead | null>(null);

  const waiting = pending.data?.leads ?? [];
  const rest = (all.data?.leads ?? []).filter((l) => l.status !== "PENDING");
  const error = pending.error ?? all.error;
  const ready = pending.data && all.data;

  function reload() {
    pending.reload();
    all.reload();
  }

  return (
    <div className="space-y-5">
      <div className="page-head">
        <div className="min-w-0">
          <p className="page-kick">Field team</p>
          <h1 className="page-title">New shops</h1>
          <p className="page-sub">Shops your team found in the field, waiting to be added.</p>
        </div>
      </div>

      {error && <ErrorBox message={error} onRetry={reload} />}
      {!ready && !error && <Loading />}

      {ready && (
        <>
          <section className="space-y-3">
            <h2 className="font-heading font-bold text-xl">
              Waiting {waiting.length > 0 && <span className="text-[var(--muted)]">({waiting.length})</span>}
            </h2>
            {waiting.length === 0 ? (
              <Empty title="No new shops waiting" sub="Shops added from the field show here until the office decides." />
            ) : (
              <div className="grid gap-3 md:grid-cols-2">
                {waiting.map((l) => (
                  <LeadCard key={l.id} l={l}>
                    {canApprove ? (
                      <button type="button" className="btn btn-kesar w-full !min-h-[44px]" onClick={() => setOpen(l)}>
                        Check and decide
                      </button>
                    ) : (
                      <p className="text-sm text-[var(--muted)] flex items-center gap-1.5">
                        <Icon name="clock" className="h-4 w-4 shrink-0" /> Waiting for the office to approve
                      </p>
                    )}
                  </LeadCard>
                ))}
              </div>
            )}
          </section>

          <section className="space-y-3">
            <h2 className="font-heading font-bold text-xl">Decided</h2>
            {rest.length === 0 ? (
              <Empty title="Nothing decided yet" />
            ) : (
              <div className="grid gap-3 md:grid-cols-2">
                {rest.map((l) => (
                  <LeadCard key={l.id} l={l} />
                ))}
              </div>
            )}
          </section>
        </>
      )}

      {open && (
        <DecideSheet
          lead={open}
          agents={(members.data?.members ?? []).filter((m) => m.salesAgentId)}
          agentsError={members.error}
          onClose={() => setOpen(null)}
          onDone={() => {
            setOpen(null);
            reload();
          }}
        />
      )}
    </div>
  );
}

function LeadCard({ l, children }: { l: Lead; children?: React.ReactNode }) {
  const address = [l.shopNumber, l.complexName, l.area.name, l.pinCode].filter(Boolean).join(", ");
  return (
    <div className="card p-4 space-y-3 min-w-0">
      <div className="flex items-start gap-3">
        {l.photoKey ? (
          <a href={fileUrl(l.photoKey)} target="_blank" rel="noopener noreferrer" className="shrink-0" aria-label={`Photo of ${l.outletName}`}>
            <Thumb imageKey={l.photoKey} className="h-16 w-16" alt={`Photo of ${l.outletName}`} />
          </a>
        ) : (
          <Thumb imageKey={null} className="h-16 w-16" />
        )}
        <div className="min-w-0 flex-1">
          <div className="flex items-start justify-between gap-2">
            <p className="font-heading font-bold break-words min-w-0">{l.outletName}</p>
            <span className={`${STATUS[l.status].cls} !py-0.5 !px-2 !text-[11.5px] shrink-0`}>{STATUS[l.status].label}</span>
          </div>
          <p className="text-sm">{l.ownerName}</p>
          <a href={`tel:${l.phone}`} className="text-sm font-semibold text-[var(--accent-text)] inline-flex items-center gap-1 min-h-[32px]">
            <Icon name="phone" className="h-3.5 w-3.5" /> {l.phone}
          </a>
        </div>
      </div>

      <div className="text-xs text-[var(--ink-2)] space-y-0.5">
        <p className="break-words">{address}</p>
        {(l.gstin || l.fssai) && (
          <p className="break-all">
            {l.gstin ? `GSTIN ${l.gstin}` : ""}
            {l.gstin && l.fssai ? " · " : ""}
            {l.fssai ? `FSSAI ${l.fssai}` : ""}
          </p>
        )}
        {l.note && <p className="break-words">Note: {l.note}</p>}
      </div>

      <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-[var(--muted)]">
        <span>
          By {l.createdBy.name} · {shortDate(l.createdAt, true)}
        </span>
        {l.lat != null && l.lng != null ? (
          <a href={mapsUrl(l.lat, l.lng)} target="_blank" rel="noopener noreferrer" className="btn btn-quiet btn-xs !min-h-[44px]">
            <Icon name="pin" className="h-3.5 w-3.5" /> Position
            {l.accuracy != null ? ` (±${l.accuracy} m)` : ""}
          </a>
        ) : (
          <span>No position</span>
        )}
      </div>

      {l.status !== "PENDING" && (
        <div className="text-xs text-[var(--ink-2)] rounded-xl bg-ink/5 p-2.5 space-y-0.5">
          <p>
            {STATUS[l.status].label}
            {l.decidedBy ? ` by ${l.decidedBy.name}` : ""}
            {l.decidedAt ? ` on ${shortDate(l.decidedAt)}` : ""}
          </p>
          {l.status === "APPROVED" && <p>Sales agent: {l.salesAgent?.user.name ?? "none"}</p>}
          {l.decisionNote && <p className="break-words">Note: {l.decisionNote}</p>}
        </div>
      )}

      {children}
    </div>
  );
}

function DecideSheet({
  lead,
  agents,
  agentsError,
  onClose,
  onDone,
}: {
  lead: Lead;
  agents: Member[];
  agentsError: string | null;
  onClose: () => void;
  onDone: () => void;
}) {
  const detail = useFetch<{ lead: Lead; clashes: string[] }>(`/api/leads/${encodeURIComponent(lead.id)}`);
  const [agentId, setAgentId] = useState(lead.salesAgent?.id ?? lead.salesAgentId ?? "");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState<"approve" | "reject" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [clashes, setClashes] = useState<string[] | null>(null);
  const shown = clashes ?? detail.data?.clashes ?? [];

  async function decide(approve: boolean) {
    if (!approve && !note.trim()) return setError("Say why the shop is refused");
    setBusy(approve ? "approve" : "reject");
    setError(null);
    try {
      await send(`/api/leads/${encodeURIComponent(lead.id)}`, "PATCH", {
        approve,
        note: note.trim() || null,
        ...(approve ? { salesAgentId: agentId || null } : {}),
      });
      onDone();
    } catch (e) {
      if (e instanceof ApiError && Array.isArray(e.data.clashes)) setClashes(e.data.clashes as string[]);
      setError(errText(e));
      setBusy(null);
    }
  }

  return (
    <Sheet
      title={lead.outletName}
      onClose={onClose}
      footer={
        <div className="space-y-2">
          {error && <p className={errorText}>{error}</p>}
          <div className="flex gap-2 justify-end">
            <button type="button" className="btn btn-quiet !min-h-[44px]" onClick={() => decide(false)} disabled={!!busy}>
              {busy === "reject" ? "Refusing…" : "Refuse"}
            </button>
            <button type="button" className="btn btn-kesar !min-h-[44px]" onClick={() => decide(true)} disabled={!!busy}>
              {busy === "approve" ? "Approving…" : "Approve and add shop"}
            </button>
          </div>
        </div>
      }
    >
      <LeadCard l={detail.data?.lead ? { ...lead, ...detail.data.lead } : lead} />

      {detail.error && <p className={errorText}>{detail.error}</p>}
      {!detail.data && !detail.error && <p className="text-sm text-[var(--muted)]">Checking for clashes…</p>}
      {detail.data && shown.length === 0 && (
        <p className="text-sm text-[var(--success-text)] flex items-center gap-1.5">
          <Icon name="check" className="h-4 w-4 shrink-0" /> No other shop has this phone or GSTIN.
        </p>
      )}
      {shown.length > 0 && (
        <div className="rounded-2xl bg-[var(--accent-tint)] p-3 space-y-1">
          <p className="text-sm font-bold text-[var(--accent-text)] flex items-center gap-1.5">
            <Icon name="alert" className="h-4 w-4 shrink-0" /> Check before approving
          </p>
          <ul className="list-disc pl-5 text-sm text-[var(--ink-2)] space-y-0.5">
            {shown.map((c) => (
              <li key={c}>{c}</li>
            ))}
          </ul>
        </div>
      )}

      <Field label="Sales agent for this shop" hint="The agent who will visit and take orders.">
        {agentsError ? (
          <p className={errorText}>{agentsError}</p>
        ) : (
          <select className="input" value={agentId} onChange={(e) => setAgentId(e.target.value)}>
            <option value="">No agent</option>
            {agents.map((m) => (
              <option key={m.salesAgentId!} value={m.salesAgentId!}>
                {m.name}
              </option>
            ))}
            {agentId && !agents.some((m) => m.salesAgentId === agentId) && lead.salesAgent && (
              <option value={lead.salesAgent.id}>{lead.salesAgent.user.name}</option>
            )}
          </select>
        )}
      </Field>

      <Field label="Note (needed to refuse)">
        <textarea className="input min-h-[80px]" maxLength={300} value={note} onChange={(e) => setNote(e.target.value)} placeholder="e.g. Already a customer under another name" />
      </Field>
    </Sheet>
  );
}
