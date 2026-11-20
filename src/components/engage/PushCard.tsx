"use client";

import { useEffect, useState } from "react";
import Icon from "@/components/Icon";
import { errText, send } from "@/components/admin/AdminKit";

export type PushInfo = {
  ready: boolean;
  publicKey: string | null;
  devices: { endpoint: string; userAgent: string | null; createdAt: string }[];
};

/** VAPID public key (base64url) → the bytes PushManager.subscribe wants. */
function keyBytes(base64url: string) {
  const pad = "=".repeat((4 - (base64url.length % 4)) % 4);
  const raw = atob((base64url + pad).replace(/-/g, "+").replace(/_/g, "/"));
  const out = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}

function sameKey(a: ArrayBuffer | null | undefined, b: Uint8Array) {
  if (!a) return false;
  const x = new Uint8Array(a);
  return x.length === b.length && x.every((v, i) => v === b[i]);
}

const supported = () =>
  typeof window !== "undefined" && "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;

/** The app's service worker (registered by the root layout on load; registered here if it isn't yet). */
async function registration() {
  const reg = (await navigator.serviceWorker.getRegistration()) ?? (await navigator.serviceWorker.register("/sw.js"));
  await navigator.serviceWorker.ready;
  return reg;
}

type State = "checking" | "unsupported" | "denied" | "off" | "on";

/** Turn phone / browser notifications on or off for THIS device. */
export default function PushCard({
  push,
  pushChannelOn,
  onDevicesChange,
}: {
  push: PushInfo;
  pushChannelOn: boolean;
  onDevicesChange: () => void;
}) {
  const [state, setState] = useState<State>("checking");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const available = push.ready && !!push.publicKey && pushChannelOn;
  const mine = push.devices.map((d) => d.endpoint).join(" ");

  useEffect(() => {
    if (!available) return;
    let live = true;
    (async () => {
      if (!supported()) return live && setState("unsupported");
      if (Notification.permission === "denied") return live && setState("denied");
      try {
        const reg = await registration();
        const sub = await reg.pushManager.getSubscription();
        // On only if this browser's subscription is saved for me (a shared phone may hold someone else's).
        if (live) setState(sub && mine.split(" ").includes(sub.endpoint) ? "on" : "off");
      } catch {
        if (live) setState("unsupported");
      }
    })();
    return () => {
      live = false;
    };
  }, [available, mine]);

  async function turnOn() {
    if (!push.publicKey) return;
    setBusy(true);
    setError(null);
    try {
      const perm = await Notification.requestPermission();
      if (perm !== "granted") {
        setState(perm === "denied" ? "denied" : "off");
        return;
      }
      const reg = await registration();
      const key = keyBytes(push.publicKey);
      let sub = await reg.pushManager.getSubscription();
      if (sub && !sameKey(sub.options.applicationServerKey, key)) {
        await sub.unsubscribe();
        sub = null;
      }
      sub ??= await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: key });
      await send("/api/notifications/push", "POST", sub.toJSON());
      setState("on");
      onDevicesChange();
    } catch (e) {
      setError(errText(e));
    } finally {
      setBusy(false);
    }
  }

  async function turnOff() {
    setBusy(true);
    setError(null);
    try {
      const reg = await registration();
      const sub = await reg.pushManager.getSubscription();
      if (sub) {
        await send("/api/notifications/push", "DELETE", { endpoint: sub.endpoint });
        await sub.unsubscribe();
      }
      setState("off");
      onDevicesChange();
    } catch (e) {
      setError(errText(e));
    } finally {
      setBusy(false);
    }
  }

  const count = push.devices.length;

  return (
    <section className="card p-4 space-y-3">
      <div className="flex items-start gap-3">
        <span className="icon-tile bg-[var(--kesar-tint)] text-[var(--kesar-text)] shrink-0">
          <Icon name="bell" />
        </span>
        <div className="min-w-0">
          <h2 className="font-bold text-base">Notifications on this phone</h2>
          <p className="text-xs text-[var(--muted)] mt-0.5">
            {count ? `On for ${count} phone${count === 1 ? "" : "s"} or browser${count === 1 ? "" : "s"}.` : "Not on for any phone yet."}
          </p>
        </div>
      </div>

      {!available ? (
        <p className="text-sm text-[var(--ink-2)]">
          Phone notifications are not set up for this business yet. Your messages still show here in the app.
        </p>
      ) : state === "checking" ? (
        <p className="text-sm text-[var(--muted)]">Checking this browser…</p>
      ) : state === "unsupported" ? (
        <p className="text-sm text-[var(--ink-2)]">
          This browser can&apos;t show notifications. On an iPhone, first add this app to your home screen (Share, then
          Add to Home Screen) and open it from there. On Android, use Chrome.
        </p>
      ) : state === "denied" ? (
        <p className="text-sm text-[var(--ink-2)]">
          Notifications are blocked for this site. Allow them in your browser&apos;s site settings, then come back here.
        </p>
      ) : state === "on" ? (
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="text-sm font-semibold text-[var(--mint-text)] flex items-center gap-1.5">
            <Icon name="check" className="h-4 w-4" /> On for this phone
          </p>
          <button type="button" className="btn btn-quiet btn-sm" disabled={busy} onClick={turnOff}>
            {busy ? "Turning off…" : "Turn off"}
          </button>
        </div>
      ) : (
        <button type="button" className="btn btn-kesar w-full" disabled={busy} onClick={turnOn}>
          <Icon name="bell" className="h-4 w-4" /> {busy ? "Turning on…" : "Turn on notifications"}
        </button>
      )}
      {error && <p className="text-sm text-[#a8281e]">{error}</p>}
    </section>
  );
}
