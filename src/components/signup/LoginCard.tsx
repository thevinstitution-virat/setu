"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useLanguage } from "@/lib/i18n/LanguageProvider";
import LanguageToggle from "@/components/LanguageToggle";
import Link from "next/link";
import { APP_NAME } from "@/lib/brand";
import { BrandLockup } from "@/components/BrandMark";
import { Icon3D } from "@/components/icons3d/Icon3D";
import OtpInput from "@/components/ui/OtpInput";
import Icon from "@/components/Icon";
import GoogleButton from "@/components/auth/GoogleButton";
import EmailLinkForm from "@/components/auth/EmailLinkForm";

/**
 * For now sign-in is email (and Google once its keys are set): no
 * Retailer/Staff tabs, passwords or mobile OTP on screen (there is no SMS
 * provider yet). Set to false to bring the full card back; the routes behind
 * it are all still there.
 */
const EMAIL_AND_GOOGLE_ONLY = true;

type Region = { id: string; name: string; areas: { id: string; name: string }[] };

/** The business whose address this is (white label), or null on the platform address. */
export type LoginBrand = {
  business: boolean;
  appName: string;
  tagline: string | null;
  logoUrl: string | null;
};

/** A failed call: the server's `error` text and the HTTP status (423 = business paused). */
class ApiError extends Error {
  constructor(message: string, public status: number) {
    super(message);
  }
}

/** POST JSON; throws an ApiError with the server's `error` on a 4xx/5xx. */
async function postJson<T = Record<string, unknown>>(url: string, body: unknown, fallback: string): Promise<T> {
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new ApiError(data.error ?? fallback, res.status);
  return data as T;
}

/** What a failed sign-in shows: a paused business gets its own box, the rest a line of text. */
type LoginFailure = { text: string; paused: boolean };
const failureOf = (e: unknown, fallback: string): LoginFailure => ({
  text: e instanceof Error && e.message ? e.message : fallback,
  paused: e instanceof ApiError && e.status === 423,
});

/** Same rule as lib/referrals normaliseCode: capitals and digits, 12 at most. */
const normaliseRef = (v: string | null | undefined) => (v ?? "").trim().toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 12);

/**
 * The sign-in card. initialPhone opens the staff tab in OTP mode (switching
 * business from a password session); linkError is why a business switch link
 * failed; notice is a message the server sent us here with (support session
 * ended, welcome link expired …); initialRef fills the retailer referral code.
 */
