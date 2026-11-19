"use client";

import { Suspense, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useLanguage } from "@/lib/i18n/LanguageProvider";
import LanguageToggle from "@/components/LanguageToggle";
import Link from "next/link";
import { APP_NAME } from "@/lib/brand";
import { BrandLockup } from "@/components/BrandMark";

type Region = { id: string; name: string; areas: { id: string; name: string }[] };

/** POST JSON; throws the server's `error` on a 4xx/5xx. */
async function postJson<T = Record<string, unknown>>(url: string, body: unknown, fallback: string): Promise<T> {
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error ?? fallback);
  return data as T;
}

// useSearchParams needs a Suspense boundary; the fallback is the same page without the query.
export default function LoginPage() {
  return (
    <Suspense fallback={<LoginCard />}>
      <LoginFromQuery />
    </Suspense>
  );
}

/**
 * ?phone=XXXXXXXXXX opens the staff tab in OTP mode with the phone filled in
 * (switching business from a password session). ?error=... shows why a business
 * switch link failed.
 */
function LoginFromQuery() {
  const params = useSearchParams();
  const raw = (params.get("phone") ?? "").replace(/\D/g, "");
  const phone = /^\d{10}$/.test(raw) ? raw : "";
  const error = (params.get("error") ?? "").trim().slice(0, 200) || null;
  return <LoginCard initialPhone={phone} linkError={error} />;
}

function LoginCard({ initialPhone = "", linkError = null }: { initialPhone?: string; linkError?: string | null }) {
  const [mode, setMode] = useState<"retailer" | "team">(initialPhone || linkError ? "team" : "retailer");
  const { t } = useLanguage();

  return (
    <div className="min-h-screen flex flex-col items-center justify-center px-4 py-10">
      <div className="w-full max-w-sm">
        <div className="flex items-center justify-between mb-8">
          <Link href="/" aria-label={APP_NAME}>
            <BrandLockup />
          </Link>
          <LanguageToggle />
        </div>

        <div className="card p-6 sm:p-7">
          <p className="page-kick">{mode === "retailer" ? t("login.retailerTab") : t("login.teamTab")}</p>
          <h1 className="page-title">{t("login.title")}</h1>
          <p className="page-sub mb-6">{t("brand.tagline")}</p>

          {linkError && (
            <p role="alert" className="text-sm rounded-lg bg-[#a8281e]/10 text-[#a8281e] px-3 py-2 mb-4 break-words">
              {t("login.switchFailed")} {linkError}
            </p>
          )}

          <div className="flex rounded-2xl p-1 mb-6 bg-ink/5" role="tablist">
            {(["retailer", "team"] as const).map((m) => (
              <button
                key={m}
                role="tab"
                aria-selected={mode === m}
                className={`flex-1 rounded-xl py-2.5 text-sm font-bold transition ${
                  mode === m
                    ? "bg-gradient-to-br from-mor to-[#0c3634] text-white shadow-[0_10px_20px_-12px_rgba(8,38,37,.9)]"
                    : "text-[var(--ink-2)]"
                }`}
                onClick={() => setMode(m)}
              >
                {m === "retailer" ? t("login.retailerTab") : t("login.teamTab")}
              </button>
            ))}
          </div>

          {mode === "retailer" ? <RetailerLogin /> : <TeamLogin initialPhone={initialPhone} />}
        </div>
      </div>
    </div>
  );
}

