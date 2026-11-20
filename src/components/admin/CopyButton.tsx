"use client";

import { useState } from "react";
import Icon from "@/components/Icon";

/** Small "Copy" button; shows "Copied" for two seconds. */
export default function CopyButton({ text, label = "Copy", className = "" }: { text: string; label?: string; className?: string }) {
  const [state, setState] = useState<"idle" | "done" | "failed">("idle");

  async function copy() {
    try {
      await navigator.clipboard.writeText(text);
      setState("done");
    } catch {
      setState("failed");
    }
    setTimeout(() => setState("idle"), 2000);
  }

  return (
    <button type="button" className={`btn btn-quiet btn-xs shrink-0 ${className}`} onClick={copy}>
      <Icon name={state === "done" ? "check" : "clipboard"} className="h-3.5 w-3.5" />
      {state === "done" ? "Copied" : state === "failed" ? "Select and copy" : label}
    </button>
  );
}

/** A value in a mono box with a copy button, wrapping on small screens. */
export function CopyLine({ value, label }: { value: string; label?: string }) {
  return (
    <div className="flex items-start gap-2 rounded-xl bg-ink/5 px-3 py-2 min-w-0">
      <code className="flex-1 min-w-0 font-mono text-xs break-all select-all py-1">{value}</code>
      <CopyButton text={value} label={label} />
    </div>
  );
}
