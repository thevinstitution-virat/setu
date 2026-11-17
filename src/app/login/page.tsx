"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useLanguage } from "@/lib/i18n/LanguageProvider";
import LanguageToggle from "@/components/LanguageToggle";
import { APP_NAME } from "@/lib/brand";

type Region = { id: string; name: string; areas: { id: string; name: string }[] };

export default function LoginPage() {
  const [mode, setMode] = useState<"retailer" | "team">("retailer");
  const { t } = useLanguage();

  return (
    <div className="min-h-screen flex flex-col items-center justify-center px-4 py-10">
      <div className="w-full max-w-sm">
        <div className="flex justify-end mb-2">
          <LanguageToggle />
        </div>
        <div className="text-center mb-8">
          <div className="inline-flex h-14 w-14 items-center justify-center rounded-2xl bg-brand text-white font-bold text-2xl mb-3">
            S
          </div>
          <h1 className="text-2xl font-semibold text-foreground">{APP_NAME}</h1>
          <p className="text-sm text-foreground/60 mt-1">{t("brand.tagline")}</p>
        </div>

        <div className="flex rounded-xl bg-black/5 p-1 mb-6">
          <button
            className={`flex-1 rounded-lg py-2 text-sm font-medium transition ${
              mode === "retailer" ? "bg-white shadow text-brand-dark" : "text-foreground/60"
            }`}
            onClick={() => setMode("retailer")}
          >
            {t("login.retailerTab")}
          </button>
          <button
            className={`flex-1 rounded-lg py-2 text-sm font-medium transition ${
              mode === "team" ? "bg-white shadow text-brand-dark" : "text-foreground/60"
            }`}
            onClick={() => setMode("team")}
          >
            {t("login.teamTab")}
          </button>
        </div>

        {mode === "retailer" ? <RetailerLogin /> : <TeamLogin />}
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
      setError("Enter a valid 10-digit mobile number");
      return;
    }
    setLoading(true);
    try {
      const res = await fetch("/api/auth/otp/request", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ phone }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      setDevCode(data.devCode);
      setStep("otp");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong");
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
      setError(e instanceof Error ? e.message : "Something went wrong");
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
      setError(e instanceof Error ? e.message : "Something went wrong");
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
          {devCode && (
            <p className="text-xs rounded-lg bg-brand-light text-brand-dark px-3 py-2">
              Demo mode — no SMS is sent. Your OTP is{" "}
              <span className="font-semibold">{devCode}</span>.
            </p>
          )}
          <Field label={`${t("login.otpLabel")} ${phone}`}>
            <input
              className="input tracking-[0.3em] text-center"
              inputMode="numeric"
              maxLength={6}
              placeholder="••••••"
              value={code}
              onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))}
            />
          </Field>
          <Button onClick={verifyOtp} loading={loading}>
            {t("login.verify")}
          </Button>
          <button
            className="text-sm text-brand-dark w-full text-center"
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

      {error && <p className="text-sm text-red-600">{error}</p>}
    </div>
  );
}

function TeamLogin() {
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
      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ loginId, password }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      router.push(data.redirect);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="space-y-4">
      <Field label={t("login.loginIdLabel")}>
        <input
          className="input"
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
      {error && <p className="text-sm text-red-600">{error}</p>}
    </div>
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
  return (
    <button
      onClick={onClick}
      disabled={loading}
      className="w-full rounded-xl bg-brand text-white font-medium py-3 hover:bg-brand-dark transition disabled:opacity-60"
    >
      {loading ? "Please wait…" : children}
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
              i <= active ? "bg-brand" : "bg-black/10"
            }`}
          />
        </div>
      ))}
    </div>
  );
}
