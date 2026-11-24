"use client";

import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useState } from "react";
import Icon from "@/components/Icon";

type Opt = { id: string; name: string };
type Props = {
  view: "bills" | "parties" | "agents" | "collections";
  options: { areas: Opt[]; salesmen: Opt[]; beats: (Opt & { weekdays: number[] })[] };
  today: string;
  /** Text that goes with the PDF on WhatsApp. */
  summary: string;
  file: string;
};

const DAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const VIEWS = [
  { key: "bills", label: "Bill-wise" },
  { key: "parties", label: "Party-wise" },
  { key: "agents", label: "Salesman-wise" },
] as const;
const FILTER_KEYS = ["areaId", "salesmanId", "beatId", "weekday"] as const;

const addDay = (day: string, n: number) => new Date(Date.parse(`${day}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);

/** Report switch, dates, area / salesman / beat / day filters, and Print · CSV · WhatsApp. All state lives in the URL. */
export default function DuesToolbar({ view, options, today, summary, file }: Props) {
  const path = usePathname();
  const sp = useSearchParams();
  const router = useRouter();
  const [sharing, setSharing] = useState(false);
  const [note, setNote] = useState("");
  const collections = view === "collections";

  const set = (changes: Record<string, string | null>) => {
    const q = new URLSearchParams(sp);
    for (const [k, v] of Object.entries(changes)) {
      if (v) q.set(k, v);
      else q.delete(k);
    }
    router.push(`${path}${q.toString() ? `?${q}` : ""}`);
  };

  const keep = new URLSearchParams();
  for (const k of [...FILTER_KEYS, "asOn"]) if (sp.get(k)) keep.set(k, sp.get(k)!);
  const api = (format: "pdf" | "csv") => {
    const q = new URLSearchParams(sp);
    q.delete("view");
    q.set("format", format);
    return `/api/admin/reports/dues/${view}?${q}`;
  };

  async function share() {
    setSharing(true);
    setNote("");
    try {
      const res = await fetch(api("pdf"));
      if (!res.ok) throw new Error((await res.json().catch(() => null))?.error ?? "Could not make the PDF");
      const blob = await res.blob();
      const pdf = new File([blob], `${file}.pdf`, { type: "application/pdf" });
      if (typeof navigator !== "undefined" && navigator.canShare?.({ files: [pdf] })) {
        // On a phone: the share sheet, where WhatsApp takes the PDF itself.
        await navigator.share({ files: [pdf], title: file, text: summary });
      } else {
        // On a computer: save the PDF, open WhatsApp with the summary; attach the file there.
        const a = document.createElement("a");
        a.href = URL.createObjectURL(blob);
        a.download = `${file}.pdf`;
        a.click();
        URL.revokeObjectURL(a.href);
        window.open(`https://wa.me/?text=${encodeURIComponent(summary)}`, "_blank", "noopener");
        setNote("PDF saved. Attach it in the WhatsApp chat that just opened.");
      }
    } catch (e) {
      if ((e as Error).name !== "AbortError") setNote((e as Error).message);
    } finally {
      setSharing(false);
    }
  }

  const sel = "input !py-1.5 !text-sm mt-1 block min-w-36";
  const from = sp.get("from") ?? today;
  const to = sp.get("to") ?? today;

  return (
    <div className="card p-3 space-y-3 print:hidden">
      {!collections && (
        <nav className="flex gap-1.5 overflow-x-auto" aria-label="Outstanding report">
          {VIEWS.map((v) => {
            const q = new URLSearchParams(keep);
            if (v.key !== "bills") q.set("view", v.key);
            const active = v.key === view;
            return (
              <Link
                key={v.key}
                href={`${path}${q.toString() ? `?${q}` : ""}`}
                aria-current={active ? "page" : undefined}
                className={`shrink-0 rounded-full px-3 py-1 text-xs font-semibold border ${active ? "border-[var(--kesar)] bg-[var(--kesar-tint)] text-[var(--kesar-text)]" : "border-[var(--line)] bg-white/60 text-foreground/70 hover:bg-white"}`}
              >
                {v.label}
              </Link>
            );
          })}
        </nav>
      )}

      <div className="flex flex-wrap items-end gap-2">
        {collections ? (
          <>
            <label className="text-xs text-[var(--muted)]">
              From
              <input type="date" className={sel} value={from} max={to} onChange={(e) => e.target.value && set({ from: e.target.value, to: e.target.value > to ? e.target.value : to })} />
            </label>
            <label className="text-xs text-[var(--muted)]">
              To
              <input type="date" className={sel} value={to} min={from} max={today} onChange={(e) => e.target.value && set({ from: from > e.target.value ? e.target.value : from, to: e.target.value })} />
            </label>
            <div className="flex gap-1 pb-0.5">
              <button className="btn btn-outline btn-xs" onClick={() => set({ from: null, to: null })}>
                Today
              </button>
              <button className="btn btn-outline btn-xs" onClick={() => set({ from: addDay(today, -1), to: addDay(today, -1) })}>
                Yesterday
              </button>
              <button className="btn btn-outline btn-xs" onClick={() => set({ from: `${today.slice(0, 7)}-01`, to: today })}>
                This month
              </button>
            </div>
          </>
        ) : (
          <label className="text-xs text-[var(--muted)]">
            As on
            <input type="date" className={sel} value={sp.get("asOn") ?? today} max={today} onChange={(e) => set({ asOn: e.target.value && e.target.value !== today ? e.target.value : null })} />
          </label>
        )}
        <label className="text-xs text-[var(--muted)]">
          Area
          <select className={sel} value={sp.get("areaId") ?? ""} onChange={(e) => set({ areaId: e.target.value || null })}>
            <option value="">All areas</option>
            {options.areas.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name}
              </option>
            ))}
          </select>
        </label>
        <label className="text-xs text-[var(--muted)]">
          Salesman
          <select className={sel} value={sp.get("salesmanId") ?? ""} onChange={(e) => set({ salesmanId: e.target.value || null })}>
            <option value="">Everyone</option>
            {options.salesmen.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name}
              </option>
            ))}
          </select>
        </label>
        {options.beats.length > 0 && (
          <>
            <label className="text-xs text-[var(--muted)]">
              Beat
              <select className={sel} value={sp.get("beatId") ?? ""} onChange={(e) => set({ beatId: e.target.value || null })}>
                <option value="">All beats</option>
                {options.beats.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="text-xs text-[var(--muted)]">
              Beat day
              <select className={sel} value={sp.get("weekday") ?? ""} onChange={(e) => set({ weekday: e.target.value || null })}>
                <option value="">Any day</option>
                {DAYS.map((d, i) => (
                  <option key={d} value={i}>
                    {d}
                  </option>
                ))}
              </select>
            </label>
          </>
        )}

        <div className="flex flex-wrap gap-1.5 ml-auto pb-0.5">
          <a href={api("pdf")} target="_blank" rel="noopener" className="btn btn-outline btn-sm">
            <Icon name="file" className="h-4 w-4" /> Print (PDF)
          </a>
          <a href={api("csv")} download className="btn btn-outline btn-sm">
            <Icon name="download" className="h-4 w-4" /> CSV
          </a>
          <button onClick={share} disabled={sharing} className="btn btn-mor btn-sm">
            <Icon name="share" className="h-4 w-4" /> {sharing ? "Making PDF…" : "WhatsApp"}
          </button>
        </div>
      </div>
      {note && <p className="text-xs text-[var(--muted)]">{note}</p>}
    </div>
  );
}