export default function LoginCard({
  brand,
  initialPhone = "",
  linkError = null,
  notice = null,
  initialRef = "",
  google = false,
}: {
  brand: LoginBrand;
  /** Show "Continue with Google" (GOOGLE_CLIENT_ID / SECRET are set). */
  google?: boolean;
  initialPhone?: string;
  linkError?: string | null;
  notice?: string | null;
  initialRef?: string;
}) {
  const [mode, setMode] = useState<"retailer" | "team">(initialPhone || linkError || notice ? "team" : "retailer");
  const { t } = useLanguage();
  const name = brand.business ? brand.appName : APP_NAME;

  return (
    <div className="min-h-screen flex flex-col items-center justify-center px-4 py-10">
      <div className="w-full max-w-sm">
        <div className="flex items-center justify-between gap-3 mb-8">
          <Link href="/" aria-label={name} className="min-w-0">
            <BrandLockup name={brand.business ? brand.appName : undefined} logoUrl={brand.logoUrl} large />
          </Link>
          <LanguageToggle />
        </div>

        <div className={`card ${brand.business ? "" : "card-deco"} p-6 sm:p-7`}>
          <Icon3D name="kirana-shop" size={88} animate="pop" priority interactive className="mb-2" />
          {!EMAIL_AND_GOOGLE_ONLY && <p className="page-kick">{mode === "retailer" ? t("login.retailerTab") : t("login.teamTab")}</p>}
          <h1 className="page-title">{t("login.title")}</h1>
          <p className="page-sub mb-6">{brand.tagline || t("brand.tagline")}</p>

          {notice && (
            <p role="status" className="text-sm rounded-lg bg-[var(--scheme-tint)] text-[var(--scheme-text)] px-3 py-2 mb-4 break-words">
              {notice}
            </p>
          )}

          {linkError && (
            <p role="alert" className="text-sm rounded-lg bg-[var(--risk-text)]/10 text-[var(--risk-text)] px-3 py-2 mb-4 break-words">
              {t("login.switchFailed")} {linkError}
            </p>
          )}

          {EMAIL_AND_GOOGLE_ONLY ? (
            <SimpleSignIn business={brand.business} />
          ) : (
            <>
          {!brand.business && (
            <p className="text-sm rounded-lg bg-ink/5 text-[var(--ink-2)] px-3 py-2 mb-4">{t("login.noBusiness")}</p>
          )}

          {google && brand.business && (
            <>
              <GoogleButton href="/api/auth/google/start" label={t("google.continue")} />
              <div className="flex items-center gap-3 my-5 text-xs font-semibold uppercase tracking-wide text-[var(--muted)]">
                <span className="h-px flex-1 bg-[var(--line)]" aria-hidden />
                {t("google.or")}
                <span className="h-px flex-1 bg-[var(--line)]" aria-hidden />
              </div>
            </>
          )}

          <div className="flex rounded-2xl p-1 mb-6 bg-ink/5" role="tablist">
            {(["retailer", "team"] as const).map((m) => (
              <button
                key={m}
                role="tab"
                aria-selected={mode === m}
                className={`flex-1 rounded-xl py-2.5 text-sm font-bold transition ${
                  mode === m
                    ? "bg-gradient-to-br from-mor to-[var(--mor-mid)] text-white shadow-[0_10px_20px_-12px_rgba(8,38,37,.9)]"
                    : "text-[var(--ink-2)]"
                }`}
                onClick={() => setMode(m)}
              >
                {m === "retailer" ? t("login.retailerTab") : t("login.teamTab")}
              </button>
            ))}
          </div>

          {mode === "retailer" ? <RetailerLogin initialRef={initialRef} /> : <TeamLogin initialPhone={initialPhone} />}
            </>
          )}
        </div>

        {!brand.business && (
          <p className="text-sm text-center text-[var(--ink-2)] mt-5">
            {t("login.newHere")}{" "}
            <Link href="/start" className="font-bold text-[var(--accent-text)] whitespace-nowrap">
              {t("login.startTrial")}
            </Link>
          </p>
        )}
        <p className="text-xs text-center text-[var(--muted)] mt-4">
          <Link href="/legal/terms" className="hover:underline">
            Terms
          </Link>{" "}
          ·{" "}
          <Link href="/legal/privacy" className="hover:underline">
            Privacy
          </Link>
        </p>
      </div>
    </div>
  );
}

/**
 * The card for now: on a business's address Google (when set up) and an
 * emailed code; on the main address one email with a sign-in link for each
 * business the confirmed address belongs to (and the console).
 */
function SimpleSignIn({ business }: { business: boolean }) {
  const { t } = useLanguage();
  if (!business) {
    return (
      <EmailLinkForm
        text={{
          label: t("login.emailLabel"),
          send: t("link.send"),
          wait: t("login.wait"),
          sent: t("link.sent"),
          again: t("link.again"),
          hint: t("link.hint"),
          bad: t("login.error"),
        }}
      />
    );
  }
  return (
    <div className="space-y-4">
      <EmailCodeLogin />
    </div>
  );
}

