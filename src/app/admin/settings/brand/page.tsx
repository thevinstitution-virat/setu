"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import Icon from "@/components/Icon";
import { Field, ImageField, Toggle } from "@/components/admin/AdminKit";
import { BrandPreview, ColourField } from "@/components/saas/BrandPreview";
import { ErrorLine, UpgradeNote, getJson, jsonInit } from "@/components/saas/SaasKit";
import { DEFAULT_COLOURS, normHex, type Brand } from "@/lib/branding";

type BrandView = { brand: Brand; businessName?: string; whiteLabel: boolean; defaults: typeof DEFAULT_COLOURS; logoUrl: string | null; iconUrl: string | null };
type FieldError = { field: string; message: string };
type Check = { ok: boolean; errors: FieldError[] };

type Form = {
  appName: string;
  shortName: string;
  tagline: string;
  logoKey: string | null;
  iconKey: string | null;
  primary: string;
  accent: string;
  surface: string;
  invAccent: string;
  invFooter: string;
  invShowLogo: boolean;
  smsSenderId: string;
  whatsappName: string;
  emailFromName: string;
  replyTo: string;
};

function toForm(b: Brand): Form {
  return {
    appName: b.appName ?? "",
    shortName: b.shortName ?? "",
    tagline: b.tagline ?? "",
    logoKey: b.logoKey ?? null,
    iconKey: b.iconKey ?? null,
    primary: b.primary ?? "",
    accent: b.accent ?? "",
    surface: b.surface ?? "",
    invAccent: b.invoice?.accent ?? "",
    invFooter: b.invoice?.footer ?? "",
    invShowLogo: b.invoice?.showLogo ?? false,
    smsSenderId: b.sender?.smsSenderId ?? "",
    whatsappName: b.sender?.whatsappName ?? "",
    emailFromName: b.sender?.emailFromName ?? "",
    replyTo: b.sender?.replyTo ?? "",
  };
}

/**
 * The PUT body. Without the white-label module only names, the invoice
 * footer and sender names are sent (logo, colours and the invoice look would
 * be refused with 402).
 */
function toBody(f: Form, whiteLabel: boolean): Record<string, unknown> {
  const body: Record<string, unknown> = {
    appName: f.appName,
    shortName: f.shortName,
    tagline: f.tagline,
    sender: { smsSenderId: f.smsSenderId, whatsappName: f.whatsappName, emailFromName: f.emailFromName, replyTo: f.replyTo },
    invoice: whiteLabel ? { footer: f.invFooter, accent: f.invAccent.trim() || null, showLogo: f.invShowLogo } : { footer: f.invFooter },
  };
  if (whiteLabel) {
    Object.assign(body, {
      logoKey: f.logoKey,
      iconKey: f.iconKey,
      primary: f.primary.trim() || null,
      accent: f.accent.trim() || null,
      surface: f.surface.trim() || null,
    });
  }
  return body;
}

