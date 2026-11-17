"use client";

import { useEffect, useState } from "react";

type TeamUser = {
  id: string;
  name: string;
  loginId: string | null;
  role: "SALES_AGENT" | "DELIVERY_AGENT";
  active: boolean;
  salesAgentProfile: { id: string } | null;
};

type Retailer = {
  id: string;
  outletName: string;
  area: { name: string; region: { name: string } };
  salesAgent: { id: string; user: { name: string } } | null;
};

export default function AdminTeamPage() {
  const [users, setUsers] = useState<TeamUser[]>([]);
  const [retailers, setRetailers] = useState<Retailer[]>([]);
  const [salesAgents, setSalesAgents] = useState<TeamUser[]>([]);
  const [form, setForm] = useState({ name: "", loginId: "", password: "", role: "SALES_AGENT" as const });
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function load() {
    const d = await fetch("/api/admin/users").then((r) => r.json());
    setUsers(d.users ?? []);
    setRetailers(d.retailers ?? []);
    setSalesAgents((d.users ?? []).filter((u: TeamUser) => u.role === "SALES_AGENT"));
  }

  useEffect(() => {
    load();
  }, []);

  async function createUser() {
    setError(null);
    if (!form.name || !form.loginId || !form.password) {
      setError("Fill in all fields");
      return;
    }
    setLoading(true);
    try {
      const res = await fetch("/api/admin/users", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      setForm({ name: "", loginId: "", password: "", role: "SALES_AGENT" });
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong");
    } finally {
      setLoading(false);
    }
  }

  async function toggleActive(u: TeamUser) {
    await fetch(`/api/admin/users/${u.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ active: !u.active }),
    });
    await load();
  }

  async function assignAgent(retailerId: string, salesAgentProfileId: string) {
    await fetch(`/api/admin/retailers/${retailerId}/assign-agent`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ salesAgentId: salesAgentProfileId || null }),
    });
    await load();
  }

  return (
    <div className="space-y-6">
      <h1 className="text-xl font-semibold">Team</h1>

      <div className="card p-4 space-y-3">
        <p className="text-sm font-semibold">Add sales or delivery agent</p>
        <div className="grid grid-cols-2 gap-2">
          <input className="input" placeholder="Full name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
          <input className="input" placeholder="Login ID" value={form.loginId} onChange={(e) => setForm({ ...form, loginId: e.target.value })} />
          <input className="input" placeholder="Password" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} />
          <select className="input" value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value as "SALES_AGENT" })}>
            <option value="SALES_AGENT">Sales agent</option>
            <option value="DELIVERY_AGENT">Delivery agent</option>
          </select>
        </div>
        {error && <p className="text-sm text-red-600">{error}</p>}
        <button onClick={createUser} disabled={loading} className="rounded-xl bg-brand text-white font-medium px-4 py-2 text-sm">
          {loading ? "Adding…" : "Add"}
        </button>
      </div>

      <div>
        <p className="text-sm font-semibold mb-2">Team members</p>
        <div className="space-y-2">
          {users.map((u) => (
            <div key={u.id} className="card p-3 flex items-center justify-between">
              <div>
                <p className="text-sm font-medium">{u.name}</p>
                <p className="text-xs text-foreground/50">
                  {u.loginId} · {u.role === "SALES_AGENT" ? "Sales agent" : "Delivery agent"}
                </p>
              </div>
              <button
                onClick={() => toggleActive(u)}
                className={`text-xs font-medium rounded-lg px-3 py-1.5 ${
                  u.active ? "bg-emerald-100 text-emerald-800" : "bg-black/5 text-foreground/50"
                }`}
              >
                {u.active ? "Active" : "Inactive"}
              </button>
            </div>
          ))}
        </div>
      </div>

      <div>
        <p className="text-sm font-semibold mb-2">Retailer → Sales agent assignment</p>
        <div className="space-y-2">
          {retailers.map((r) => (
            <div key={r.id} className="card p-3 flex items-center justify-between gap-3">
              <div className="min-w-0">
                <p className="text-sm font-medium truncate">{r.outletName}</p>
                <p className="text-xs text-foreground/50">
                  {r.area.name}, {r.area.region.name}
                </p>
              </div>
              <select
                className="text-xs rounded-lg border border-black/10 px-2 py-1.5 shrink-0"
                defaultValue={r.salesAgent?.id ?? ""}
                onChange={(e) => assignAgent(r.id, e.target.value)}
              >
                <option value="">Unassigned</option>
                {salesAgents.map((a) => (
                  <option key={a.salesAgentProfile?.id} value={a.salesAgentProfile?.id}>
                    {a.name}
                  </option>
                ))}
              </select>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