/** The error under a form, or the "business paused" box for a 423. */
function FailureNote({ failure }: { failure: LoginFailure | null }) {
  const { t } = useLanguage();
  if (!failure) return null;
  if (!failure.paused) return <p role="alert" className="text-sm text-[var(--risk-text)]">{failure.text}</p>;
  return (
    <div role="alert" className="flex gap-2.5 rounded-xl bg-[var(--risk-text)]/10 text-[var(--risk-text)] px-3 py-2.5">
      <Icon name="lock" className="h-5 w-5 shrink-0 mt-0.5" />
      <div className="text-sm">
        <p className="font-bold">{t("login.pausedTitle")}</p>
        <p className="break-words">{failure.text}</p>
      </div>
    </div>
  );
}

/** Shops: mobile OTP (and sign-up) by default, or a code to the email they confirmed. */
function RetailerLogin({ initialRef = "" }: { initialRef?: string }) {
  const { t } = useLanguage();
  const [viaEmail, setViaEmail] = useState(false);
  return (
    <div className="space-y-4">
      {viaEmail ? <EmailCodeLogin /> : <RetailerPhoneLogin initialRef={initialRef} />}
      <button type="button" className="text-sm text-[var(--accent-text)] w-full text-center min-h-[44px]" onClick={() => setViaEmail(!viaEmail)}>
        {viaEmail ? t("login.usePhone") : t("login.useEmail")}
      </button>
    </div>
  );
}

