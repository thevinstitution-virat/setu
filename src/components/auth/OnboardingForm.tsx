"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { BrandLockup } from "@/components/BrandMark";
import LanguageToggle from "@/components/LanguageToggle";
import { useLanguage } from "@/lib/i18n/LanguageProvider";

type Region = { id: string; name: string; areas: { id: string; name: string }[] };

const COPY = {
  en: {
    hello: "Welcome",
    intro: (business: string, role: string) => `You are signed in to ${business} as ${role}. Please tell us a little about yourself. It takes about a minute and you only do it once.`,
    shopIntro: (business: string) => `Welcome to ${business}. Tell us about your shop so we can deliver to the right place. It takes about a minute and you only do it once.`,
    name: "Your name",
    phone: "Mobile number",
    phoneHint: "So the office can reach you about orders and deliveries.",
    outlet: "Shop name",
    region: "Region",
    area: "Area",
    shopNumber: "Shop number",
    complex: "Market or complex name",
    pin: "PIN code",
    selectRegion: "Select region",
    selectArea: "Select area",
    save: "Save and continue",
    saving: "Saving…",
    fill: "Please fill in every field.",
    mobile: "Enter a 10-digit mobile number.",
    error: "Something went wrong. Please try again.",
    signedAs: "Signed in as",
    roleNote: {
      ADMIN: "You will manage orders, shops, stock, money and your team.",
      SALES_AGENT: "You will visit shops, take orders and collect payments.",
      DELIVERY_AGENT: "You will see your trips, deliver orders and collect cash.",
      SUPERVISOR: "You will look after your field team.",
      ACCOUNTANT: "You will keep the books.",
      RETAILER: "",
    } as Record<string, string>,
  },
  hi: {
    hello: "स्वागत है",
    intro: (business: string, role: string) => `आप ${business} में ${role} के रूप में साइन इन हैं। कृपया अपने बारे में थोड़ा बताइए। इसमें लगभग एक मिनट लगता है और यह सिर्फ़ एक बार होता है।`,
    shopIntro: (business: string) => `${business} में आपका स्वागत है। अपनी दुकान की जानकारी दीजिए ताकि माल सही जगह पहुँचे। इसमें लगभग एक मिनट लगता है और यह सिर्फ़ एक बार होता है।`,
    name: "आपका नाम",
    phone: "मोबाइल नंबर",
    phoneHint: "ताकि ऑफ़िस ऑर्डर और डिलीवरी के बारे में आपसे बात कर सके।",
    outlet: "दुकान का नाम",
    region: "क्षेत्र",
    area: "इलाका",
    shopNumber: "दुकान नंबर",
    complex: "मार्केट / कॉम्प्लेक्स का नाम",
    pin: "पिन कोड",
    selectRegion: "क्षेत्र चुनें",
    selectArea: "इलाका चुनें",
    save: "सहेजें और आगे बढ़ें",
    saving: "सहेज रहे हैं…",
    fill: "कृपया सभी जानकारी भरें।",
    mobile: "10 अंकों का मोबाइल नंबर लिखें।",
    error: "कुछ गड़बड़ हुई। कृपया दोबारा कोशिश करें।",
    signedAs: "साइन इन:",
    roleNote: {
      ADMIN: "आप ऑर्डर, दुकानें, स्टॉक, पैसा और अपनी टीम संभालेंगे।",
      SALES_AGENT: "आप दुकानों पर जाकर ऑर्डर लेंगे और भुगतान वसूलेंगे।",
      DELIVERY_AGENT: "आप अपने ट्रिप देखेंगे, डिलीवरी करेंगे और नकद लेंगे।",
      SUPERVISOR: "आप अपनी फ़ील्ड टीम को संभालेंगे।",
      ACCOUNTANT: "आप खाते-बही संभालेंगे।",
      RETAILER: "",
    } as Record<string, string>,
  },
};

/**
 * The first-sign-in form, built from the role: a shopkeeper describes the shop, everyone else
 * confirms a name and a mobile number. Saving sends the person to their own dashboard.
 */