export default function BrandPage() {
  const router = useRouter();
  const [view, setView] = useState<BrandView | null>(null);
  const [saved, setSaved] = useState<Form | null>(null);
  const [form, setForm] = useState<Form | null>(null);
  const [whiteLabel, setWhiteLabel] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [checkErrors, setCheckErrors] = useState<FieldError[]>([]);
  const [checking, setChecking] = useState(false);
  const [checkProblem, setCheckProblem] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [savedAt, setSavedAt] = useState<Date | null>(null);
  const seq = useRef(0);

  async function load() {
    const r = await getJson<BrandView>("/api/admin/brand");
    setLoadError(null);
    if (!r.ok) {
      setLoadError(r.error);
      return;
    }
    setView(r.data);
    setWhiteLabel(r.data.whiteLabel);
    const f = toForm(r.data.brand);
    setSaved(f);
    setForm(f);
  }

  useEffect(() => {
    load();
  }, []);

  const dirty = !!form && !!saved && JSON.stringify(form) !== JSON.stringify(saved);

  // Ask the server to check the colours and fields while editing (nothing is saved).
  useEffect(() => {
    if (!form || !dirty) {
      seq.current++;
      return;
    }
    const n = ++seq.current;
    const ctl = new AbortController();
    const t = setTimeout(async () => {
      setChecking(true);
      const r = await getJson<Check>("/api/admin/brand?check=1", { ...jsonInit("PUT", toBody(form, whiteLabel)), signal: ctl.signal });
      if (n !== seq.current) return;
      setChecking(false);
      if (r.ok) {
        setCheckErrors(r.data.errors ?? []);
        setCheckProblem(null);
      } else if (r.status === 402) {
        setWhiteLabel(false);
      } else if (r.status !== 0) {
        setCheckProblem(r.error);
      }
    }, 450);
    return () => {
      clearTimeout(t);
      ctl.abort();
    };
  }, [form, dirty, whiteLabel]);

  if (loadError)
    return (
      <div className="max-w-2xl space-y-3">
        <ErrorLine text={loadError} />
        <button type="button" className="btn btn-quiet btn-sm" onClick={load}>
          Try again
        </button>
      </div>
    );
  if (!form || !saved || !view) return <p className="text-sm text-[var(--muted)]">Loading…</p>;

  const defaults = view.defaults ?? DEFAULT_COLOURS;
  const shownErrors = dirty ? checkErrors : [];
  const errFor = (field: string) => shownErrors.find((e) => e.field === field)?.message ?? null;
  const set = <K extends keyof Form>(k: K, v: Form[K]) => {
    setForm({ ...form, [k]: v });
    setSaveError(null);
    setSavedAt(null);
  };
  const colours = {
    primary: normHex(form.primary) ?? defaults.primary,
    accent: normHex(form.accent) ?? defaults.accent,
    surface: normHex(form.surface) ?? defaults.surface,
  };
  const usingDefaults = !form.primary.trim() && !form.accent.trim() && !form.surface.trim();
  const blocked = shownErrors.length > 0;
  const isChecking = dirty && checking;

  async function save(e: React.FormEvent) {
    e.preventDefault();
    if (!form) return;
    setBusy(true);
    setSaveError(null);
    const r = await getJson<BrandView>("/api/admin/brand", jsonInit("PUT", toBody(form, whiteLabel)));
    setBusy(false);
    if (!r.ok) {
      if (r.status === 402) setWhiteLabel(false);
      const errs = (r.data.errors as FieldError[] | undefined) ?? [];
      if (errs.length) setCheckErrors(errs);
      setSaveError(r.error);
      return;
    }
    setView(r.data);
    setWhiteLabel(r.data.whiteLabel);
    const f = toForm(r.data.brand);
    setSaved(f);
    setForm(f);
    setSavedAt(new Date());
    // The shell (name, logo, colours) is drawn on the server.
    router.refresh();
  }

  const lockNote = !whiteLabel && (
    <UpgradeNote title="Your own logo and colours are not in your plan">
      Names and sender names below still apply. Move to a plan with white-label to use your logo, colours and invoice look.
    </UpgradeNote>
  );

  return (
    <form onSubmit={save} className="space-y-5 pb-28">
      <div>
        <Link href="/admin/settings" className="text-xs font-bold text-[var(--accent-text)] inline-flex items-center gap-1">
          <Icon name="chevronLeft" className="h-3.5 w-3.5" /> Settings
        </Link>
        <h1 className="page-title">Brand</h1>
        <p className="page-sub">Your name, logo and colours on the app, the phone icon, invoices and messages.</p>
      </div>

      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_340px] items-start">
        <div className="space-y-5 min-w-0">
          <section className="card p-5 space-y-4">
            <p className="font-heading font-bold">Names</p>
            <Field label="App name" hint={`Shown at the top of the app and on the sign-in page. ${form.appName.length}/40`}>
              <input className="input" maxLength={40} value={form.appName} placeholder={view?.businessName || "Your business name"} onChange={(e) => set("appName", e.target.value)} />
            </Field>
            <ErrorLine text={errFor("appName")} />
            <div className="grid sm:grid-cols-2 gap-4">
              <Field label="Short name" hint={`Under the icon on a phone. ${form.shortName.length}/12`}>
                <input className="input" maxLength={12} value={form.shortName} onChange={(e) => set("shortName", e.target.value)} />
              </Field>
              <Field label="Sign-in line" hint="A short line under your name on the sign-in page.">
                <input className="input" maxLength={120} value={form.tagline} onChange={(e) => set("tagline", e.target.value)} />
              </Field>
            </div>
            <ErrorLine text={errFor("shortName") ?? errFor("tagline")} />
          </section>

          <section className="card p-5 space-y-4">
            <p className="font-heading font-bold flex items-center gap-2">
              {!whiteLabel && <Icon name="lock" className="h-4 w-4" />} Logo and app icon
            </p>
            {lockNote}
            <fieldset disabled={!whiteLabel} className={`space-y-4 ${!whiteLabel ? "opacity-60" : ""}`}>
              <div>
                <span className="block text-sm font-medium text-[var(--ink-2)] mb-1.5">Logo</span>
                {whiteLabel ? (
                  <ImageField value={form.logoKey} onChange={(k) => set("logoKey", k)} kind="brand-logo" maxSide={1024} wide />
                ) : (
                  <p className="text-sm text-[var(--muted)]">{form.logoKey ? "A logo is saved but not shown on your plan." : "No logo."}</p>
                )}
                <span className="block text-xs text-[var(--muted)] mt-1">PNG with a clear background works best. Up to 3 MB.</span>
                <ErrorLine text={errFor("logoKey")} />
              </div>
              <div>
                <span className="block text-sm font-medium text-[var(--ink-2)] mb-1.5">Phone icon (optional)</span>
                {whiteLabel ? (
                  <ImageField value={form.iconKey} onChange={(k) => set("iconKey", k)} kind="brand-icon" maxSide={1024} />
                ) : (
                  <p className="text-sm text-[var(--muted)]">{form.iconKey ? "An icon is saved but not shown on your plan." : "No icon."}</p>
                )}
                <span className="block text-xs text-[var(--muted)] mt-1">A square picture, at least 512 × 512. Leave it empty to use the logo.</span>
                <ErrorLine text={errFor("iconKey")} />
              </div>
            </fieldset>
          </section>

          <section className="card p-5 space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="font-heading font-bold flex items-center gap-2">
                {!whiteLabel && <Icon name="lock" className="h-4 w-4" />} Colours
              </p>
              {whiteLabel && (
                <button
                  type="button"
                  className="btn btn-quiet btn-xs"
                  disabled={usingDefaults}
                  onClick={() => setForm({ ...form, primary: "", accent: "", surface: "" })}
                >
                  Reset to default colours
                </button>
              )}
            </div>
            {!whiteLabel && <p className="text-sm text-[var(--muted)]">Locked on your plan. The app uses the standard colours.</p>}
            <fieldset disabled={!whiteLabel} className={`grid sm:grid-cols-3 gap-4 ${!whiteLabel ? "opacity-60" : ""}`}>
              <ColourField label="Main colour" hint="Header, menu and links. White text sits on it." value={form.primary} fallback={defaults.primary} onChange={(v) => set("primary", v)} error={errFor("primary")} />
              <ColourField label="Button colour" hint="Main buttons like Place order." value={form.accent} fallback={defaults.accent} onChange={(v) => set("accent", v)} error={errFor("accent")} />
              <ColourField label="Background" hint="Behind every page. Keep it light." value={form.surface} fallback={defaults.surface} onChange={(v) => set("surface", v)} error={errFor("surface")} />
            </fieldset>
            {whiteLabel && (
              <p className="text-xs text-[var(--muted)] flex items-center gap-1.5">
                {isChecking ? "Checking that text stays readable…" : blocked ? "Fix the colours marked in red to save." : dirty ? "Text stays readable with these colours." : "Leave a box empty to use the standard colour."}
              </p>
            )}
            <ErrorLine text={dirty ? checkProblem : null} />
          </section>

          <section className="card p-5 space-y-4">
            <p className="font-heading font-bold">Invoices</p>
            <Field label="Invoice footer" hint={`Printed at the bottom of every invoice, like bank details or terms. ${form.invFooter.length}/300`}>
              <textarea className="input min-h-[84px]" maxLength={300} value={form.invFooter} onChange={(e) => set("invFooter", e.target.value)} />
            </Field>
            <ErrorLine text={errFor("invoice.footer")} />
            <fieldset disabled={!whiteLabel} className={`space-y-4 ${!whiteLabel ? "opacity-60" : ""}`}>
              <div className="grid sm:grid-cols-2 gap-4 items-start">
                <ColourField label="Invoice colour" hint="Empty: the main colour." value={form.invAccent} fallback={colours.primary} onChange={(v) => set("invAccent", v)} error={errFor("invoice.accent")} disabled={!whiteLabel} />
                <div className="sm:pt-7">
                  <Toggle checked={form.invShowLogo} onChange={(v) => set("invShowLogo", v)} label="Logo on invoices" disabled={!whiteLabel} hint={!whiteLabel ? "Not in your plan" : undefined} />
                </div>
              </div>
            </fieldset>
          </section>

          <section className="card p-5 space-y-4">
            <div>
              <p className="font-heading font-bold">Who messages come from</p>
              <p className="text-sm text-[var(--muted)] mt-1">The names shops see on SMS, WhatsApp and email sent by the app.</p>
            </div>
            <div className="grid sm:grid-cols-2 gap-4">
              <Field label="SMS sender id" hint="Exactly 6 letters, as registered on DLT.">
                <input
                  className="input font-mono uppercase"
                  maxLength={6}
                  value={form.smsSenderId}
                  onChange={(e) => set("smsSenderId", e.target.value.toUpperCase().replace(/[^A-Z]/g, ""))}
                />
              </Field>
              <Field label="WhatsApp name">
                <input className="input" maxLength={40} value={form.whatsappName} onChange={(e) => set("whatsappName", e.target.value)} />
              </Field>
              <Field label="Email from name">
                <input className="input" maxLength={40} value={form.emailFromName} onChange={(e) => set("emailFromName", e.target.value)} />
              </Field>
              <Field label="Reply-to email" hint="Replies to app emails go here.">
                <input className="input" type="email" maxLength={120} value={form.replyTo} onChange={(e) => set("replyTo", e.target.value)} />
              </Field>
            </div>
            <ErrorLine text={errFor("sender.smsSenderId") ?? errFor("sender.whatsappName") ?? errFor("sender.emailFromName") ?? errFor("sender.replyTo")} />
          </section>
        </div>

        <aside className="space-y-3 lg:sticky lg:top-20 min-w-0">
          <p className="text-sm font-bold text-[var(--ink-2)]">Preview</p>
          <BrandPreview
            appName={form.appName || view?.businessName || ""}
            shortName={form.shortName}
            tagline={form.tagline}
            logoKey={whiteLabel ? form.logoKey : null}
            iconKey={whiteLabel ? form.iconKey : null}
            colours={whiteLabel ? colours : { ...DEFAULT_COLOURS }}
          />
        </aside>
      </div>

      <div className="sticky bottom-3 z-10">
        <div className="card p-3 flex flex-wrap items-center gap-3 max-w-2xl">
          <button type="submit" className="btn btn-primary" disabled={!dirty || busy || blocked || isChecking}>
            {busy ? "Saving…" : "Save brand"}
          </button>
          {dirty && (
            <button type="button" className="btn btn-quiet" disabled={busy} onClick={() => setForm(saved)}>
              Undo changes
            </button>
          )}
          <div className="min-w-0 flex-1">
            {saveError ? (
              <ErrorLine text={saveError} />
            ) : savedAt ? (
              <p className="text-sm text-[var(--success-text)] flex items-center gap-1.5">
                <Icon name="check" className="h-4 w-4" /> Saved. Everyone sees it on their next page.
              </p>
            ) : !dirty ? (
              <p className="text-sm text-[var(--muted)]">No changes.</p>
            ) : null}
          </div>
        </div>
      </div>
    </form>
  );
}