function RetailerPhoneLogin({ initialRef = "" }: { initialRef?: string }) {
  const router = useRouter();
  const { t } = useLanguage();
  const [step, setStep] = useState<"phone" | "otp" | "register">("phone");
  const [phone, setPhone] = useState("");
  const [code, setCode] = useState("");
  const [devCode, setDevCode] = useState<string | null>(null);
  const [error, setError] = useState<LoginFailure | null>(null);
  const [loading, setLoading] = useState(false);

  const [regions, setRegions] = useState<Region[]>([]);
  const [form, setForm] = useState({
    outletName: "",
    shopNumber: "",
    complexName: "",
    pinCode: "",
    regionId: "",
    areaId: "",
  });
  const [referralCode, setReferralCode] = useState(initialRef);
  const referral = useReferralCheck(step === "register", referralCode);
  const fail = (text: string) => setError({ text, paused: false });

  async function sendOtp() {
    setError(null);
    if (!/^\d{10}$/.test(phone)) {
      fail(t("login.invalidMobile"));
      return;
    }
    setLoading(true);
    try {
      const data = await postJson<{ devCode?: string }>("/api/auth/otp/request", { phone }, t("login.error"));
      setDevCode(data.devCode ?? null);
      setStep("otp");
    } catch (e) {
      setError(failureOf(e, t("login.error")));
    } finally {
      setLoading(false);
    }
  }

  async function verifyOtp() {
    setError(null);
    setLoading(true);
    try {
      const data = await postJson<{ status: string; redirect?: string }>("/api/auth/otp/verify", { phone, code }, t("login.error"));
      if (data.status === "login" && data.redirect) {
        router.push(data.redirect);
        return;
      }
      const areasRes = await fetch("/api/areas");
      const areasData = await areasRes.json();
      setRegions(areasData.regions);
      setStep("register");
    } catch (e) {
      setError(failureOf(e, t("login.error")));
    } finally {
      setLoading(false);
    }
  }

  async function register() {
    setError(null);
    if (
      !form.outletName ||
      !form.shopNumber ||
      !form.complexName ||
      !form.pinCode ||
      !form.areaId
    ) {
      fail("Please fill in every field");
      return;
    }
    // A code that is not valid would stop the sign-up: fix it or clear it first.
    const sendCode = referralCode.trim() !== "" && referral.state !== "off";
    if (sendCode && referral.state !== "ok") {
      fail(referral.state === "checking" ? "Checking the referral code. Try again in a moment." : "Fix or clear the referral code");
      return;
    }
    setLoading(true);
    try {
      const data = await postJson<{ redirect: string }>(
        "/api/auth/register-retailer",
        { phone, ...form, ...(sendCode ? { referralCode } : {}) },
        t("login.error")
      );
      router.push(data.redirect);
    } catch (e) {
      setError(failureOf(e, t("login.error")));
    } finally {
      setLoading(false);
    }
  }

  const selectedRegion = regions.find((r) => r.id === form.regionId);

  return (
    <div className="space-y-4">
      <Stepper
        steps={["Mobile", "OTP", "Outlet details"]}
        active={step === "phone" ? 0 : step === "otp" ? 1 : 2}
      />

      {step === "phone" && (
        <>
          <Field label={t("login.mobileLabel")}>
            <input
              className="input"
              inputMode="numeric"
              maxLength={10}
              placeholder="98765 43210"
              value={phone}
              onChange={(e) => setPhone(e.target.value.replace(/\D/g, ""))}
            />
          </Field>
          <Button onClick={sendOtp} loading={loading}>
            {t("login.sendOtp")}
          </Button>
        </>
      )}

      {step === "otp" && (
        <>
          <OtpCodeField phone={phone} code={code} setCode={setCode} devCode={devCode} />
          <Button onClick={verifyOtp} loading={loading}>
            {t("login.verify")}
          </Button>
          <button
            className="text-sm text-[var(--accent-text)] w-full text-center"
            onClick={() => {
              setStep("phone");
              setError(null);
            }}
          >
            {t("login.changeNumber")}
          </button>
        </>
      )}

      {step === "register" && (
        <>
          <Field label={t("login.outletName")}>
            <input
              className="input"
              value={form.outletName}
              onChange={(e) => setForm({ ...form, outletName: e.target.value })}
            />
          </Field>
          <Field label={t("login.region")}>
            <select
              className="input"
              value={form.regionId}
              onChange={(e) =>
                setForm({ ...form, regionId: e.target.value, areaId: "" })
              }
            >
              <option value="">Select region</option>
              {regions.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.name}
                </option>
              ))}
            </select>
          </Field>
          <Field label={t("login.area")}>
            <select
              className="input"
              value={form.areaId}
              disabled={!selectedRegion}
              onChange={(e) => setForm({ ...form, areaId: e.target.value })}
            >
              <option value="">Select area</option>
              {selectedRegion?.areas.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name}
                </option>
              ))}
            </select>
          </Field>
          <Field label={t("login.shopNumber")}>
            <input
              className="input"
              value={form.shopNumber}
              onChange={(e) => setForm({ ...form, shopNumber: e.target.value })}
            />
          </Field>
          <Field label={t("login.complexName")}>
            <input
              className="input"
              value={form.complexName}
              onChange={(e) => setForm({ ...form, complexName: e.target.value })}
            />
          </Field>
          <Field label={t("login.pinCode")}>
            <input
              className="input"
              inputMode="numeric"
              maxLength={6}
              value={form.pinCode}
              onChange={(e) =>
                setForm({ ...form, pinCode: e.target.value.replace(/\D/g, "") })
              }
            />
          </Field>
          {(referral.state !== "off" || initialRef) && (
            <Field label="Referral code (optional)">
              <input
                className="input uppercase tracking-[0.12em]"
                autoCapitalize="characters"
                autoComplete="off"
                maxLength={12}
                placeholder="From a shop that invited you"
                value={referralCode}
                onChange={(e) => setReferralCode(normaliseRef(e.target.value))}
              />
              {referralCode && referral.state === "checking" && (
                <span className="block text-xs text-[var(--muted)] mt-1">Checking…</span>
              )}
              {referralCode && referral.state === "ok" && (
                <span className="block text-xs font-semibold text-[var(--success-text)] mt-1">Code from {referral.shop}</span>
              )}
              {referralCode && (referral.state === "error" || referral.state === "off") && (
                <span className={`block text-xs mt-1 ${referralCode.length < 5 && referral.state === "error" ? "text-[var(--muted)]" : "text-[var(--risk-text)]"}`}>
                  {referral.message}
                  {referral.state === "off" ? ". You can still sign up." : ""}
                </span>
              )}
            </Field>
          )}
          <Button onClick={register} loading={loading}>
            {t("login.createAccount")}
          </Button>
        </>
      )}

      <FailureNote failure={error} />
    </div>
  );
}

