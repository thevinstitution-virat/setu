"use client";

import { useRef, useState } from "react";
import Icon from "@/components/Icon";
import { Thumb, errText, uploadImage } from "@/components/admin/AdminKit";

/** Up to `max` photos for a complaint: each one is shrunk and uploaded as soon as it is picked. */
export default function PhotoPicker({
  value,
  onChange,
  max = 4,
  onBusy,
}: {
  value: string[];
  onChange: (keys: string[]) => void;
  max?: number;
  onBusy?: (busy: boolean) => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const input = useRef<HTMLInputElement>(null);

  async function pick(files: FileList | null) {
    if (!files?.length) return;
    const room = max - value.length;
    const list = Array.from(files).slice(0, room);
    setBusy(true);
    onBusy?.(true);
    setError(null);
    const keys = [...value];
    try {
      for (const f of list) keys.push(await uploadImage(f, "ticket-photo"));
      if (files.length > room) setError(`Only ${max} photos can be added`);
    } catch (e) {
      setError(errText(e));
    } finally {
      onChange(keys);
      setBusy(false);
      onBusy?.(false);
      if (input.current) input.current.value = "";
    }
  }

  return (
    <div className="space-y-1.5">
      <div className="flex flex-wrap gap-2">
        {value.map((k) => (
          <span key={k} className="relative">
            <Thumb imageKey={k} className="h-16 w-16" />
            <button
              type="button"
              className="absolute -top-1.5 -right-1.5 grid place-items-center h-6 w-6 rounded-full bg-ink text-white shadow"
              aria-label="Remove photo"
              onClick={() => onChange(value.filter((v) => v !== k))}
            >
              <Icon name="x" className="h-3.5 w-3.5" />
            </button>
          </span>
        ))}
        {value.length < max && (
          <button
            type="button"
            disabled={busy}
            onClick={() => input.current?.click()}
            className="h-16 w-16 rounded-xl border border-dashed border-[var(--line)] bg-white/70 text-[var(--muted)] grid place-items-center text-[11px] font-semibold"
          >
            <span className="flex flex-col items-center gap-0.5">
              <Icon name="image" className="h-5 w-5" />
              {busy ? "Adding…" : "Add photo"}
            </span>
          </button>
        )}
      </div>
      <input
        ref={input}
        type="file"
        accept="image/jpeg,image/png,image/webp"
        multiple
        className="hidden"
        onChange={(e) => pick(e.target.files)}
      />
      {error && <p className="text-xs text-[#a8281e]">{error}</p>}
    </div>
  );
}
