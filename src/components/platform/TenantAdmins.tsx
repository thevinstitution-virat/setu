"use client";

import { useState } from "react";
import Icon from "@/components/Icon";
import { Field, errText, send, useFetch } from "@/components/admin/AdminKit";
import { CopyLine } from "@/components/admin/CopyButton";
import { ConfirmButton, ErrLine, Section, StatusChip, useIsOwner, when } from "./kit";

type Admin = {
  id: string;
  name: string;
  loginId: string | null;
  phone: string | null;
  email: string | null;
  emailVerifiedAt: string | null;
  isOwner: boolean;
  active: boolean;
  totpEnabledAt: string | null;
  createdAt: string;
  hasPassword: boolean;
};

export type NewAdminForm = {
  name: string;
  loginId: string;
  phone: string;
  email: string;
};
export const EMPTY_ADMIN: NewAdminForm = {
  name: "",
  loginId: "",
  phone: "",
  email: "",
};

/** Name, login ID, mobile and email for a new admin (no password: they choose it from a link). */
export function AdminFields({ value, onChange }: { value: NewAdminForm; onChange: (v: NewAdminForm) => void }) {
  return (
    <div className="grid gap-3 sm:grid-cols-2">
      <Field label="Admin's name">
        <input className="input" value={value.name} maxLength={80} onChange={(e) => onChange({ ...value, name: e.target.value })} />
      </Field>
      <Field label="Login ID" hint="Lower-case letters, numbers, dots or dashes.">
        <input
          className="input"
          autoCapitalize="none"
          value={value.loginId}
          maxLength={40}
          onChange={(e) =>
            onChange({
              ...value,
              loginId: e.target.value.toLowerCase().replace(/\s/g, ""),
            })
          }
        />
      </Field>
      <Field label="Mobile (optional)">
        <input
          className="input"
          inputMode="numeric"
          maxLength={10}
          placeholder="98765 43210"
          value={value.phone}
          onChange={(e) =>
            onChange({
              ...value,
              phone: e.target.value.replace(/\D/g, "").slice(0, 10),
            })
          }
        />
      </Field>
      <Field label="Email (optional)" hint="Gets the set-password link. They confirm it under Security to use email sign-in.">
        <input className="input" type="email" autoCapitalize="none" value={value.email} onChange={(e) => onChange({ ...value, email: e.target.value })} />
      </Field>
    </div>
  );
}

/** The set-password link to hand over (shown once). */
export function LinkCard({ who, url, emailed, onDone }: { who: string; url: string; emailed: boolean; onDone: () => void }) {
  return (
    <div className="card p-4 space-y-2 !bg-[var(--genda-tint)]">
      <p className="text-sm font-semibold flex items-center gap-2">
        <Icon name="alert" className="h-4 w-4 text-[var(--genda-text)]" /> Set-password link for {who}
      </p>
      <p className="text-sm text-[var(--ink-2)]">
        Works once, for 3 days. {emailed ? "We emailed it too." : "Send it to them yourself (WhatsApp is fine)."} It isn&apos;t shown again: make a new one if it&apos;s lost.
      </p>
      <CopyLine value={url} />
      <button type="button" className="btn btn-quiet btn-xs" onClick={onDone}>
        Done
      </button>
    </div>
  );
}

