"use client";

import { useRef, useState } from "react";
import Icon from "@/components/Icon";
import { errText, fileUrl, uploadImage } from "@/components/admin/AdminKit";

/**
 * Front-camera photo for check in / out. Phones open the selfie camera
 * (capture="user"); desktops fall back to a file picker. The photo is shrunk
 * to 720 px and uploaded at once; the parent gets the upload key.
 */
export default function SelfieCapture({
  value,
  onChange,
  onBusy,
  label = "Take a selfie",
}: {
  value: string | null;
  onChange: (key: string | null) => void;
  onBusy?: (busy: boolean) => void;
  label?: string;
}) {
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function pick(file: File | undefined) {
    if (!file) return;
    setBusy(true);
    onBusy?.(true);
    setError(null);
    try {
      onChange(await uploadImage(file, "selfie", 720));
    } catch (e) {
      setError(errText(e));
    } finally {
      setBusy(false);
      onBusy?.(false);
      if (input.current) input.current.value = "";
    }
  }

  return (
    <div className="space-y-1.5">
      <div className="flex items-center gap-3">
        {value ? (
          <span className="h-16 w-16 shrink-0 rounded-2xl overflow-hidden border border-[var(--line)] bg-white block">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={fileUrl(value)} alt="Your selfie" className="h-full w-full object-cover" />
          </span>
        ) : (
          <span className="h-16 w-16 shrink-0 rounded-2xl bg-ink/5 text-[var(--muted)] grid place-items-center">
            <Icon name="user" className="h-6 w-6 opacity-60" />
          </span>
        )}
        <div className="min-w-0 flex-1 space-y-1">
          <button
            type="button"
            className="btn btn-quiet btn-sm min-h-[44px]"
            disabled={busy}
            onClick={() => input.current?.click()}
          >
            <Icon name="image" className="h-4 w-4" />
            {busy ? "Uploading…" : value ? "Take again" : label}
          </button>
          {value && !busy && <p className="text-xs text-[var(--success-text)]">Selfie ready</p>}
        </div>
        <input
          ref={input}
          type="file"
          accept="image/*"
          capture="user"
          className="hidden"
          onChange={(e) => pick(e.target.files?.[0])}
        />
      </div>
      {error && <p className="text-xs text-[var(--risk-text)]">{error}</p>}
    </div>
  );
}
