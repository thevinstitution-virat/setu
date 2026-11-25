"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { errText, Field, send } from "@/components/admin/AdminKit";
import { COUNT_MODE_HINT, COUNT_MODE_LABEL } from "@/lib/stock-count-labels";

type Opt = { id: string; name: string };
const todayIst = () => new Date(Date.now() + 5.5 * 3_600_000).toISOString().slice(0, 10);
const chip = (on: boolean) => `rounded-full px-3.5 py-1.5 text-sm font-semibold ${on ? "bg-ink text-white" : "bg-black/5 text-foreground/70"}`;

/** Pick the day and what is counted; the sheet is made from the app's stock (tracking on) or every product / company (off). */
export default function StartCountForm({ tracking, places, companies, categories }: { tracking: boolean; places: (Opt & { isDefault: boolean })[]; companies: Opt[]; categories: Opt[] }) {
  const router = useRouter();
  const [date, setDate] = useState(todayIst());
  const [mode, setMode] = useState<"QUANTITY" | "VALUE">("QUANTITY");
  const [place, setPlace] = useState(places.find((p) => p.isDefault)?.id ?? places[0]?.id ?? "");
  const [company, setCompany] = useState("");
  const [category, setCategory] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function go(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const r = await send<{ count: { id: string } }>("/api/admin/books/stock/counts", "POST", {
        date,
        ...(tracking ? { locationId: place, supplierId: company || null, categoryId: category || null } : { mode }),
        note: note.trim() || null,
      });
      router.push(`/admin/books/stock/counts/${r.count.id}`);
    } catch (err) {
      setError(errText(err));
      setBusy(false);
    }
  }

  return (
    <form onSubmit={go} className="card p-4 sm:p-5 space-y-4 max-w-xl">
      <div>
        <h2 className="font-heading text-xl font-bold text-[var(--ink)]">Start a stock count</h2>
        <p className="text-sm text-[var(--ink-2)] mt-1">{COUNT_MODE_HINT[tracking ? "TRACKED" : mode]}</p>
      </div>
      <Field label="Day counted" hint="Count at the end of this day (or before the next day starts).">
        <input type="date" className="input" value={date} max={todayIst()} onChange={(e) => setDate(e.target.value)} required />
      </Field>
      {tracking ? (
        <>
          <Field label="Place">
            <select className="input" value={place} onChange={(e) => setPlace(e.target.value)} required>
              {places.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </Field>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Company (optional)">
              <select className="input" value={company} onChange={(e) => setCompany(e.target.value)}>
                <option value="">All companies</option>
                {companies.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Category (optional)">
              <select className="input" value={category} onChange={(e) => setCategory(e.target.value)}>
                <option value="">All categories</option>
                {categories.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
            </Field>
          </div>
        </>
      ) : (
        <div className="flex flex-wrap gap-2" role="radiogroup" aria-label="How to count">
          {(["QUANTITY", "VALUE"] as const).map((m) => (
            <button key={m} type="button" role="radio" aria-checked={mode === m} className={chip(mode === m)} onClick={() => setMode(m)}>
              {COUNT_MODE_LABEL[m]}
            </button>
          ))}
        </div>
      )}
      <Field label="Note (optional)">
        <input className="input" value={note} maxLength={200} onChange={(e) => setNote(e.target.value)} placeholder="e.g. Year-end count, Ramesh and Suresh" />
      </Field>
      {error && <p className="text-sm text-[var(--risk-text)]">{error}</p>}
      <button type="submit" className="btn btn-mor" disabled={busy || (tracking && !place)}>
        {busy ? "Making the sheet…" : "Make the count sheet"}
      </button>
    </form>
  );
}
