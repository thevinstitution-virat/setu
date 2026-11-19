"use client";

import { useState } from "react";
import Icon from "@/components/Icon";
import { ErrorBox, useFetch } from "@/components/admin/AdminKit";
import CopyButton from "@/components/admin/CopyButton";
import { Section } from "./kit";

type Kit = {
  appId: string;
  appName: string;
  shortName: string;
  serverUrl: string;
  themeColor: string;
  splashBackground: string;
  iconUrl: string | null;
  capacitorConfig: Record<string, unknown>;
};

/** Build settings for the business's own Android app. */
export default function TenantAndroid({ tenantId, slug }: { tenantId: string; slug: string }) {
  const [open, setOpen] = useState(false);
  const { data, error, reload } = useFetch<{ allowed: boolean; kit: Kit }>(open ? `/api/platform/tenants/${tenantId}/android` : null);
  const json = data ? JSON.stringify(data.kit.capacitorConfig, null, 2) : "";

  function download() {
    const blob = new Blob([json + "\n"], { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `capacitor.config.${slug}.json`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  }

  return (
    <Section
      title="Android app kit"
      sub="Values for this business's own branded Android build."
      right={
        !open && (
          <button type="button" className="btn btn-quiet btn-xs" onClick={() => setOpen(true)}>
            Show
          </button>
        )
      }
    >
      {open && error && <ErrorBox message={error} onRetry={reload} />}
      {open && !data && !error && <p className="text-sm text-[var(--muted)]">Loading…</p>}
      {data && (
        <div className="space-y-3">
          {!data.allowed && (
            <p className="text-sm rounded-xl bg-[var(--genda-tint)] text-[var(--genda-text)] px-3 py-2">
              The android module is not on for this business. Turn it on (plan or override) before you build.
            </p>
          )}
          <dl className="grid gap-x-4 gap-y-1.5 text-sm sm:grid-cols-[140px_1fr]">
            <dt className="text-[var(--muted)]">Package</dt>
            <dd className="font-mono break-all">{data.kit.appId}</dd>
            <dt className="text-[var(--muted)]">App name</dt>
            <dd>
              {data.kit.appName} <span className="text-[var(--muted)]">({data.kit.shortName})</span>
            </dd>
            <dt className="text-[var(--muted)]">Address</dt>
            <dd className="font-mono break-all">{data.kit.serverUrl}</dd>
            <dt className="text-[var(--muted)]">Colours</dt>
            <dd className="flex flex-wrap items-center gap-3">
              {[data.kit.themeColor, data.kit.splashBackground].map((c, i) => (
                <span key={i} className="inline-flex items-center gap-1.5 font-mono text-xs">
                  <span className="h-4 w-4 rounded border border-[var(--line)]" style={{ background: c }} aria-hidden="true" />
                  {i === 0 ? "theme" : "splash"} {c}
                </span>
              ))}
            </dd>
            <dt className="text-[var(--muted)]">Icon</dt>
            <dd className="break-all">
              {data.kit.iconUrl ? (
                <a className="font-mono text-xs text-[var(--mor)] hover:underline" href={data.kit.iconUrl} target="_blank" rel="noreferrer">
                  {data.kit.iconUrl}
                </a>
              ) : (
                <span className="text-[var(--muted)]">No logo uploaded; the default icon is used</span>
              )}
            </dd>
          </dl>
          <div className="flex flex-wrap items-center gap-2">
            <p className="text-sm font-semibold flex-1">capacitor.config.json</p>
            <CopyButton text={json} />
            <button type="button" className="btn btn-quiet btn-xs" onClick={download}>
              <Icon name="download" className="h-3.5 w-3.5" /> Download
            </button>
          </div>
          <pre className="rounded-xl bg-ink/5 p-3 text-xs font-mono overflow-x-auto max-h-80">{json}</pre>
        </div>
      )}
    </Section>
  );
}
