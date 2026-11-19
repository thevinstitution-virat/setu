"use client";

import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useState } from "react";
import Icon from "@/components/Icon";
import { PRESETS, type Preset } from "@/lib/report-periods";

const TABS = [
  { href: "/admin/reports", label: "Overview", kind: "dashboard" },
  { href: "/admin/reports/sales", label: "Sales", kind: "sales" },
  { href: "/admin/reports/shops", label: "Shops", kind: "retailers" },
  { href: "/admin/reports/team", label: "Team", kind: "team" },
  { href: "/admin/reports/schemes", label: "Schemes", kind: "schemes" },
  { href: "/admin/reports/routes", label: "Routes", kind: "routes" },
  { href: "/admin/reports/returns", label: "Returns", kind: "returns" },
] as const;

const SHOWN: Preset[] = ["today", "7d", "30d", "mtd", "last_month", "90d", "fy"];

/** Tabs, period chips, custom dates and the CSV download; the period rides along in the URL. */
export default function ReportNav() {
  const path = usePathname();
  const sp = useSearchParams();
  const router = useRouter();
  const custom = sp.get("from") && sp.get("to");
  const preset = custom ? null : ((sp.get("preset") as Preset) ?? "30d");
  const [open, setOpen] = useState(!!custom);
  const [from, setFrom] = useState(sp.get("from") ?? "");
  const [to, setTo] = useState(sp.get("to") ?? "");

  const query = (() => {
    const q = new URLSearchParams();
    if (custom) {
      q.set("from", sp.get("from")!);
      q.set("to", sp.get("to")!);
    } else if (preset && preset !== "30d") q.set("preset", preset);
    return q;
  })();
  const qs = query.toString() ? `?${query}` : "";
  const tab = TABS.find((t) => (t.href === "/admin/reports" ? path === t.href : path.startsWith(t.href))) ?? TABS[0];
  const onShop = path.startsWith("/admin/reports/shops/");
  const csv = `/api/admin/reports/${tab.kind}?${new URLSearchParams([...query.entries(), ["format", "csv"]])}`;

  const go = (q: URLSearchParams) => router.push(`${path}${q.toString() ? `?${q}` : ""}`);

  return (
    <div className="space-y-3">
      <nav className="flex gap-1.5 overflow-x-auto pb-1" aria-label="Reports">
        {TABS.map((t) => {
          const active = t === tab;
          return (
            <Link
              key={t.href}
              href={`${t.href}${qs}`}
              aria-current={active ? "page" : undefined}
              className={`shrink-0 rounded-full px-3.5 py-1.5 text-sm font-semibold ${active ? "bg-gradient-to-br from-mor to-[#0c3634] text-white" : "bg-black/5 text-foreground/70 hover:bg-black/10"}`}
            >
              {t.label}
            </Link>
          );
        })}
      </nav>
      <div className="flex flex-wrap items-center gap-1.5">
        {SHOWN.map((p) => (
          <button
            key={p}
            onClick={() => {
              setOpen(false);
              go(new URLSearchParams(p === "30d" ? [] : [["preset", p]]));
            }}
            className={`rounded-full px-3 py-1 text-xs font-medium border ${preset === p ? "border-[var(--kesar)] bg-[var(--kesar-tint)] text-[var(--kesar-text)]" : "border-[var(--line)] bg-white/60 text-foreground/70 hover:bg-white"}`}
          >
            {PRESETS[p]}
          </button>
        ))}
        <button onClick={() => setOpen((v) => !v)} className={`rounded-full px-3 py-1 text-xs font-medium border ${custom ? "border-[var(--kesar)] bg-[var(--kesar-tint)] text-[var(--kesar-text)]" : "border-[var(--line)] bg-white/60 text-foreground/70 hover:bg-white"}`}>
          Pick dates
        </button>
        {!onShop && (
          <a href={csv} className="btn btn-outline btn-xs ml-auto" download>
            <Icon name="upload" className="h-3.5 w-3.5 rotate-180" /> CSV
          </a>
        )}
      </div>
      {open && (
        <form
          className="flex flex-wrap items-end gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            if (from && to) go(new URLSearchParams([["from", from], ["to", to]]));
          }}
        >
          <label className="text-xs text-[var(--muted)]">
            From
            <input type="date" className="input !py-1.5 mt-1 block" value={from} max={to || undefined} onChange={(e) => setFrom(e.target.value)} required />
          </label>
          <label className="text-xs text-[var(--muted)]">
            To
            <input type="date" className="input !py-1.5 mt-1 block" value={to} min={from || undefined} onChange={(e) => setTo(e.target.value)} required />
          </label>
          <button className="btn btn-mor btn-sm">Show</button>
          <p className="text-xs text-[var(--muted)] w-full">Up to a year. Days are Indian time.</p>
        </form>
      )}
    </div>
  );
}