type ReferralCheck =
  | { state: "idle" | "checking" }
  | { state: "ok"; shop: string }
  | { state: "error" | "off"; message: string };

/**
 * Live check of the sign-up referral code (no sign-in needed). With no code
 * it still asks once, to learn whether refer-and-earn is on at all ("off"
 * hides the field).
 */
function useReferralCheck(active: boolean, code: string): ReferralCheck {
  const [result, setResult] = useState<ReferralCheck & { code: string | null }>({ state: "idle", code: null });
  // Too short to be a code: only learn whether the feature is on.
  const query = code.length >= 5 ? code : "";

  useEffect(() => {
    if (!active) return;
    let live = true;
    const timer = window.setTimeout(async () => {
      try {
        const res = await fetch(`/api/referrals/check?code=${encodeURIComponent(query)}`);
        const d = await res.json().catch(() => ({}));
        if (!live) return;
        if (res.ok) setResult({ state: "ok", shop: String(d.shop ?? ""), code: query });
        else if (res.status === 409) setResult({ state: "off", message: d.error ?? "Refer and earn is not on", code: query });
        else setResult({ state: "error", message: d.error ?? "This code is not valid", code: query });
      } catch {
        if (live) setResult({ state: "idle", code: null });
      }
    }, query ? 400 : 0);
    return () => {
      live = false;
      window.clearTimeout(timer);
    };
  }, [active, query]);

  if (result.state === "off") return result;
  if (!code) return { state: "idle" };
  if (!query) return { state: "error", message: "Enter the full code your friend shared" };
  if (result.code !== query) return { state: "checking" };
  return result;
}

function TeamLogin({ initialPhone = "" }: { initialPhone?: string }) {
  const { t } = useLanguage();
  const [method, setMethod] = useState<"password" | "otp" | "email">(initialPhone ? "otp" : "password");

  return (
    <div className="space-y-4">
      <div className="flex rounded-2xl p-1 bg-ink/5" role="radiogroup" aria-label={t("login.teamTab")}>
        {(["password", "otp", "email"] as const).map((m) => (
          <button
            key={m}
            type="button"
            role="radio"
            aria-checked={method === m}
            onClick={() => setMethod(m)}
            className={`flex-1 min-h-[44px] rounded-xl px-2 py-1.5 text-sm font-bold leading-tight transition ${
              method === m ? "bg-white text-[var(--ink)] shadow-sm" : "text-[var(--ink-2)]"
            }`}
          >
            {m === "password" ? t("login.methodPassword") : m === "otp" ? t("login.methodOtp") : t("login.methodEmail")}
          </button>
        ))}
      </div>
      {method === "password" ? <PasswordLogin /> : method === "otp" ? <StaffOtpLogin initialPhone={initialPhone} /> : <EmailCodeLogin />}
    </div>
  );
}

function PasswordLogin() {
  const router = useRouter();
  const { t } = useLanguage();
  const [loginId, setLoginId] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<LoginFailure | null>(null);
  const [loading, setLoading] = useState(false);

  async function submit() {
    setError(null);
    setLoading(true);
    try {
      const data = await postJson<{ redirect: string }>("/api/auth/login", { loginId, password }, t("login.error"));
      router.push(data.redirect);
    } catch (e) {
      setError(failureOf(e, t("login.error")));
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="space-y-4">
      <Field label={t("login.loginIdLabel")}>
        <input
          className="input"
          autoCapitalize="none"
          autoComplete="username"
          value={loginId}
          onChange={(e) => setLoginId(e.target.value)}
          placeholder="e.g. Test agent"
        />
      </Field>
      <Field label={t("login.passwordLabel")}>
        <input
          className="input"
          type="password"
          autoComplete="current-password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !loading) submit();
          }}
        />
      </Field>
      <Button onClick={submit} loading={loading}>
        {t("login.loginButton")}
      </Button>
      <FailureNote failure={error} />
      <p className="text-center">
        <Link href="/login/forgot" className="text-sm font-semibold text-[var(--accent-text)] hover:underline inline-block min-h-[44px] leading-[44px]">
          {t("login.forgot")}
        </Link>
      </p>
    </div>
  );
}

