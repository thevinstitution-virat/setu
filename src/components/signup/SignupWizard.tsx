"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { BrandLockup } from "@/components/BrandMark";
import Icon from "@/components/Icon";
import { STATES, isStateCode, normaliseGstin, validGstin } from "@/lib/gst";
import { Field, FormError, Progress, fieldProps } from "./ui";
import { PlanCards, type PlanChoice, type SignupPlan } from "./PlanCards";

/**
 * Self-serve sign-up on the platform address (/start). Five steps kept in
 * this component's state; only the last one creates anything:
 *
 *   0 Business   name, legal name, GSTIN (→ state), state, address, owner, mobile
 *   1 Address    <slug>.<domain>, suggested from the name, checked live
 *   2 Plan       the plan to move to after the free trial (or decide later)
 *   3 Verify     OTP to the mobile (POST /api/signup/otp, then /verify)
 *   4 Create     owner login id + password, terms → POST /api/signup → welcome link
 */

const STEPS = ["Business", "Web address", "Plan", "Verify mobile", "Create"] as const;

/** Same rule as SLUG_RE in lib/signup (that module is server-only). */
const SLUG_RE = /^[a-z0-9](?:[a-z0-9-]{1,28}[a-z0-9])$/;
const LOGIN_ID_RE = /^[a-z0-9._-]{3,40}$/;
const MOBILE_RE = /^[6-9]\d{9}$/;

/** Which step shows the error for a field the server names. */
const FIELD_STEP: Record<string, number> = {
  businessName: 0,
  legalName: 0,
  gstin: 0,
  stateCode: 0,
  address: 0,
  ownerName: 0,
  slug: 1,
  planCode: 2,
  phone: 3,
  code: 3,
  loginId: 4,
  password: 4,
  acceptTerms: 4,
};

type Form = {
  businessName: string;
  legalName: string;
  gstin: string;
  stateCode: string;
  address: string;
  ownerName: string;
  phone: string;
  slug: string;
  plan: PlanChoice;
  loginId: string;
  password: string;
  acceptTerms: boolean;
};

const EMPTY: Form = {
  businessName: "",
  legalName: "",
  gstin: "",
  stateCode: "",
  address: "",
  ownerName: "",
  phone: "",
  slug: "",
  plan: "",
  loginId: "",
  password: "",
  acceptTerms: false,
};

type Errors = Partial<Record<keyof Form | "code" | "form", string>>;

/** A failed API call: the server's message and the field it is about. */
class ApiError extends Error {
  constructor(message: string, public field?: string, public status = 400) {
    super(message);
  }
}

