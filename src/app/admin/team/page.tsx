"use client";

import { useState } from "react";
import Link from "next/link";
import Icon from "@/components/Icon";
import { ErrorBox, Field, Flash, Sheet, TabBar, errText, send, useFetch } from "@/components/admin/AdminKit";
import { validMobile } from "@/lib/field-math";

type Role = "SALES_AGENT" | "DELIVERY_AGENT" | "SUPERVISOR";

type TeamUser = {
  id: string;
  name: string;
  loginId: string | null;
  phone: string | null;
  role: Role;
  active: boolean;
  supervisorId: string | null;
  supervisor: { id: string; name: string } | null;
  salesAgentProfile: { id: string } | null;
};

type Retailer = {
  id: string;
  outletName: string;
  area: { name: string; region: { name: string } };
  salesAgent: { id: string; user: { name: string } } | null;
};

const ROLES: readonly { role: Role; label: string; plural: string; chip: string }[] = [
  { role: "SALES_AGENT", label: "Sales agent", plural: "Sales agents", chip: "chip-kesar" },
  { role: "DELIVERY_AGENT", label: "Delivery agent", plural: "Delivery agents", chip: "chip-mor" },
  { role: "SUPERVISOR", label: "Supervisor", plural: "Supervisors", chip: "chip-genda" },
];
const roleInfo = (r: Role) => ROLES.find((x) => x.role === r) ?? ROLES[0];

/** "9876543210" → "98765 43210". */
const showPhone = (p: string) => (p.length === 10 ? `${p.slice(0, 5)} ${p.slice(5)}` : p);

const PHONE_HINT = "Used to sign in with an OTP and to switch between businesses they work for.";

function RoleChip({ role }: { role: Role }) {
  const r = roleInfo(role);
  return <span className={`chip ${r.chip} !py-0.5 !px-2 !text-[11.5px]`}>{r.label}</span>;
}

/** Supervisor <select>: "No supervisor" plus the given supervisors. */
function SupervisorSelect({
  value,
  onChange,
  options,
}: {
  value: string;
  onChange: (id: string) => void;
  options: { id: string; name: string }[];
}) {
  return (
    <select className="input" value={value} onChange={(e) => onChange(e.target.value)}>
      <option value="">No supervisor</option>
      {options.map((s) => (
        <option key={s.id} value={s.id}>
          {s.name}
        </option>
      ))}
    </select>
  );
}

const EMPTY = { name: "", loginId: "", password: "", role: "SALES_AGENT" as Role, phone: "", supervisorId: "" };