function RetailerLogin() {
  const router = useRouter();
  const { t } = useLanguage();
  const [step, setStep] = useState<"phone" | "otp" | "register">("phone");
  const [phone, setPhone] = useState("");
  const [code, setCode] = useState("");
  const [devCode, setDevCode] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
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

  async function sendOtp() {
    setError(null);
    if (!/^\d{10}$/.test(phone)) {
      setError(t("login.invalidMobile"));
      return;
    }
    setLoading(true);
    try {
      const data = await postJson<{ devCode?: string }>("/api/auth/otp/request", { phone }, t("login.error"));
      setDevCode(data.devCode ?? null);
      setStep("otp");
    } catch (e) {
      setError(e instanceof Error ? e.message : t("login.error"));
    } finally {
      setLoading(false);
    }
  }

  async function verifyOtp() {
    setError(null);
    setLoading(true);
    try {
      const res = await fetch("/api/auth/otp/verify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ phone, code }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      if (data.status === "login") {
        router.push(data.redirect);
        return;
      }
      const areasRes = await fetch("/api/areas");
      const areasData = await areasRes.json();
      setRegions(areasData.regions);
      setStep("register");
    } catch (e) {
      setError(e instanceof Error ? e.message : t("login.error"));
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
      setError("Please fill in every field");
      return;
    }
    setLoading(true);
    try {
      const res = await fetch("/api/auth/register-retailer", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ phone, ...form }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      router.push(data.redirect);
    } catch (e) {
      setError(e instanceof Error ? e.message : t("login.error"));
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
            className="text-sm text-[var(--kesar-text)] w-full text-center"
            onClick={() => setStep("phone")}
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
          <Button onClick={register} loading={loading}>
            {t("login.createAccount")}
          </Button>
        </>
      )}

      {error && <p className="text-sm text-[#a8281e]">{error}</p>}
    </div>
  );
}

function TeamLogin({ initialPhone = "" }: { initialPhone?: string }) {
  const { t } = useLanguage();
  const [method, setMethod] = useState<"password" | "otp">(initialPhone ? "otp" : "password");

  return (
    <div className="space-y-4">
      <div className="flex rounded-2xl p-1 bg-ink/5" role="radiogroup" aria-label={t("login.teamTab")}>
        {(["password", "otp"] as const).map((m) => (
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
            {m === "password" ? t("login.methodPassword") : t("login.methodOtp")}
          </button>
        ))}
      </div>
      {method === "password" ? <PasswordLogin /> : <StaffOtpLogin initialPhone={initialPhone} />}
    </div>
  );
}

function PasswordLogin() {
  const router = useRouter();
  const { t } = useLanguage();
  const [loginId, setLoginId] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function submit() {
    setError(null);
    setLoading(true);
    try {
      const data = await postJson<{ redirect: string }>("/api/auth/login", { loginId, password }, t("login.error"));
      router.push(data.redirect);
    } catch (e) {
      setError(e instanceof Error ? e.message : t("login.error"));
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
          value={loginId}
          onChange={(e) => setLoginId(e.target.value)}
          placeholder="e.g. Test agent"
        />
      </Field>
      <Field label={t("login.passwordLabel")}>
        <input
          className="input"
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
        />
      </Field>
      <Button onClick={submit} loading={loading}>
        {t("login.loginButton")}
      </Button>
      {error && <p className="text-sm text-[#a8281e]">{error}</p>}
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
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function sendOtp() {
    setError(null);
    if (!/^\d{10}$/.test(phone)) {
      setError(t("login.invalidMobile"));
      return;
    }
    setLoading(true);
    try {
      const data = await postJson<{ devCode?: string }>("/api/auth/otp/request", { phone }, t("login.error"));
      setDevCode(data.devCode ?? null);
      setCode("");
      setStep("otp");
    } catch (e) {
      setError(e instanceof Error ? e.message : t("login.error"));
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
      setError(t("login.noStaffLogin"));
    } catch (e) {
      setError(e instanceof Error ? e.message : t("login.error"));
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
            className="text-sm text-[var(--kesar-text)] w-full text-center min-h-[44px]"
            onClick={() => {
              setStep("phone");
              setError(null);
            }}
          >
            {t("login.changeNumber")}
          </button>
        </>
      )}
      {error && <p className="text-sm text-[#a8281e]">{error}</p>}
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
        <p className="text-xs rounded-lg bg-[var(--genda-tint)] text-[var(--genda-text)] px-3 py-2">
          {t("login.demoOtp")} <span className="font-semibold">{devCode}</span>.
        </p>
      )}
      <Field label={`${t("login.otpLabel")} ${phone}`}>
        <input
          className="input tracking-[0.3em] text-center"
          inputMode="numeric"
          autoComplete="one-time-code"
          maxLength={6}
          placeholder="••••••"
          value={code}
          onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))}
        />
      </Field>
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