async function api<T>(url: string, body?: unknown): Promise<T> {
  let res: Response;
  try {
    res = await fetch(url, body === undefined ? undefined : { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  } catch {
    throw new ApiError("No connection. Check the internet and try again.");
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new ApiError(typeof data.error === "string" ? data.error : "Something went wrong. Please try again.", data.field ?? undefined, res.status);
  return data as T;
}

type SlugCheck = { for: string; ok: boolean; problem: string | null; host: string };

/** Problems we can see without asking the server (it also checks reserved and taken). */
function localSlugProblem(s: string): string | null {
  if (!s) return "Pick a web address";
  if (!SLUG_RE.test(s)) return "Use 3–30 small letters, digits or dashes (not at the start or end)";
  if (s.includes("--")) return "Two dashes in a row are not allowed";
  return null;
}

/** GSTIN typed so far → a problem, or null when empty or valid. */
function gstinProblem(raw: string): string | null {
  const g = normaliseGstin(raw);
  if (!g) return null;
  if (g.length !== 15) return `A GSTIN has 15 characters (this has ${g.length})`;
  if (!isStateCode(g.slice(0, 2))) return `The first two digits (${g.slice(0, 2)}) are not a state code`;
  if (!validGstin(g)) return "This GSTIN is not valid (check the 15 characters)";
  return null;
}

const STATE_OPTIONS = Object.entries(STATES).sort((a, b) => a[1].localeCompare(b[1]));

/**
 * A new business address gets its certificate from the proxy a little after
 * sign-up (the server syncs new addresses every few seconds, then Let's Encrypt
 * issues). Until then the browser would show a certificate warning, so wait
 * until the address answers over a trusted connection. An opaque no-cors
 * response is enough: fetch only rejects on network or TLS failure.
 */
async function waitForAddress(url: string, maxMs = 90_000): Promise<void> {
  let origin: string;
  try {
    origin = new URL(url).origin;
  } catch {
    return;
  }
  const until = Date.now() + maxMs;
  while (Date.now() < until) {
    try {
      await fetch(`${origin}/api/health`, { mode: "no-cors", cache: "no-store", signal: AbortSignal.timeout(5_000) });
      return;
    } catch {
      await new Promise((r) => setTimeout(r, 2_000));
    }
  }
}

export default function SignupWizard({ domain }: { domain: string }) {
  const [step, setStep] = useState(0);
  const [form, setForm] = useState<Form>(EMPTY);
  const [errors, setErrors] = useState<Errors>({});
  const [busy, setBusy] = useState(false);
  const focusRef = useRef<string | null>(null);

  // Web address
  const [slugTouched, setSlugTouched] = useState(false);
  const [suggestedFor, setSuggestedFor] = useState<string | null>(null);
  const [slugCheck, setSlugCheck] = useState<SlugCheck | null>(null);

  // Plans
  const [plans, setPlans] = useState<{ trialDays: number; plans: SignupPlan[] } | null>(null);
  const [plansError, setPlansError] = useState<string | null>(null);

  // Mobile check
  const [challenge, setChallenge] = useState<{ id: string; phone: string; devCode: string | null } | null>(null);
  const [verifiedPhone, setVerifiedPhone] = useState<string | null>(null);
  const [code, setCode] = useState("");

  // Done
  const [made, setMade] = useState<{ url: string; host: string } | null>(null);
  const [showPassword, setShowPassword] = useState(false);

  const set = <K extends keyof Form>(k: K, v: Form[K]) => {
    setForm((f) => ({ ...f, [k]: v }));
    setErrors((e) => (e[k] || e.form ? { ...e, [k]: undefined, form: undefined } : e));
  };

  const gstin = normaliseGstin(form.gstin);
  const gstinState = gstin.length >= 2 && isStateCode(gstin.slice(0, 2)) ? gstin.slice(0, 2) : null;
  const stateCode = gstinState ?? form.stateCode;
  const verified = verifiedPhone !== null && verifiedPhone === form.phone;

  // Move focus to the field with the error after a jump between steps.
  useEffect(() => {
    const id = focusRef.current;
    if (!id) return;
    focusRef.current = null;
    document.getElementById(`f-${id}`)?.focus();
  }, [step, errors]);

  // Plans, once.
  useEffect(() => {
    let live = true;
    api<{ trialDays: number; plans: SignupPlan[] }>("/api/signup/plans")
      .then((d) => live && setPlans(d))
      .catch((e: unknown) => live && setPlansError(e instanceof Error ? e.message : "Could not load the plans"));
    return () => {
      live = false;
    };
  }, []);

  // Web address: suggest one from the name until the owner types their own; check what they type.
  useEffect(() => {
    if (step !== 1) return;
    let live = true;
    const name = form.businessName.trim();
    if (!slugTouched && suggestedFor !== name) {
      api<SlugCheck & { slug: string }>(`/api/signup/slug?name=${encodeURIComponent(name)}`)
        .then((r) => {
          if (!live) return;
          setSuggestedFor(name);
          setForm((f) => ({ ...f, slug: r.slug }));
          setSlugCheck({ for: r.slug, ok: r.ok, problem: r.problem, host: r.host });
        })
        .catch(() => {
          // No suggestion: let the owner type one.
          if (!live) return;
          setSuggestedFor(name);
          setSlugTouched(true);
        });
      return () => {
        live = false;
      };
    }
    const s = form.slug;
    if (localSlugProblem(s) || slugCheck?.for === s) return;
    const timer = window.setTimeout(() => {
      api<SlugCheck & { slug: string }>(`/api/signup/slug?s=${encodeURIComponent(s)}`)
        .then((r) => live && setSlugCheck({ for: s, ok: r.ok, problem: r.problem, host: r.host }))
        .catch((e: unknown) => live && setSlugCheck({ for: s, ok: false, problem: e instanceof Error ? e.message : "Could not check", host: "" }));
    }, 350);
    return () => {
      live = false;
      window.clearTimeout(timer);
    };
  }, [step, form.slug, form.businessName, slugTouched, suggestedFor, slugCheck?.for]);

  const slugState = useMemo((): { kind: "idle" | "checking" | "ok" | "bad"; message?: string } => {
    const local = localSlugProblem(form.slug);
    if (!form.slug) return { kind: slugTouched ? "bad" : "checking", message: slugTouched ? local ?? undefined : undefined };
    if (local) return { kind: "bad", message: local };
    if (slugCheck?.for !== form.slug) return { kind: "checking" };
    return slugCheck.ok ? { kind: "ok" } : { kind: "bad", message: slugCheck.problem ?? "This address can't be used" };
  }, [form.slug, slugCheck, slugTouched]);

  /** Check one step on this side; returns the errors (empty = fine). */
  function check(n: number): Errors {
    const e: Errors = {};
    if (n === 0) {
      if (form.businessName.trim().length < 2) e.businessName = "Enter the business name";
      const g = gstinProblem(form.gstin);
      if (g) e.gstin = g;
      if (!stateCode) e.stateCode = "Pick the state the business is registered in";
      if (form.ownerName.trim().length < 2) e.ownerName = "Enter your name";
      if (!MOBILE_RE.test(form.phone)) e.phone = "Enter a 10-digit mobile number";
    }
    if (n === 1) {
      if (slugState.kind === "bad") e.slug = slugState.message ?? "Pick another address";
      else if (slugState.kind !== "ok") e.slug = "Checking the address. One moment…";
    }
    if (n === 2 && !form.plan) e.plan = "Pick a plan, or choose “Not sure yet”";
    if (n === 3 && !verified) e.code = challenge ? "Enter the code we sent and press Verify" : "Send a code to your mobile first";
    if (n === 4) {
      const id = form.loginId.trim().toLowerCase();
      if (!LOGIN_ID_RE.test(id)) e.loginId = "Login id: 3–40 small letters, digits, dot, dash or underscore";
      if (form.password.length < 10) e.password = "Password: at least 10 characters";
      else if (id && form.password.toLowerCase().includes(id)) e.password = "Password must not contain the login id";
      if (!form.acceptTerms) e.acceptTerms = "Please accept the terms and the privacy notice";
    }
    return e;
  }

  function show(e: Errors) {
    setErrors(e);
    const first = Object.keys(e)[0];
    if (first) focusRef.current = first === "plan" ? "planCode" : first;
  }

  function goTo(n: number) {
    setErrors({});
    if (n === 4 && !form.loginId) {
      const guess = (form.ownerName.trim().split(/\s+/)[0] ?? "").toLowerCase().replace(/[^a-z0-9._-]/g, "");
      if (guess.length >= 3) setForm((f) => ({ ...f, loginId: guess }));
    }
    setStep(n);
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  function next() {
    const e = check(step);
    if (Object.keys(e).length) return show(e);
    goTo(step + 1);
  }

  /** Send the error to its step and field; anything else stays on this step. */
  function fail(err: unknown) {
    const message = err instanceof Error ? err.message : "Something went wrong. Please try again.";
    const field = err instanceof ApiError ? err.field : undefined;
    const target = field !== undefined ? FIELD_STEP[field] : undefined;
    if (field && target !== undefined) {
      const key = (field === "planCode" ? "plan" : field) as keyof Errors;
      if (field === "slug") setSlugCheck({ for: form.slug, ok: false, problem: message, host: "" });
      if (field === "phone" && step === 4) {
        // The verified code ran out: check the mobile again.
        setVerifiedPhone(null);
        setChallenge(null);
        setCode("");
      }
      setStep(target);
      setErrors({ [key]: message });
      focusRef.current = field;
    } else {
      setErrors({ form: message });
    }
  }

  async function sendCode() {
    setErrors({});
    if (!MOBILE_RE.test(form.phone)) {
      setStep(0);
      show({ phone: "Enter a 10-digit mobile number" });
      return;
    }
    setBusy(true);
    try {
      const r = await api<{ challengeId: string; devCode?: string }>("/api/signup/otp", { phone: form.phone });
      setChallenge({ id: r.challengeId, phone: form.phone, devCode: r.devCode ?? null });
      setVerifiedPhone(null);
      setCode("");
      focusRef.current = "code";
      setErrors({});
    } catch (e) {
      // A phone error belongs next to the Send button here, not back on step 1.
      setErrors(e instanceof ApiError && e.field === "phone" ? { phone: e.message } : { form: e instanceof Error ? e.message : "Could not send the code" });
    } finally {
      setBusy(false);
    }
  }

  async function verifyCode() {
    setErrors({});
    if (!challenge) return;
    if (!/^\d{6}$/.test(code)) {
      show({ code: "Enter the 6-digit code" });
      return;
    }
    setBusy(true);
    try {
      const r = await api<{ ok: boolean; phone: string }>("/api/signup/verify", { challengeId: challenge.id, code });
      if (r.ok) setVerifiedPhone(challenge.phone);
    } catch (e) {
      setErrors(e instanceof ApiError && e.field === "code" ? { code: e.message } : { form: e instanceof Error ? e.message : "Could not check the code" });
    } finally {
      setBusy(false);
    }
  }

  async function create() {
    // Every step again: a field changed on an earlier step must not slip through.
    for (let n = 0; n <= 4; n++) {
      const e = check(n);
      if (Object.keys(e).length) {
        setStep(n);
        return show(e);
      }
    }
    setBusy(true);
    setErrors({});
    try {
      const r = await api<{ slug: string; url: string }>("/api/signup", {
        businessName: form.businessName.trim(),
        legalName: form.legalName.trim() || null,
        gstin: gstin || null,
        stateCode,
        address: form.address.trim() || null,
        slug: form.slug,
        ownerName: form.ownerName.trim(),
        loginId: form.loginId.trim().toLowerCase(),
        password: form.password,
        planCode: form.plan && form.plan !== "later" ? form.plan : null,
        acceptTerms: form.acceptTerms,
        challengeId: challenge?.id ?? "",
      });
      let host = `${r.slug}.${domain}`;
      try {
        host = new URL(r.url).host;
      } catch {}
      setMade({ url: r.url, host });
      // The welcome link (valid 10 minutes) signs the owner in on the new address and
      // opens the set-up checklist. Wait for the address's certificate first.
      await waitForAddress(r.url);
      window.location.assign(r.url);
    } catch (e) {
      setBusy(false);
      fail(e);
    }
  }

  const planName =
    form.plan === "later" ? "Decide later" : plans?.plans.find((p) => p.code === form.plan)?.name ?? (form.plan || "—");
  const trialDays = plans?.trialDays ?? 14;

  if (made) {
    return (
      <Shell>
        <div className="card card-deco p-6 sm:p-7 text-center">
          <span className="mx-auto grid place-items-center h-12 w-12 rounded-full bg-[var(--success-tint)] text-[var(--success-text)]">
            <Icon name="check" className="h-6 w-6" />
          </span>
          <h1 className="page-title mt-3">Your business is ready</h1>
          <p className="page-sub">Securing {made.host} and signing you in. The first time can take up to a minute…</p>
          <a href={made.url} className="btn btn-kesar w-full mt-6">
            Open my business
            <Icon name="arrow" className="h-4 w-4" />
          </a>
        </div>
      </Shell>
    );
  }

  return (
    <Shell>
      <div className="card card-deco p-5 sm:p-7">
        <p className="page-kick">{trialDays}-day free trial · no card needed</p>
        <h1 className="page-title">Start your business on VBiz Pro</h1>
        <div className="mt-5 mb-6">
          <Progress steps={STEPS} active={step} />
        </div>

        <form
          noValidate
          onSubmit={(e) => {
            e.preventDefault();
            if (busy) return;
            if (step === 3 && !verified) {
              if (challenge && challenge.phone === form.phone) verifyCode();
              else sendCode();
              return;
            }
            if (step === 4) create();
            else next();
          }}
          className="space-y-4"
        >
          {step === 0 && (
            <>
              <h2 className="font-heading font-bold text-lg text-ink">Your business</h2>
              <Field id="businessName" label="Business name" hint="Shops and staff will see this name." error={errors.businessName}>
                <input
                  className="input"
                  {...fieldProps("businessName", errors.businessName)}
                  autoComplete="organization"
                  maxLength={80}
                  placeholder="e.g. Agarwal Traders"
                  value={form.businessName}
                  onChange={(e) => set("businessName", e.target.value)}
                />
              </Field>
              <Field id="legalName" label="Legal name" optional hint="As on your GST registration, for invoices." error={errors.legalName}>
                <input
                  className="input"
                  {...fieldProps("legalName", errors.legalName)}
                  maxLength={120}
                  value={form.legalName}
                  onChange={(e) => set("legalName", e.target.value)}
                />
              </Field>
              <Field
                id="gstin"
                label="GSTIN"
                optional
                error={errors.gstin}
                hint={gstinState ? `State from the GSTIN: ${STATES[gstinState]}` : "15 characters, e.g. 27ABCDE1234F1Z5. You can add it later."}
              >
                <input
                  className="input uppercase tracking-[0.06em]"
                  {...fieldProps("gstin", errors.gstin)}
                  autoCapitalize="characters"
                  autoComplete="off"
                  maxLength={18}
                  value={form.gstin}
                  onChange={(e) => set("gstin", e.target.value.toUpperCase())}
                  onBlur={() => {
                    const g = gstinProblem(form.gstin);
                    if (g) setErrors((x) => ({ ...x, gstin: g }));
                  }}
                />
              </Field>
              <Field id="stateCode" label="State" error={errors.stateCode} hint={gstinState ? "Set by the GSTIN." : undefined}>
                <select
                  className="input"
                  {...fieldProps("stateCode", errors.stateCode)}
                  value={stateCode}
                  disabled={!!gstinState}
                  onChange={(e) => set("stateCode", e.target.value)}
                >
                  <option value="">Pick the state</option>
                  {STATE_OPTIONS.map(([c, n]) => (
                    <option key={c} value={c}>
                      {n}
                    </option>
                  ))}
                </select>
              </Field>
              <Field id="address" label="Business address" optional hint="Printed on your invoices." error={errors.address}>
                <textarea
                  className="input min-h-[76px]"
                  {...fieldProps("address", errors.address)}
                  autoComplete="street-address"
                  maxLength={300}
                  rows={2}
                  value={form.address}
                  onChange={(e) => set("address", e.target.value)}
                />
              </Field>
              <div className="grid gap-4 sm:grid-cols-2">
                <Field id="ownerName" label="Your name" error={errors.ownerName}>
                  <input
                    className="input"
                    {...fieldProps("ownerName", errors.ownerName)}
                    autoComplete="name"
                    maxLength={60}
                    value={form.ownerName}
                    onChange={(e) => set("ownerName", e.target.value)}
                  />
                </Field>
                <Field id="phone" label="Your mobile" hint="We'll send a code to check it." error={errors.phone}>
                  <input
                    className="input"
                    {...fieldProps("phone", errors.phone)}
                    inputMode="numeric"
                    autoComplete="tel-national"
                    maxLength={10}
                    placeholder="98765 43210"
                    value={form.phone}
                    onChange={(e) => set("phone", e.target.value.replace(/\D/g, ""))}
                  />
                </Field>
              </div>
            </>
          )}

          {step === 1 && (
            <>
              <h2 className="font-heading font-bold text-lg text-ink">Your web address</h2>
              <p className="text-sm text-[var(--ink-2)] -mt-2">Your shops and staff open this address to order and sign in.</p>
              <Field id="slug" label="Address" error={errors.slug && slugState.kind !== "ok" ? errors.slug : null}>
                <div className="flex items-stretch">
                  <input
                    className="input min-w-0 flex-1"
                    {...fieldProps("slug", errors.slug && slugState.kind !== "ok" ? errors.slug : null)}
                    style={{
                      ...fieldProps("slug", errors.slug && slugState.kind !== "ok" ? errors.slug : null).style,
                      borderTopRightRadius: 0,
                      borderBottomRightRadius: 0,
                    }}
                    autoCapitalize="none"
                    autoComplete="off"
                    spellCheck={false}
                    maxLength={30}
                    value={form.slug}
                    onChange={(e) => {
                      setSlugTouched(true);
                      set(
                        "slug",
                        e.target.value
                          .toLowerCase()
                          .replace(/[^a-z0-9-]+/g, "-")
                          .replace(/-{2,}/g, "-")
                          .slice(0, 30)
                      );
                    }}
                  />
                  <span className="flex items-center px-3 text-sm font-semibold text-[var(--ink-2)] bg-ink/5 border border-l-0 border-[var(--line)] rounded-r-xl whitespace-nowrap max-w-[45%] truncate">
                    .{domain}
                  </span>
                </div>
              </Field>
              <div aria-live="polite" className="text-sm min-h-[24px]">
                {slugState.kind === "checking" && <span className="text-[var(--muted)]">Checking…</span>}
                {slugState.kind === "ok" && (
                  <span className="inline-flex items-center gap-1.5 font-semibold text-[var(--success-text)]">
                    <Icon name="check" className="h-4 w-4" />
                    Free to use
                  </span>
                )}
                {slugState.kind === "bad" && !errors.slug && <span className="font-semibold text-[var(--risk-text)]">{slugState.message}</span>}
              </div>
              <div className="rounded-xl bg-ink/5 px-3 py-2.5">
                <p className="text-xs font-bold uppercase tracking-[0.1em] text-[var(--muted)]">Your business will be at</p>
                <p className="font-heading font-bold text-ink break-all mt-0.5">
                  {form.slug || "your-name"}.{domain}
                </p>
              </div>
              <p className="text-xs text-[var(--muted)]">
                Small letters, digits and dashes, 3–30 long. Your own domain can be added later on plans that include it.
              </p>
            </>
          )}

          {step === 2 && (
            <>
              <h2 className="font-heading font-bold text-lg text-ink">Pick a plan</h2>
              <div className="rounded-xl bg-[var(--success-tint)] text-[var(--success-text)] px-3 py-2.5 text-sm">
                <p className="font-bold">Every business starts with a {trialDays}-day free trial.</p>
                <p>Nothing is charged now. The plan you pick starts when the trial ends, and you can change it from Billing.</p>
              </div>
              {plansError && <FormError message={`${plansError}. You can still choose “Not sure yet”.`} />}
              {!plans && !plansError && <p className="text-sm text-[var(--muted)]">Loading the plans…</p>}
              <PlanCards
                plans={plans?.plans ?? []}
                trialDays={trialDays}
                value={form.plan}
                onChange={(v) => set("plan", v)}
                error={errors.plan}
              />
              <p className="text-xs text-[var(--muted)]">Prices are per month and do not include GST.</p>
            </>
          )}

          {step === 3 && (
            <>
              <h2 className="font-heading font-bold text-lg text-ink">Check your mobile</h2>
              <div className="flex items-center justify-between gap-3 rounded-xl bg-ink/5 px-3 py-2.5">
                <div className="min-w-0">
                  <p className="text-xs font-bold uppercase tracking-[0.1em] text-[var(--muted)]">Mobile</p>
                  <p className="font-bold text-ink">+91 {form.phone}</p>
                </div>
                <button type="button" className="btn btn-quiet btn-sm" onClick={() => goTo(0)}>
                  Change
                </button>
              </div>
              {errors.phone && (
                <p id="f-phone-err" role="alert" className="text-xs font-semibold text-[var(--risk-text)]">
                  {errors.phone}
                </p>
              )}

              {verified ? (
                <p className="flex items-center gap-2 rounded-xl bg-[var(--success-tint)] text-[var(--success-text)] px-3 py-2.5 text-sm font-bold">
                  <Icon name="check" className="h-5 w-5" />
                  Mobile checked
                </p>
              ) : !challenge || challenge.phone !== form.phone ? (
                <button type="button" className="btn btn-kesar w-full" disabled={busy} onClick={sendCode}>
                  {busy ? "Sending…" : "Send code by SMS"}
                </button>
              ) : (
                <>
                  {challenge.devCode && (
                    <p className="text-xs rounded-lg bg-[var(--scheme-tint)] text-[var(--scheme-text)] px-3 py-2">
                      Dev mode, no SMS sent. The code is <span className="font-semibold">{challenge.devCode}</span>.
                    </p>
                  )}
                  <Field id="code" label={`Code sent to ${challenge.phone}`} error={errors.code}>
                    <input
                      className="input tracking-[0.3em] text-center"
                      {...fieldProps("code", errors.code)}
                      inputMode="numeric"
                      autoComplete="one-time-code"
                      maxLength={6}
                      placeholder="••••••"
                      value={code}
                      onChange={(e) => {
                        setCode(e.target.value.replace(/\D/g, ""));
                        if (errors.code) setErrors((x) => ({ ...x, code: undefined }));
                      }}
                    />
                  </Field>
                  <button type="button" className="btn btn-kesar w-full" disabled={busy} onClick={verifyCode}>
                    {busy ? "Checking…" : "Verify"}
                  </button>
                  <button type="button" className="text-sm text-[var(--accent-text)] w-full text-center min-h-[44px]" disabled={busy} onClick={sendCode}>
                    Send a new code
                  </button>
                </>
              )}
              {!challenge && errors.code && (
                <p role="alert" className="text-xs font-semibold text-[var(--risk-text)]">
                  {errors.code}
                </p>
              )}
            </>
          )}

          {step === 4 && (
            <>
              <h2 className="font-heading font-bold text-lg text-ink">Your owner login</h2>
              <dl className="rounded-xl bg-ink/5 divide-y divide-black/5 text-sm">
                {[
                  ["Business", form.businessName, 0],
                  ["Web address", `${form.slug}.${domain}`, 1],
                  ["Plan after trial", planName, 2],
                  ["Mobile", `+91 ${form.phone}`, 3],
                ].map(([label, value, n]) => (
                  <div key={label as string} className="flex items-center justify-between gap-3 px-3 py-2">
                    <div className="min-w-0">
                      <dt className="text-xs text-[var(--muted)]">{label}</dt>
                      <dd className="font-semibold text-ink break-all">{value}</dd>
                    </div>
                    <button type="button" className="text-xs font-bold text-[var(--accent-text)] min-h-[36px] px-1" onClick={() => goTo(n as number)}>
                      Edit
                    </button>
                  </div>
                ))}
              </dl>

              <Field id="loginId" label="Login id" hint="You sign in with this and your password." error={errors.loginId}>
                <input
                  className="input"
                  {...fieldProps("loginId", errors.loginId)}
                  autoCapitalize="none"
                  autoComplete="username"
                  spellCheck={false}
                  maxLength={40}
                  value={form.loginId}
                  onChange={(e) => set("loginId", e.target.value.toLowerCase().replace(/\s+/g, ""))}
                />
              </Field>
              <Field id="password" label="Password" hint="At least 10 characters." error={errors.password}>
                <div className="relative">
                  <input
                    className="input pr-16"
                    {...fieldProps("password", errors.password)}
                    type={showPassword ? "text" : "password"}
                    autoComplete="new-password"
                    value={form.password}
                    onChange={(e) => set("password", e.target.value)}
                  />
                  <button
                    type="button"
                    className="absolute right-1.5 top-1/2 -translate-y-1/2 text-xs font-bold text-[var(--accent-text)] px-2 min-h-[36px]"
                    onClick={() => setShowPassword((v) => !v)}
                    aria-pressed={showPassword}
                  >
                    {showPassword ? "Hide" : "Show"}
                  </button>
                </div>
              </Field>
              <div>
                <label className="flex items-start gap-2.5 text-sm text-[var(--ink-2)]">
                  <input
                    type="checkbox"
                    id="f-acceptTerms"
                    className="mt-0.5 h-5 w-5 shrink-0 accent-[var(--kesar)]"
                    aria-invalid={errors.acceptTerms ? true : undefined}
                    aria-describedby={errors.acceptTerms ? "f-acceptTerms-err" : undefined}
                    checked={form.acceptTerms}
                    onChange={(e) => set("acceptTerms", e.target.checked)}
                  />
                  <span>
                    I accept the{" "}
                    <a href="/legal/terms" target="_blank" rel="noopener" className="font-semibold text-[var(--accent-text)] underline">
                      terms of service
                    </a>{" "}
                    and the{" "}
                    <a href="/legal/privacy" target="_blank" rel="noopener" className="font-semibold text-[var(--accent-text)] underline">
                      privacy notice
                    </a>
                    .
                  </span>
                </label>
                {errors.acceptTerms && (
                  <p id="f-acceptTerms-err" role="alert" className="text-xs font-semibold text-[var(--risk-text)] mt-1">
                    {errors.acceptTerms}
                  </p>
                )}
              </div>

              <div className="rounded-xl border border-[var(--line)] bg-white/60 px-3 py-3 text-sm text-[var(--ink-2)]">
                <p className="font-bold text-ink">What happens next</p>
                <p className="mt-1">
                  We open your new address and sign you in. The set-up checklist there takes you through the rest: your logo and
                  colours, importing products and shops, and inviting your staff.
                </p>
              </div>
            </>
          )}

          <FormError message={errors.form} />

          <div className="flex gap-3 pt-2">
            {step > 0 && (
              <button type="button" className="btn btn-quiet" disabled={busy} onClick={() => goTo(step - 1)}>
                <Icon name="chevronLeft" className="h-4 w-4" />
                Back
              </button>
            )}
            {step < 3 && (
              <button type="submit" className="btn btn-kesar flex-1" disabled={busy}>
                Continue
                <Icon name="arrow" className="h-4 w-4" />
              </button>
            )}
            {step === 3 && (
              <button type="button" className="btn btn-kesar flex-1" disabled={busy || !verified} onClick={next}>
                Continue
                <Icon name="arrow" className="h-4 w-4" />
              </button>
            )}
            {step === 4 && (
              <button type="submit" className="btn btn-kesar flex-1" disabled={busy}>
                {busy ? "Creating…" : "Create my business"}
              </button>
            )}
          </div>
        </form>
      </div>
    </Shell>
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen flex flex-col items-center px-4 py-8 sm:py-12">
      <div className="w-full max-w-lg">
        <div className="flex items-center justify-between gap-3 mb-6">
          <Link href="/" aria-label="VBiz Pro home" className="min-w-0">
            <BrandLockup large />
          </Link>
        </div>
        {children}
        <p className="text-xs text-center text-[var(--muted)] mt-5">
          Already on VBiz Pro? Sign in on your business&apos;s own address.
        </p>
      </div>
    </div>
  );
}