export default function AdminTeamPage() {
  const { data, error: loadError, reload } = useFetch<{ users: TeamUser[]; retailers: Retailer[] }>("/api/admin/users");
  const [form, setForm] = useState(EMPTY);
  const [error, setError] = useState<string | null>(null);
  const [flash, setFlash] = useState<string | null>(null);
  const [listFlash, setListFlash] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [tab, setTab] = useState<"all" | Role>("all");
  const [editing, setEditing] = useState<TeamUser | null>(null);
  const [rowError, setRowError] = useState<{ id: string; text: string } | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  if (loadError && !data) return <ErrorBox message={loadError} onRetry={reload} />;
  if (!data) return <p className="text-sm text-[var(--muted)]">Loading…</p>;

  const users = data.users ?? [];
  const retailers = data.retailers ?? [];
  const salesAgents = users.filter((u) => u.role === "SALES_AGENT");
  const supervisors = users.filter((u) => u.role === "SUPERVISOR" && u.active);
  const teamSize = (id: string) => users.filter((u) => u.supervisorId === id).length;
  const shown = tab === "all" ? users : users.filter((u) => u.role === tab);

  async function createUser() {
    setError(null);
    setFlash(null);
    if (!form.name.trim() || !form.loginId.trim() || !form.password) {
      setError("Fill in name, login ID and password");
      return;
    }
    if (form.phone && !validMobile(form.phone)) {
      setError("Enter a 10-digit mobile number");
      return;
    }
    setLoading(true);
    try {
      await send("/api/admin/users", "POST", {
        name: form.name.trim(),
        loginId: form.loginId.trim(),
        password: form.password,
        role: form.role,
        ...(form.phone ? { phone: form.phone } : {}),
        ...(form.role !== "SUPERVISOR" && form.supervisorId ? { supervisorId: form.supervisorId } : {}),
      });
      setFlash(`${form.name.trim()} added`);
      setForm({ ...EMPTY, role: form.role, supervisorId: form.supervisorId });
      reload();
    } catch (e) {
      setError(errText(e));
    } finally {
      setLoading(false);
    }
  }

  async function toggleActive(u: TeamUser) {
    if (u.active && u.role === "SUPERVISOR") {
      const n = teamSize(u.id);
      if (n && !window.confirm(`Switch off ${u.name}? Their team of ${n} will have no supervisor.`)) return;
    }
    setRowError(null);
    setBusyId(u.id);
    try {
      await send(`/api/admin/users/${u.id}`, "PATCH", { active: !u.active });
      reload();
    } catch (e) {
      setRowError({ id: u.id, text: errText(e) });
    } finally {
      setBusyId(null);
    }
  }

  async function signOutEverywhere(u: TeamUser) {
    if (!window.confirm(`Sign ${u.name} out on every phone and computer? They sign in again with their password or a code.`)) return;
    setRowError(null);
    setBusyId(u.id);
    try {
      await send(`/api/admin/users/${u.id}`, "PATCH", { signOut: true });
      setRowError({ id: u.id, text: `${u.name} is signed out everywhere.` });
    } catch (e) {
      setRowError({ id: u.id, text: errText(e) });
    } finally {
      setBusyId(null);
    }
  }

  async function assignAgent(retailerId: string, salesAgentProfileId: string) {
    setRowError(null);
    try {
      await send(`/api/admin/retailers/${retailerId}/assign-agent`, "POST", { salesAgentId: salesAgentProfileId || null });
      reload();
    } catch (e) {
      setRowError({ id: retailerId, text: errText(e) });
    }
  }

  return (
    <div className="space-y-6">
      <div>
        <p className="page-kick">Team</p>
        <h1 className="page-title">Staff</h1>
        <p className="page-sub">
          Sales agents, delivery agents and supervisors. Supervisors see their own team in{" "}
          <Link href="/team" className="font-semibold underline">
            Field team
          </Link>
          .
        </p>
      </div>

      <div className="card p-4 space-y-3">
        <p className="text-sm font-semibold">Add staff</p>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Full name">
            <input className="input" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
          </Field>
          <Field label="Role">
            <select className="input" value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value as Role })}>
              {ROLES.map((r) => (
                <option key={r.role} value={r.role}>
                  {r.label}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Login ID">
            <input className="input" autoCapitalize="none" value={form.loginId} onChange={(e) => setForm({ ...form, loginId: e.target.value })} />
          </Field>
          <Field label="Password">
            <input className="input" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} />
          </Field>
          <Field label="Mobile number (optional)" hint={PHONE_HINT}>
            <input
              className="input"
              inputMode="numeric"
              maxLength={10}
              placeholder="98765 43210"
              value={form.phone}
              onChange={(e) => setForm({ ...form, phone: e.target.value.replace(/\D/g, "").slice(0, 10) })}
            />
          </Field>
          {form.role !== "SUPERVISOR" && (
            <Field label="Supervisor" hint={supervisors.length ? undefined : "Add a supervisor first to build a team."}>
              <SupervisorSelect value={form.supervisorId} onChange={(id) => setForm({ ...form, supervisorId: id })} options={supervisors} />
            </Field>
          )}
        </div>
        {error && <p className="text-sm text-[#a8281e]">{error}</p>}
        <Flash text={flash} />
        <button onClick={createUser} disabled={loading} className="btn btn-kesar btn-sm">
          <Icon name="plus" className="h-4 w-4" />
          {loading ? "Adding…" : "Add"}
        </button>
      </div>

      <div className="space-y-3">
        <p className="text-sm font-semibold">Team members</p>
        <TabBar
          tabs={[
            { key: "all" as const, label: `All ${users.length}` },
            ...ROLES.map((r) => ({ key: r.role, label: `${r.plural} ${users.filter((u) => u.role === r.role).length}` })),
          ]}
          value={tab}
          onChange={setTab}
        />
        {loadError && <p className="text-sm text-[#a8281e]">{loadError}</p>}
        <Flash text={listFlash} />
        {shown.length === 0 ? (
          <div className="card p-4 text-sm text-[var(--muted)]">{users.length ? "No one with this role yet." : "No staff yet. Add your first person above."}</div>
        ) : (
          <div className="space-y-2">
            {shown.map((u) => (
              <div key={u.id} className="card p-3 space-y-2">
                <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                  <div className="min-w-0 space-y-1">
                    <div className="flex flex-wrap items-center gap-1.5">
                      <p className="text-sm font-bold truncate">{u.name}</p>
                      <RoleChip role={u.role} />
                    </div>
                    <p className="text-xs text-[var(--muted)] break-words">
                      {u.loginId ?? "No login ID"} ·{" "}
                      {u.phone ? (
                        <span className="inline-flex items-center gap-1">
                          <Icon name="phone" className="h-3 w-3" />
                          {showPhone(u.phone)}
                        </span>
                      ) : (
                        "No mobile"
                      )}
                    </p>
                    <p className="text-xs text-[var(--ink-2)]">
                      {u.role === "SUPERVISOR"
                        ? `Team of ${teamSize(u.id)}`
                        : u.supervisor
                          ? `Supervisor: ${u.supervisor.name}`
                          : "No supervisor"}
                    </p>
                  </div>
                  <div className="flex gap-2 shrink-0">
                    <button
                      type="button"
                      className="btn btn-quiet btn-sm min-h-[44px]"
                      onClick={() => {
                        setRowError(null);
                        setListFlash(null);
                        setEditing(u);
                      }}
                    >
                      <Icon name="edit" className="h-4 w-4" />
                      Edit
                    </button>
                    <button
                      type="button"
                      onClick={() => toggleActive(u)}
                      disabled={busyId === u.id}
                      aria-pressed={u.active}
                      className={`min-h-[44px] text-xs font-medium rounded-lg px-3 ${
                        u.active ? "bg-[var(--mint-tint)] text-[var(--mint-text)] font-bold" : "bg-black/5 text-foreground/50"
                      }`}
                    >
                      {busyId === u.id ? "…" : u.active ? "Active" : "Inactive"}
                    </button>
                    {u.active && (
                      <button
                        type="button"
                        onClick={() => signOutEverywhere(u)}
                        disabled={busyId === u.id}
                        className="min-h-[44px] text-xs font-medium rounded-lg px-3 bg-black/5 text-[var(--ink-2)]"
                        title="End their sessions on every device (a lost phone)"
                      >
                        Sign out
                      </button>
                    )}
                  </div>
                </div>
                {rowError?.id === u.id && <p className="text-xs text-[#a8281e]">{rowError.text}</p>}
              </div>
            ))}
          </div>
        )}
      </div>

      <div>
        <p className="text-sm font-semibold mb-2">Retailer → Sales agent assignment</p>
        {retailers.length === 0 ? (
          <div className="card p-4 text-sm text-[var(--muted)]">No retailers yet.</div>
        ) : (
          <div className="space-y-2">
            {retailers.map((r) => (
              <div key={r.id} className="card p-3 space-y-1">
                <div className="flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-sm font-medium truncate">{r.outletName}</p>
                    <p className="text-xs text-foreground/50">
                      {r.area.name}, {r.area.region.name}
                    </p>
                  </div>
                  <select
                    className="text-xs rounded-lg border border-black/10 px-2 py-1.5 min-h-[44px] shrink-0 max-w-[45%]"
                    defaultValue={r.salesAgent?.id ?? ""}
                    onChange={(e) => assignAgent(r.id, e.target.value)}
                  >
                    <option value="">Unassigned</option>
                    {salesAgents.map((a) => (
                      <option key={a.salesAgentProfile?.id ?? a.id} value={a.salesAgentProfile?.id}>
                        {a.name}
                      </option>
                    ))}
                  </select>
                </div>
                {rowError?.id === r.id && <p className="text-xs text-[#a8281e]">{rowError.text}</p>}
              </div>
            ))}
          </div>
        )}
      </div>

      {editing && (
        <EditStaff
          key={editing.id}
          user={editing}
          supervisors={supervisors}
          onClose={() => setEditing(null)}
          onSaved={(name) => {
            setEditing(null);
            setListFlash(`${name} saved`);
            reload();
          }}
        />
      )}
    </div>
  );
}

