"use client";

import { useEffect, useState } from "react";

const EVENT = "vbiz:toast";

/** Show a short message from anywhere on the client: toast("Scheme applied"). */
export function toast(message: string) {
  if (typeof window !== "undefined") window.dispatchEvent(new CustomEvent(EVENT, { detail: message }));
}

/** Mount once in a shell. Shows one toast at a time for 2.6 seconds. */
export function ToastHost() {
  const [msg, setMsg] = useState<{ id: number; text: string } | null>(null);
  useEffect(() => {
    let timer: number | undefined;
    const on = (e: Event) => {
      const text = (e as CustomEvent<string>).detail;
      setMsg({ id: Date.now(), text });
      window.clearTimeout(timer);
      timer = window.setTimeout(() => setMsg(null), 2600);
    };
    window.addEventListener(EVENT, on);
    return () => {
      window.removeEventListener(EVENT, on);
      window.clearTimeout(timer);
    };
  }, []);
  if (!msg) return null;
  return (
    <div key={msg.id} className="toast" role="status" aria-live="polite">
      {msg.text}
    </div>
  );
}
