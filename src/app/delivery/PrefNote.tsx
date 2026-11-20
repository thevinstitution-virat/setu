import { PREF_LABEL } from "@/lib/delivery-settings";

/** How the shop wants goods handed over, and its note for the driver. */
export default function PrefNote({ pref, note }: { pref: string | null; note: string | null }) {
  const label = pref && pref in PREF_LABEL ? PREF_LABEL[pref as keyof typeof PREF_LABEL] : null;
  if (!label && !note) return null;
  return (
    <p className="rounded-xl bg-[var(--genda-tint)] text-[var(--genda-text)] px-3 py-2 text-sm">
      {label && <b>{label}</b>}
      {label && note && " · "}
      {note}
    </p>
  );
}