/** Anyone with a confirmed email on their login: a 6-digit code by email (staff then do step two). */
function EmailCodeLogin() {
  const router = useRouter();
  const { t } = useLanguage();
  const [step, setStep] = useState<"email" | "code">("email");
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [devCode, setDevCode] = useState<string | null>(null);
  const [error, setError] = useState<LoginFailure | null>(null);
  const [loading, setLoading] = useState(false);

  async function send() {
    setError(null);
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email.trim())) {
      setError({ text: t("login.error"), paused: false });
      return;
    }
    setLoading(true);
    try {
      const data = await postJson<{ devCode?: string }>("/api/auth/email-code/request", { email }, t("login.error"));
      setDevCode(data.devCode ?? null);
      setCode("");
      setStep("code");
    } catch (e) {
      setError(failureOf(e, t("login.error")));
    } finally {
      setLoading(false);
    }
  }

  async function verify() {
    setError(null);
    setLoading(true);
    try {
      const data = await postJson<{ redirect: string }>("/api/auth/email-code/verify", { email, code }, t("login.error"));
      router.push(data.redirect);
    } catch (e) {
      setError(failureOf(e, t("login.error")));
      setLoading(false);
    }
  }

  return (
    <div className="space-y-4">
      {step === "email" ? (
        <>
          <Field label={t("login.emailLabel")}>
            <input
              className="input"
              type="email"
              inputMode="email"
              autoComplete="email"
              autoCapitalize="none"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !loading) send();
              }}
              placeholder="you@example.com"
            />
          </Field>
          <Button onClick={send} loading={loading}>
            {t("login.sendEmailCode")}
          </Button>
          <p className="text-xs text-[var(--muted)]">{t("login.emailHint")}</p>
        </>
      ) : (
        <>
          {devCode ? (
            <p className="text-xs rounded-lg bg-[var(--scheme-tint)] text-[var(--scheme-text)] px-3 py-2">
              {t("login.demoEmail")} <span className="font-semibold">{devCode}</span>.
            </p>
          ) : (
            <p role="status" className="text-sm rounded-lg bg-ink/5 text-[var(--ink-2)] px-3 py-2">
              {t("login.emailSent")}
            </p>
          )}
          <Field label={`${t("login.emailCodeLabel")} (${email.trim()})`}>
            <input
              className="input tracking-[0.3em] text-center"
              inputMode="numeric"
              autoComplete="one-time-code"
              maxLength={6}
              placeholder="••••••"
              value={code}
              onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !loading && code.length === 6) verify();
              }}
            />
          </Field>
          <Button onClick={verify} loading={loading}>
            {t("login.verify")}
          </Button>
          <button
            type="button"
            className="text-sm text-[var(--accent-text)] w-full text-center min-h-[44px]"
            onClick={() => {
              setStep("email");
              setError(null);
            }}
          >
            {t("login.changeEmail")}
          </button>
        </>
      )}
      <FailureNote failure={error} />
    </div>
  );
}

