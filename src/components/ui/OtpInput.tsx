"use client";

import { useRef } from "react";

/** 4 to 6 digit boxes: auto-advance, backspace goes back, paste fills all boxes. */
export default function OtpInput({
  value,
  onChangeAction,
  length = 6,
  label = "One-time code",
  autoFocus = false,
  disabled = false,
}: {
  value: string;
  onChangeAction: (v: string) => void;
  length?: 4 | 5 | 6;
  label?: string;
  autoFocus?: boolean;
  disabled?: boolean;
}) {
  const refs = useRef<(HTMLInputElement | null)[]>([]);
  const digits = value.replace(/\D/g, "").slice(0, length).split("");

  const set = (next: string[]) => onChangeAction(next.join("").slice(0, length));
  const focus = (i: number) => refs.current[Math.max(0, Math.min(length - 1, i))]?.focus();

  return (
    <div role="group" aria-label={label} className="flex gap-2 justify-center">
      {Array.from({ length }, (_, i) => (
        <input
          key={i}
          ref={(el) => {
            refs.current[i] = el;
          }}
          inputMode="numeric"
          autoComplete={i === 0 ? "one-time-code" : "off"}
          aria-label={`${label} digit ${i + 1}`}
          maxLength={1}
          disabled={disabled}
          autoFocus={autoFocus && i === 0}
          value={digits[i] ?? ""}
          onFocus={(e) => e.target.select()}
          onChange={(e) => {
            const d = e.target.value.replace(/\D/g, "").slice(-1);
            const next = [...digits];
            if (d) next[i] = d;
            else next.splice(i, 1);
            set(next);
            if (d) focus(i + 1);
          }}
          onKeyDown={(e) => {
            if (e.key === "Backspace" && !digits[i]) {
              e.preventDefault();
              const next = [...digits];
              next.splice(i - 1, 1);
              set(next);
              focus(i - 1);
            }
            if (e.key === "ArrowLeft") focus(i - 1);
            if (e.key === "ArrowRight") focus(i + 1);
          }}
          onPaste={(e) => {
            const text = e.clipboardData.getData("text").replace(/\D/g, "").slice(0, length);
            if (!text) return;
            e.preventDefault();
            onChangeAction(text);
            focus(text.length >= length ? length - 1 : text.length);
          }}
          className="input !w-12 !px-0 text-center font-heading font-bold text-xl num"
          style={{ height: 56 }}
        />
      ))}
    </div>
  );
}
