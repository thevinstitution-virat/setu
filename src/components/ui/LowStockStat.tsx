"use client";

import { useFetch } from "@/components/admin/AdminKit";
import StatCard from "@/components/ui/StatCard";

/** "Low-stock SKUs" stat for the owner's overview; reads the same alerts as the stock strip. */
export default function LowStockStat() {
  const { data } = useFetch<{ alerts: { reorder: number } | null }>("/api/stock/alerts");
  const n = data?.alerts?.reorder;
  return (
    <StatCard
      tone={n ? "risk" : "neutral"}
      label="Low-stock SKUs"
      value={n === undefined ? "–" : String(n)}
      delta={data?.alerts ? (n ? "Reorder from the principal →" : "Nothing to reorder") : "Stock tracking is off"}
      href={data?.alerts ? "/admin/stock?filter=low" : "/admin/stock"}
    />
  );
}