/** A business's admins: the owner (protected) and the others; the super-admin can add, reset and hand over. */
export default function TenantAdmins({ tenantId, closed }: { tenantId: string; closed: boolean }) {
  const owner = useIsOwner();
  const { data, error: loadError, reload } = useFetch<{ admins: Admin[] }>(`/api/platform/tenants/${tenantId}/admins`);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [link, setLink] = useState<{
    who: string;
    url: string;
    emailed: boolean;
  } | null>(null);
  const [adding, setAdding] = useState(false);
  const [form, setForm] = useState(EMPTY_ADMIN);

  async function act(key: string, body: Record<string, unknown>, done?: (r: { url?: string; emailed?: boolean }) => void) {
    setBusy(key);
    setError(null);
    setNote(null);
    try {
      const r = await send<{ url?: string; emailed?: boolean }>(`/api/platform/tenants/${tenantId}/admins`, "POST", body);
      done?.(r);
      reload();
    } catch (e) {
      setError(errText(e));
    } finally {
      setBusy(null);
    }
  }

  const admins = data?.admins ?? [];

  return (
    <Section
      title="Admins"
      sub="The owner signed the business up. Inside the business nobody can change the owner; other admins are managed by the owner. You can reset anyone here."
      right={
        owner && !closed && !adding ? (
          <button type="button" className="btn btn-quiet btn-xs" onClick={() => setAdding(true)}>
            <Icon name="plus" className="h-4 w-4" /> Add admin
          </button>
        ) : null
      }
    >
      {link && <LinkCard {...link} onDone={() => setLink(null)} />}

      {adding && (
        <form
          className="card p-4 space-y-3"
          onSubmit={(e) => {
            e.preventDefault();
            act("add", { action: "add", ...form }, (r) => {
              setLink({
                who: form.name.trim(),
                url: r.url!,
                emailed: !!r.emailed,
              });
              setForm(EMPTY_ADMIN);
              setAdding(false);
            });
          }}
        >
          <AdminFields value={form} onChange={setForm} />
          <div className="flex gap-2">
            <button type="submit" className="btn btn-primary btn-sm" disabled={busy === "add" || !form.name.trim() || !form.loginId.trim()}>
              {busy === "add" ? "Adding…" : "Add admin"}
            </button>
            <button type="button" className="btn btn-quiet btn-sm" onClick={() => setAdding(false)}>
              Cancel
            </button>
          </div>
        </form>
      )}

      {loadError && !data ? (
        <ErrLine text={loadError} />
      ) : !data ? (
        <p className="text-sm text-[var(--muted)]">Loading…</p>
      ) : admins.length === 0 ? (
        <p className="text-sm text-[var(--muted)]">No admins.</p>
      ) : (
        <ul className="divide-y divide-[var(--line)]">
          {admins.map((a) => (
            <li key={a.id} className="py-3 space-y-2">
              <div className="flex flex-wrap items-center gap-1.5">
                <p className="text-sm font-bold">{a.name}</p>
                {a.isOwner && <StatusChip value="x" label="Owner" tone="kesar" />}
                {!a.active && <StatusChip value="x" label="Switched off" tone="red" />}
                {!a.hasPassword && <StatusChip value="x" label="No password yet" tone="genda" />}
                {a.totpEnabledAt ? <StatusChip value="x" label="2-step on" tone="mint" /> : <StatusChip value="x" label="2-step not set up" />}
              </div>
              <p className="text-xs text-[var(--muted)] break-words">
                {a.loginId ?? "No login ID"} · {a.phone ?? "No mobile"} · {a.email ? `${a.email}${a.emailVerifiedAt ? " (confirmed)" : " (not confirmed)"}` : "No email"} · since {when(a.createdAt)}
              </p>
              {owner && !closed && (
                <div className="flex flex-wrap gap-2">
                  {a.active && (
                    <button
                      type="button"
                      className="btn btn-quiet btn-xs"
                      disabled={!!busy}
                      onClick={() =>
                        act(`link-${a.id}`, { action: "link", userId: a.id }, (r) =>
                          setLink({
                            who: a.name,
                            url: r.url!,
                            emailed: !!r.emailed,
                          }),
                        )
                      }
                    >
                      {busy === `link-${a.id}` ? "Making…" : a.hasPassword ? "Password reset link" : "Set-password link"}
                    </button>
                  )}
                  {a.active && a.totpEnabledAt && (
                    <ConfirmButton
                      label="Reset 2-step"
                      question={`Clear ${a.name}'s authenticator app and sign them out?`}
                      busy={busy === `mfa-${a.id}`}
                      onConfirm={() => act(`mfa-${a.id}`, { action: "reset2fa", userId: a.id }, () => setNote(`${a.name} sets up two-step sign-in again at their next sign-in.`))}
                    />
                  )}
                  {a.active && !a.isOwner && (
                    <ConfirmButton
                      label="Make owner"
                      danger={false}
                      question={`Make ${a.name} the business owner?`}
                      busy={busy === `own-${a.id}`}
                      onConfirm={() => act(`own-${a.id}`, { action: "owner", userId: a.id }, () => setNote(`${a.name} is now the owner.`))}
                    />
                  )}
                  {!a.isOwner &&
                    (a.active ? (
                      <ConfirmButton
                        label="Switch off"
                        question={`Switch ${a.name} off? They are signed out at once.`}
                        busy={busy === `off-${a.id}`}
                        onConfirm={() =>
                          act(`off-${a.id}`, {
                            action: "active",
                            userId: a.id,
                            active: false,
                          })
                        }
                      />
                    ) : (
                      <button
                        type="button"
                        className="btn btn-quiet btn-xs"
                        disabled={!!busy}
                        onClick={() =>
                          act(`on-${a.id}`, {
                            action: "active",
                            userId: a.id,
                            active: true,
                          })
                        }
                      >
                        Switch on
                      </button>
                    ))}
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
      {note && <p className="text-sm text-[var(--mint-text)]">{note}</p>}
      <ErrLine text={error} />
    </Section>
  );
}
