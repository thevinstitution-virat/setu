"use client";

import { useEffect, useState } from "react";

type Region = { id: string; name: string; areas: { id: string; name: string }[] };

export default function AdminRegionsPage() {
  const [regions, setRegions] = useState<Region[]>([]);
  const [newRegion, setNewRegion] = useState("");
  const [newArea, setNewArea] = useState<Record<string, string>>({});

  async function load() {
    const d = await fetch("/api/regions").then((r) => r.json());
    setRegions(d.regions ?? []);
  }

  useEffect(() => {
    load();
  }, []);

  async function addRegion() {
    if (!newRegion.trim()) return;
    await fetch("/api/regions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: newRegion.trim() }),
    });
    setNewRegion("");
    await load();
  }

  async function addArea(regionId: string) {
    const name = newArea[regionId]?.trim();
    if (!name) return;
    await fetch("/api/areas", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name, regionId }),
    });
    setNewArea({ ...newArea, [regionId]: "" });
    await load();
  }

  return (
    <div className="space-y-6">
      <h1 className="text-xl font-semibold">Regions &amp; areas</h1>

      <div className="card p-4 flex gap-2">
        <input className="input" placeholder="New region name" value={newRegion} onChange={(e) => setNewRegion(e.target.value)} />
        <button onClick={addRegion} className="shrink-0 rounded-xl bg-brand text-white font-medium px-4 py-2 text-sm">
          Add
        </button>
      </div>

      <div className="space-y-3">
        {regions.map((r) => (
          <div key={r.id} className="card p-4 space-y-3">
            <p className="font-semibold text-sm">{r.name}</p>
            <div className="flex flex-wrap gap-2">
              {r.areas.map((a) => (
                <span key={a.id} className="text-xs rounded-full bg-black/5 px-3 py-1">
                  {a.name}
                </span>
              ))}
            </div>
            <div className="flex gap-2">
              <input
                className="input"
                placeholder="New area in this region"
                value={newArea[r.id] ?? ""}
                onChange={(e) => setNewArea({ ...newArea, [r.id]: e.target.value })}
              />
              <button
                onClick={() => addArea(r.id)}
                className="shrink-0 rounded-xl bg-black/5 font-medium px-4 py-2 text-sm"
              >
                Add area
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
