"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import Icon from "@/components/Icon";
import { BrandMark } from "@/components/BrandMark";

const LINKS = [
  { href: "/platform", label: "Tenants" },
  { href: "/platform/invoices", label: "Invoices" },
  { href: "/platform/plans", label: "Plans" },
  { href: "/platform/announcements", label: "Announcements" },
  { href: "/platform/usage", label: "Usage" },
  { href: "/platform/health", label: "Health" },
  { href: "/platform/audit", label: "Audit" },
  { href: "/platform/security", label: "Security" },
];

function isActive(path: string, href: string) {
  if (href === "/platform") return path === "/platform" || path.startsWith("/platform/tenants");
  return path === href || path.startsWith(`${href}/`);
}

/** Top bar of the console: links, who is signed in, sign out. */
export default function PlatformNav({ name, role }: { name: string; role: string }) {
  const path = usePathname();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function signOut() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/platform/auth/logout", { method: "POST" });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error ?? "Could not sign out");
      window.location.assign(data.redirect ?? "/platform/login");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not sign out");
      setBusy(false);
    }
  }

  return (
    <header className="border-b border-[var(--line)] bg-white/70 backdrop-blur sticky top-0 z-30">
      <div className="mx-auto max-w-6xl px-4 py-2.5 flex flex-wrap items-center gap-x-4 gap-y-2">
        <Link href="/platform" className="flex items-center gap-2 shrink-0">
          <BrandMark size={30} />
          <span className="font-heading font-bold leading-none">
            VBiz Pro console
            <span className="block text-[11px] font-bold text-[var(--accent-text)] mt-0.5">Platform</span>
          </span>
        </Link>
        <div className="ml-auto flex items-center gap-2 min-w-0 sm:order-3">
          <span className="text-right min-w-0">
            <span className="block text-sm font-semibold truncate max-w-[140px] sm:max-w-[200px]">{name}</span>
            <span className="block text-[11px] font-bold text-[var(--muted)]">{role === "OWNER" ? "Owner" : "Support"}</span>
          </span>
          <button type="button" className="btn btn-quiet btn-xs" onClick={signOut} disabled={busy}>
            <Icon name="logout" className="h-3.5 w-3.5" />
            {busy ? "Signing out…" : "Sign out"}
          </button>
        </div>
        <nav className="w-full sm:w-auto sm:flex-1 overflow-x-auto -mx-4 px-4 sm:mx-0 sm:px-0 sm:order-2" aria-label="Console">
          <ul className="flex gap-1 whitespace-nowrap">
            {LINKS.map((l) => {
              const on = isActive(path, l.href);
              return (
                <li key={l.href}>
                  <Link
                    href={l.href}
                    aria-current={on ? "page" : undefined}
                    className={`block rounded-xl px-3 py-1.5 text-sm font-bold transition ${on ? "bg-[var(--mor)] text-white" : "text-[var(--ink-2)] hover:bg-black/5"}`}
                  >
                    {l.label}
                  </Link>
                </li>
              );
            })}
          </ul>
        </nav>
        {error && <p className="w-full text-sm text-[var(--risk-text)] sm:order-4">{error}</p>}
      </div>
    </header>
  );
}
