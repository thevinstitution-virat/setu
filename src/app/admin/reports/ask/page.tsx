"use client";

import { useRef, useState, useSyncExternalStore } from "react";
import Link from "next/link";
import Icon from "@/components/Icon";
import { Section, Table, num, pct, rs } from "@/components/reports/Kit";
import { EXAMPLES } from "@/lib/ask-rules";
import type { AskAnswer, Column } from "@/lib/ask";

type Asked = { question: string; answer: AskAnswer };

// The browser's own speech-to-text (Chrome / Android).
type Recognition = { lang: string; interimResults: boolean; start: () => void; stop: () => void; onresult: ((e: { results: ArrayLike<ArrayLike<{ transcript: string }>> }) => void) | null; onerror: (() => void) | null; onend: (() => void) | null };
const recognitionClass = () => {
  if (typeof window === "undefined") return null;
  const w = window as unknown as { SpeechRecognition?: new () => Recognition; webkitSpeechRecognition?: new () => Recognition };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
};
const noSubscribe = () => () => {};

const cell = (kind: Column["kind"], v: string | number | null) =>
  v === null || v === undefined ? "–" : kind === "money" ? rs(v as number) : kind === "number" ? num(v as number) : kind === "pct" ? pct(v as number) : kind === "days" ? `${v} days` : String(v);

/** A11: ask the business a question in Hindi or English; answers come from the report queries. */
export default function AskPage() {
  const [q, setQ] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [asked, setAsked] = useState<Asked[]>([]);
  // false on the server, the real answer in the browser (no hydration mismatch).
  const canSpeak = useSyncExternalStore(noSubscribe, () => !!recognitionClass(), () => false);
  const [listening, setListening] = useState(false);
  const rec = useRef<Recognition | null>(null);

  async function send(question: string) {
    const text = question.trim();
    if (!text || busy) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/admin/ask", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ question: text }) });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) return setError(d.error ?? "Could not answer. Try again.");
      setAsked((a) => [{ question: text, answer: d.answer as AskAnswer }, ...a].slice(0, 6));
      setQ("");
    } catch {
      setError("Network error. Check your connection and try again.");
    } finally {
      setBusy(false);
    }
  }

  function listen() {
    const R = recognitionClass();
    if (!R) return;
    if (listening) return rec.current?.stop();
    const r = new R();
    r.lang = "hi-IN";
    r.interimResults = false;
    r.onresult = (e) => {
      const said = Array.from(e.results).map((x) => x[0].transcript).join(" ").trim();
      if (said) {
        setQ(said);
        void send(said);
      }
    };
    r.onerror = () => setError("The mic stopped. Try again or type the question.");
    r.onend = () => setListening(false);
    rec.current = r;
    try {
      r.start();
      setListening(true);
      setError(null);
    } catch {
      setError("The mic didn't start. Type the question instead.");
    }
  }

  return (
    <div className="space-y-5">
      <section className="card p-4 space-y-3">
        <div>
          <h2 className="font-heading font-bold text-[var(--ink)]">Ask your business</h2>
          <p className="text-xs text-[var(--muted)] mt-0.5">In Hindi or English. Answers come from your own reports, the same numbers as the tabs above.</p>
        </div>
        <form
          className="flex gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            void send(q);
          }}
        >
          <div className="relative flex-1">
            <input className="input !pr-11" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Who owes more than ₹20,000 for over 30 days?" maxLength={300} aria-label="Your question" enterKeyHint="send" />
            {canSpeak && (
              <button
                type="button"
                onClick={listen}
                aria-pressed={listening}
                aria-label={listening ? "Stop listening" : "Speak the question"}
                className={`absolute right-1.5 top-1/2 -translate-y-1/2 grid place-items-center h-8 w-8 rounded-full ${listening ? "bg-[var(--risk-text)] text-white animate-pulse" : "bg-[var(--accent-tint)] text-[var(--accent-text)]"}`}
              >
                <Icon name="mic" className="h-4 w-4" />
              </button>
            )}
          </div>
          <button className="btn btn-primary btn-sm shrink-0" disabled={!q.trim() || busy}>
            {busy ? "Working…" : "Ask"}
          </button>
        </form>
        <div className="flex flex-wrap gap-1.5">
          {EXAMPLES.map((e) => (
            <button key={e} type="button" className="chip !py-1 text-left" onClick={() => void send(e)} disabled={busy}>
              {e}
            </button>
          ))}
        </div>
        {error && <p className="text-sm text-[var(--risk-text)]">{error}</p>}
      </section>

      {asked.map(({ question, answer: a }, i) => (
        <Section
          key={`${i}-${question}`}
          title={a.title}
          sub={`“${question}”`}
          action={
            a.link ? (
              <Link href={a.link} className="btn btn-outline btn-xs shrink-0">
                Full report
              </Link>
            ) : undefined
          }
        >
          <p className="text-sm text-[var(--ink)]">{a.summary}</p>
          {a.understood.length > 0 && (
            <div className="flex flex-wrap items-center gap-1.5 text-xs text-[var(--muted)]">
              Read as:
              {a.understood.map((u) => (
                <span key={u} className="chip !py-0.5 !text-[11px]">
                  {u}
                </span>
              ))}
              {a.source === "ai" && <span className="chip chip-mor !py-0.5 !text-[11px]">read by AI · {a.credits} credit{a.credits === 1 ? "" : "s"}</span>}
            </div>
          )}
          {a.columns.length > 0 && (
            <Table
              head={a.columns.map((c) => c.label || " ")}
              align={a.columns.map((c) => (c.kind === "text" ? "l" : "r"))}
              rows={a.rows.map((r) => a.columns.map((c) => cell(c.kind, r[c.key])))}
            />
          )}
          {a.note && <p className="text-xs text-[var(--muted)]">{a.note}</p>}
        </Section>
      ))}
    </div>
  );
}