export default function OnboardingForm({
  role,
  roleLabel,
  business,
  email,
  initialName,
  initialPhone,
}: {
  role: string;
  roleLabel: string;
  business: string;
  email: string;
  initialName: string;
  initialPhone: string;
}) {
  const router = useRouter();
  const { lang } = useLanguage();
  const c = COPY[lang];
  const shop = role === "RETAILER";
  const [name, setName] = useState(initialName);
  const [phone, setPhone] = useState(initialPhone);
  const [f, setF] = useState({ outletName: "", shopNumber: "", complexName: "", pinCode: "", regionId: "", areaId: "" });
  const [regions, setRegions] = useState<Region[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!shop) return;
    let live = true;
    fetch("/api/areas")
      .then((r) => r.json())
      .then((d) => live && setRegions(d.regions ?? []))
      .catch(() => {});
    return () => {
      live = false;
    };
  }, [shop]);

  const region = regions.find((r) => r.id === f.regionId);

  async function save() {
    setError(null);
    if (!name.trim() || (shop && (!f.outletName.trim() || !f.shopNumber.trim() || !f.complexName.trim() || !f.pinCode.trim() || !f.areaId))) return setError(c.fill);
    if (!/^\d{10}$/.test(phone)) return setError(c.mobile);
    setLoading(true);
    try {
      const res = await fetch("/api/onboarding", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, phone, ...(shop ? { outletName: f.outletName, shopNumber: f.shopNumber, complexName: f.complexName, pinCode: f.pinCode, areaId: f.areaId } : {}) }),
      });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(d.error ?? c.error);
      router.push(d.redirect);
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : c.error);
      setLoading(false);
    }
  }

  const field = (label: string, control: React.ReactNode, hint?: string) => (
    <label className="block">
      <span className="block text-sm font-medium text-foreground/70 mb-1">{label}</span>
      {control}
      {hint && <span className="block text-xs text-[var(--muted)] mt-1">{hint}</span>}
    </label>
  );

  return (
    <div className="min-h-screen flex flex-col items-center justify-center px-4 py-10">
      <div className="w-full max-w-md">
        <div className="flex items-center justify-between gap-3 mb-8">
          <BrandLockup name={business} large />
          <LanguageToggle />
        </div>
        <div className="card p-6 sm:p-7 space-y-4">
          <div>
            <p className="page-kick">{roleLabel}</p>
            <h1 className="page-title">{c.hello}</h1>
            <p className="page-sub">{shop ? c.shopIntro(business) : c.intro(business, roleLabel)}</p>
            {c.roleNote[role] && <p className="text-sm text-[var(--ink-2)] mt-2">{c.roleNote[role]}</p>}
            {email && (
              <p className="text-xs text-[var(--muted)] mt-2">
                {c.signedAs} {email}
              </p>
            )}
          </div>

          {field(c.name, <input className="input" value={name} onChange={(e) => setName(e.target.value)} autoComplete="name" />)}
          {field(c.phone, <input className="input" inputMode="numeric" maxLength={10} placeholder="98765 43210" value={phone} onChange={(e) => setPhone(e.target.value.replace(/\D/g, "").slice(0, 10))} autoComplete="tel-national" />, c.phoneHint)}

          {shop && (
            <>
              {field(c.outlet, <input className="input" value={f.outletName} onChange={(e) => setF({ ...f, outletName: e.target.value })} />)}
              {field(
                c.region,
                <select className="input" value={f.regionId} onChange={(e) => setF({ ...f, regionId: e.target.value, areaId: "" })}>
                  <option value="">{c.selectRegion}</option>
                  {regions.map((r) => (
                    <option key={r.id} value={r.id}>
                      {r.name}
                    </option>
                  ))}
                </select>
              )}
              {field(
                c.area,
                <select className="input" value={f.areaId} disabled={!region} onChange={(e) => setF({ ...f, areaId: e.target.value })}>
                  <option value="">{c.selectArea}</option>
                  {region?.areas.map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.name}
                    </option>
                  ))}
                </select>
              )}
              {field(c.shopNumber, <input className="input" value={f.shopNumber} onChange={(e) => setF({ ...f, shopNumber: e.target.value })} />)}
              {field(c.complex, <input className="input" value={f.complexName} onChange={(e) => setF({ ...f, complexName: e.target.value })} />)}
              {field(c.pin, <input className="input" inputMode="numeric" maxLength={6} value={f.pinCode} onChange={(e) => setF({ ...f, pinCode: e.target.value.replace(/\D/g, "").slice(0, 6) })} />)}
            </>
          )}

          {error && (
            <p role="alert" className="text-sm text-[var(--risk-text,#a8281e)]">
              {error}
            </p>
          )}
          <button type="button" className="btn btn-kesar w-full" onClick={save} disabled={loading}>
            {loading ? c.saving : c.save}
          </button>
        </div>
      </div>
    </div>
  );
}