function EditStaff({
  user,
  supervisors,
  onClose,
  onSaved,
}: {
  user: TeamUser;
  supervisors: TeamUser[];
  onClose: () => void;
  onSaved: (name: string) => void;
}) {
  const [name, setName] = useState(user.name);
  const [phone, setPhone] = useState(user.phone ?? "");
  const [supervisorId, setSupervisorId] = useState(user.supervisorId ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Keep the current supervisor in the list even if they are no longer active.
  const options = supervisors.filter((s) => s.id !== user.id).map((s) => ({ id: s.id, name: s.name }));
  if (user.supervisor && !options.some((o) => o.id === user.supervisor?.id)) options.push(user.supervisor);

  async function save() {
    setError(null);
    const patch: { name?: string; phone?: string | null; supervisorId?: string | null } = {};
    if (!name.trim()) return setError("Enter a name");
    if (name.trim() !== user.name) patch.name = name.trim();
    if (phone && !validMobile(phone)) return setError("Enter a 10-digit mobile number");
    if (phone !== (user.phone ?? "")) patch.phone = phone || null;
    if (user.role !== "SUPERVISOR" && supervisorId !== (user.supervisorId ?? "")) patch.supervisorId = supervisorId || null;
    if (!Object.keys(patch).length) return onClose();
    setBusy(true);
    try {
      await send(`/api/admin/users/${user.id}`, "PATCH", patch);
      onSaved(name.trim());
    } catch (e) {
      setError(errText(e));
      setBusy(false);
    }
  }

  return (
    <Sheet
      title={`Edit ${user.name}`}
      onClose={onClose}
      footer={
        <div className="space-y-2">
          {error && <p className="text-sm text-[#a8281e]">{error}</p>}
          <div className="flex gap-2 justify-end">
            <button type="button" className="btn btn-quiet btn-sm" onClick={onClose} disabled={busy}>
              Cancel
            </button>
            <button type="button" className="btn btn-kesar btn-sm" onClick={save} disabled={busy}>
              {busy ? "Saving…" : "Save"}
            </button>
          </div>
        </div>
      }
    >
      <div className="flex flex-wrap items-center gap-1.5 text-xs text-[var(--muted)]">
        <RoleChip role={user.role} />
        <span>Login ID: {user.loginId ?? "none"}</span>
      </div>
      <Field label="Full name">
        <input className="input" value={name} onChange={(e) => setName(e.target.value)} />
      </Field>
      <Field label="Mobile number" hint={`${PHONE_HINT} Leave blank to remove.`}>
        <input
          className="input"
          inputMode="numeric"
          maxLength={10}
          placeholder="98765 43210"
          value={phone}
          onChange={(e) => setPhone(e.target.value.replace(/\D/g, "").slice(0, 10))}
        />
      </Field>
      {user.role !== "SUPERVISOR" ? (
        <Field label="Supervisor" hint={options.length ? "Their supervisor sees their day, visits and leave." : "Add a supervisor first to build a team."}>
          <SupervisorSelect value={supervisorId} onChange={setSupervisorId} options={options} />
        </Field>
      ) : (
        <p className="text-xs text-[var(--muted)]">To build this supervisor&apos;s team, edit each sales or delivery agent and pick them as supervisor.</p>
      )}
    </Sheet>
  );
}
