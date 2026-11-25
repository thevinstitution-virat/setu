"use client";

import { useEffect, useState } from "react";
import Icon from "@/components/Icon";

export type SpotShop = { id: string; outletName: string; ownerName: string; area: string; pinCode: string };

/** Step 1: find the shop by name, owner, area or PIN code. Once picked, a short card with "Change". */
export default function ShopPicker({
  shop,
  onPickAction,
}: {
  shop: SpotShop | null;
  onPickAction: (s: SpotShop | null) => void;
}) {
  const [q, setQ] = useState("");
  const [found, setFound] = useState<{ q: string; shops: SpotShop[] } | null>(null);
  const [error, setError] = useState<{ q: string; message: string } | null>(null);
  const [nonce, setNonce] = useState(0);
  const needle = q.trim();

  useEffect(() => {
    if (shop) return;
    const ctrl = new AbortController();
    const t = setTimeout(async () => {
      try {
        const res = await fetch(`/api/delivery/retailers?q=${encodeURIComponent(needle)}`, { signal: ctrl.signal });
        const d = await res.json().catch(() => ({}));
        if (ctrl.signal.aborted) return;
        if (!res.ok) return setError({ q: needle, message: d.error ?? "Could not load shops" });
        setFound({ q: needle, shops: (d.retailers ?? []) as SpotShop[] });
        setError(null);
      } catch {
        if (!ctrl.signal.aborted) setError({ q: needle, message: "Network error while loading shops." });
      }
    }, needle ? 300 : 0);
    return () => {
      clearTimeout(t);
      ctrl.abort();
    };
  }, [needle, shop, nonce]);

  if (shop) {
    return (
      <div className="flex items-center gap-3">
        <span className="icon-tile bg-[var(--success-tint)] text-[var(--success-text)]">
          <Icon name="home" />
        </span>
        <div className="flex-1 min-w-0">
          <p className="font-bold break-words">{shop.outletName}</p>
          <p className="text-xs text-[var(--muted)] truncate">
            {[shop.ownerName, shop.area, shop.pinCode].filter(Boolean).join(" · ")}
          </p>
        </div>
        <button type="button" className="btn btn-quiet shrink-0" onClick={() => onPickAction(null)}>
          Change
        </button>
      </div>
    );
  }

  const shops = found?.shops ?? [];
  const stale = !found || found.q !== needle;
  const err = error && error.q === needle ? error.message : null;

  return (
    <div className="space-y-3">
      <div className="relative">
        <Icon name="search" className="h-4 w-4 absolute left-3 top-1/2 -translate-y-1/2 text-[var(--muted)] pointer-events-none" />
        <input
          className="input !pl-9 !min-h-[48px]"
          type="search"
          enterKeyHint="search"
          placeholder="Shop, owner, area or PIN"
          aria-label="Find the shop"
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
      </div>

      {err ? (
        <div className="space-y-2">
          <p className="text-sm text-[var(--risk-text)]">{err}</p>
          <button type="button" className="btn btn-outline btn-sm" onClick={() => setNonce((n) => n + 1)}>
            Try again
          </button>
        </div>
      ) : !found ? (
        <p className="text-sm text-[var(--muted)]">Loading shops…</p>
      ) : shops.length === 0 && !stale ? (
        <p className="text-sm text-[var(--muted)]">{needle ? "No shop matches. Try another name or the PIN code." : "No shops yet."}</p>
      ) : (
        <ul className={`divide-y divide-[var(--line)] transition-opacity ${stale ? "opacity-60" : ""}`}>
          {shops.map((s) => (
            <li key={s.id}>
              <button
                type="button"
                className="w-full min-h-[56px] py-2.5 flex items-center gap-3 text-left"
                onClick={() => onPickAction(s)}
              >
                <span className="flex-1 min-w-0">
                  <span className="block text-sm font-semibold break-words">{s.outletName}</span>
                  <span className="block text-xs text-[var(--muted)] truncate">
                    {[s.ownerName, s.area, s.pinCode].filter(Boolean).join(" · ")}
                  </span>
                </span>
                <Icon name="chevronRight" className="h-4 w-4 shrink-0 text-[var(--muted)]" />
              </button>
            </li>
          ))}
        </ul>
      )}
      {!err && found && shops.length === 20 && (
        <p className="text-xs text-[var(--muted)]">Showing the first 20. Type more of the name to narrow it down.</p>
      )}
    </div>
  );
}