/** Sales agents, drivers and supervisors: OTP to the mobile number on their staff login. */
function StaffOtpLogin({ initialPhone }: { initialPhone: string }) {
  const router = useRouter();
  const { t } = useLanguage();
  const [step, setStep] = useState<"phone" | "otp">("phone");
  const [phone, setPhone] = useState(initialPhone);
  const [code, setCode] = useState("");
  const [devCode, setDevCode] = useState<string | null>(null);
  const [error, setError] = useState<LoginFailure | null>(null);
  const [loading, setLoading] = useState(false);

  async function sendOtp() {
    setError(null);
    if (!/^\d{10}$/.test(phone)) {
      setError({ text: t("login.invalidMobile"), paused: false });
      return;
    }
    setLoading(true);
    try {
      const data = await postJson<{ devCode?: string }>("/api/auth/otp/request", { phone }, t("login.error"));
      setDevCode(data.devCode ?? null);
      setCode("");
      setStep("otp");
    } catch (e) {
      setError(failureOf(e, t("login.error")));
    } finally {
      setLoading(false);
    }
  }

  async function verifyOtp() {
    setError(null);
    setLoading(true);
    try {
      const data = await postJson<{ status: string; redirect?: string }>("/api/auth/otp/verify", { phone, code, as: "staff" }, t("login.error"));
      if (data.status === "login" && data.redirect) {
        router.push(data.redirect);
        return;
      }
      // "new": no login has this mobile. Staff logins are added by the office.
      setError({ text: t("login.noStaffLogin"), paused: false });
    } catch (e) {
      setError(failureOf(e, t("login.error")));
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="space-y-4">
      {step === "phone" ? (
        <>
          <Field label={t("login.mobileLabel")}>
            <input
              className="input"
              inputMode="numeric"
              autoComplete="tel-national"
              maxLength={10}
              placeholder="98765 43210"
              value={phone}
              onChange={(e) => setPhone(e.target.value.replace(/\D/g, ""))}
            />
          </Field>
          <Button onClick={sendOtp} loading={loading}>
            {t("login.sendOtp")}
          </Button>
        </>
      ) : (
        <>
          <OtpCodeField phone={phone} code={code} setCode={setCode} devCode={devCode} />
          <Button onClick={verifyOtp} loading={loading}>
            {t("login.verify")}
          </Button>
          <button
            type="button"
            className="text-sm text-[var(--accent-text)] w-full text-center min-h-[44px]"
            onClick={() => {
              setStep("phone");
              setError(null);
            }}
          >
            {t("login.changeNumber")}
          </button>
        </>
      )}
      <FailureNote failure={error} />
      <p className="text-xs text-[var(--muted)]">{t("login.otpSwitchHint")}</p>
    </div>
  );
}

function OtpCodeField({
  phone,
  code,
  setCode,
  devCode,
}: {
  phone: string;
  code: string;
  setCode: (c: string) => void;
  devCode: string | null;
}) {
  const { t } = useLanguage();
  return (
    <>
      {devCode && (
        <p className="text-xs rounded-lg bg-[var(--scheme-tint)] text-[var(--scheme-text)] px-3 py-2">
          {t("login.demoOtp")} <span className="font-semibold">{devCode}</span>.
        </p>
      )}
      <div>
        <p className="block text-sm font-medium text-foreground/70 mb-2">{`${t("login.otpLabel")} ${phone}`}</p>
        <OtpInput value={code} onChangeAction={setCode} autoFocus label={t("login.otpLabel")} />
      </div>
    </>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="block text-sm font-medium text-foreground/70 mb-1">{label}</span>
      {children}
    </label>
  );
}

function Button({
  children,
  onClick,
  loading,
}: {
  children: React.ReactNode;
  onClick: () => void;
  loading?: boolean;
}) {
  const { t } = useLanguage();
  return (
    <button
      onClick={onClick}
      disabled={loading}
      className="btn btn-kesar w-full"
    >
      {loading ? t("login.wait") : children}
    </button>
  );
}

function Stepper({ steps, active }: { steps: string[]; active: number }) {
  return (
    <div className="flex items-center gap-2 mb-2">
      {steps.map((s, i) => (
        <div key={s} className="flex-1">
          <div
            className={`h-1.5 rounded-full ${
              i <= active ? "bg-[var(--kesar)]" : "bg-black/10"
            }`}
          />
        </div>
      ))}
    </div>
  );
}
