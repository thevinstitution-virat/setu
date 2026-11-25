"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import Icon from "@/components/Icon";
import { errText, fileUrl, send, uploadImage } from "@/components/admin/AdminKit";
import { uploadFile } from "@/lib/upload-client";

const isPdf = (key: string) => /\.pdf$/i.test(key);
const MAX = 10;

/** Photos or a PDF of the supplier's bill: add (camera or file), open, remove. Keys are uploaded at once; the bill keeps them when saved. */
export function ScanPicker({ value, onChange, disabled }: { value: string[]; onChange: (keys: string[]) => void; disabled?: boolean }) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function add(files: FileList | null) {
    if (!files?.length) return;
    setErr(null);
    setBusy(true);
    const keys = [...value];
    try {
      for (const f of Array.from(files)) {
        if (keys.length >= MAX) throw new Error(`At most ${MAX} scans on a bill`);
        if (f.type === "application/pdf") {
          if (f.size > 10 * 1024 * 1024) throw new Error(`${f.name} is larger than 10 MB`);
          keys.push(await uploadFile(f, "purchase-bill"));
        } else if (f.type.startsWith("image/")) keys.push(await uploadImage(f, "purchase-bill", 2200));
        else throw new Error(`${f.name}: use a photo or a PDF`);
      }
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      onChange(keys);
      setBusy(false);
    }
  }

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap gap-2">
        {value.map((k, i) => (
          <span key={k} className="relative">
            <a href={fileUrl(k)} target="_blank" rel="noreferrer" className="grid h-16 w-16 place-items-center overflow-hidden rounded-xl border border-[var(--line)] bg-white text-xs font-semibold text-[var(--ink-2)]" title={`Scan ${i + 1}`}>
              {isPdf(k) ? (
                <span className="grid place-items-center gap-0.5">
                  <Icon name="file" className="h-5 w-5" />
                  PDF
                </span>
              ) : (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={fileUrl(k)} alt={`Scan ${i + 1}`} className="h-full w-full object-cover" loading="lazy" />
              )}
            </a>
            {!disabled && (
              <button
                type="button"
                className="absolute -right-1.5 -top-1.5 grid h-6 w-6 place-items-center rounded-full bg-ink text-white"
                aria-label={`Remove scan ${i + 1}`}
                onClick={() => onChange(value.filter((x) => x !== k))}
              >
                <Icon name="x" className="h-3 w-3" />
              </button>
            )}
          </span>
        ))}
        {!disabled && value.length < MAX && (
          <label className={`grid h-16 w-16 cursor-pointer place-items-center rounded-xl border border-dashed border-[var(--line)] text-xs font-semibold text-[var(--ink-2)] ${busy ? "opacity-60" : ""}`}>
            <span className="grid place-items-center gap-0.5">
              <Icon name={busy ? "clock" : "upload"} className="h-5 w-5" />
              {busy ? "Adding" : "Add"}
            </span>
            <input type="file" accept="image/*,application/pdf" multiple className="sr-only" disabled={busy} onChange={(e) => void add(e.target.files).then(() => (e.target.value = ""))} />
          </label>
        )}
      </div>
      {err && <p className="text-sm text-[var(--risk-text)]">{err}</p>}
    </div>
  );
}

/** On a saved bill: change its scans (saved straight away). */
export function BillScans({ id, scans, canEdit }: { id: string; scans: string[]; canEdit: boolean }) {
  const router = useRouter();
  const [keys, setKeys] = useState(scans);
  const [err, setErr] = useState<string | null>(null);
  async function save(next: string[]) {
    const before = keys;
    setKeys(next);
    setErr(null);
    try {
      await send(`/api/admin/books/purchases/${id}`, "PATCH", { scans: next });
      router.refresh();
    } catch (e) {
      setKeys(before);
      setErr(errText(e));
    }
  }
  if (!canEdit && !keys.length) return <p className="text-sm text-[var(--muted)]">No scan of the bill.</p>;
  return (
    <div className="space-y-1">
      <ScanPicker value={keys} onChange={(k) => void save(k)} disabled={!canEdit} />
      {err && <p className="text-sm text-[var(--risk-text)]">{err}</p>}
    </div>
  );
}
