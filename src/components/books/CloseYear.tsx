"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import Icon from "@/components/Icon";
import { errText, send } from "@/components/admin/AdminKit";

const showDay = (d: string) => d.split("-").reverse().join("/");

/** Close a financial year: the books are locked up to 31 March (only the owner can open them again). */
export default function CloseYear({ to, fy, ready }: { to: string; fy: string; ready: boolean }) {
  const router = useRouter();
  const [ask, setAsk] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function go() {
    setBusy(true);
    setErr(null);
    try {
      await send("/api/admin/books/lock", "POST", { until: to });
      setAsk(false);
      router.refresh();
    } catch (e) {
      setErr(errText(e));
    } finally {
      setBusy(false);
    }
  }

  if (!ask)
    return (
      <button type="button" className="btn btn-mor btn-sm" onClick={() => setAsk(true)}>
        <Icon name="lock" className="h-4 w-4" /> Close FY {fy}
      </button>
    );
  return (
    <div className="rounded-xl bg-ink/5 p-3 space-y-3 max-w-lg">
      <p className="text-sm text-[var(--ink-2)]">
        Nothing can be entered or cancelled on or before {showDay(to)} after this; only the owner can open those days again.
        {ready ? "" : " Some steps above are not done yet."}
      </p>
      {err && <p className="text-sm text-[#a8281e]">{err}</p>}
      <div className="flex gap-2">
        <button type="button" className="btn btn-mor btn-sm" disabled={busy} onClick={go}>
          {busy ? "Closing…" : `Yes, close up to ${showDay(to)}`}
        </button>
        <button type="button" className="btn btn-quiet btn-sm" disabled={busy} onClick={() => setAsk(false)}>
          Back
        </button>
      </div>
    </div>
  );
}
