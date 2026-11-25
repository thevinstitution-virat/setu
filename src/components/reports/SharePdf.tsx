"use client";

import { useState } from "react";
import Icon from "@/components/Icon";

/**
 * PDF · CSV · WhatsApp for a report. On a phone WhatsApp gets the PDF itself
 * through the share sheet; on a computer the PDF is saved and WhatsApp opens
 * with the summary, to attach it there.
 */
export default function SharePdf({ url, file, summary }: { url: string; file: string; summary: string }) {
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState("");
  const join = url.includes("?") ? "&" : "?";

  async function share() {
    setBusy(true);
    setNote("");
    try {
      const res = await fetch(`${url}${join}format=pdf`);
      if (!res.ok) throw new Error((await res.json().catch(() => null))?.error ?? "Could not make the PDF");
      const blob = await res.blob();
      const pdf = new File([blob], `${file}.pdf`, { type: "application/pdf" });
      if (typeof navigator !== "undefined" && navigator.canShare?.({ files: [pdf] })) {
        await navigator.share({ files: [pdf], title: file, text: summary });
      } else {
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
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      <a className="btn btn-outline btn-xs" href={`${url}${join}format=pdf`} target="_blank" rel="noreferrer">
        <Icon name="file" className="h-3.5 w-3.5" /> PDF
      </a>
      <a className="btn btn-outline btn-xs" href={`${url}${join}format=csv`} download>
        <Icon name="download" className="h-3.5 w-3.5" /> CSV
      </a>
      <button type="button" className="btn btn-outline btn-xs" disabled={busy} onClick={share}>
        <Icon name="share" className="h-3.5 w-3.5" /> {busy ? "Making…" : "WhatsApp"}
      </button>
      {note && <p className="w-full text-xs text-[var(--muted)]">{note}</p>}
    </div>
  );
}
