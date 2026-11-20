"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import Icon from "@/components/Icon";
import { FEEDBACK_TAGS, type FeedbackTag } from "@/lib/engage-settings";
import { errText, send } from "@/components/admin/AdminKit";
import { useLanguage } from "@/lib/i18n/LanguageProvider";

const WORDS = ["", "Very bad", "Bad", "Okay", "Good", "Very good"];
const TAGS = Object.entries(FEEDBACK_TAGS) as [FeedbackTag, (typeof FEEDBACK_TAGS)[FeedbackTag]][];

/**
 * Rate a delivered order: 1–5 stars, a few quick tags, a comment. `focus`
 * (?rate=1 from the "delivered" notification) scrolls here; `stars` (from the
 * home prompt) picks the stars already.
 */
export default function RateDelivery({ orderId, focus, stars }: { orderId: string; focus: boolean; stars: number | null }) {
  const router = useRouter();
  const { lang } = useLanguage();
  const [rating, setRating] = useState(stars && stars >= 1 && stars <= 5 ? stars : 0);
  const [tags, setTags] = useState<FeedbackTag[]>([]);
  const [comment, setComment] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const box = useRef<HTMLElement>(null);
  const first = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!focus) return;
    box.current?.scrollIntoView({ behavior: "smooth", block: "center" });
    first.current?.focus({ preventScroll: true });
  }, [focus]);

  // Good tags for good ratings, problems for poor ones, all for "okay".
  const shown = TAGS.filter(([, t]) => (rating >= 4 ? t.good : rating && rating <= 2 ? !t.good : true));

  async function submit() {
    if (!rating) return setError("Pick 1 to 5 stars");
    setSaving(true);
    setError(null);
    try {
      await send("/api/feedback", "POST", {
        orderId,
        rating,
        tags: tags.filter((k) => shown.some(([s]) => s === k)),
        comment: comment.trim(),
      });
      setDone(true);
      router.refresh();
    } catch (e) {
      setError(errText(e));
    } finally {
      setSaving(false);
    }
  }

  if (done) {
    return (
      <section className="card p-4 flex items-center gap-3">
        <span className="icon-tile bg-[var(--mint-tint)] text-[var(--mint-text)] shrink-0">
          <Icon name="check" />
        </span>
        <p className="text-sm font-semibold">Thank you for rating this delivery.</p>
      </section>
    );
  }

  return (
    <section ref={box} id="rate" className={`card p-4 space-y-3 ${focus ? "border-2 !border-[var(--genda)]" : ""}`}>
      <div>
        <h2 className="font-bold text-base">How was this delivery?</h2>
        <p className="text-xs text-[var(--muted)] mt-0.5">Your rating helps us improve. Only the office sees it.</p>
      </div>

      <div className="flex items-center gap-1" role="radiogroup" aria-label="Stars">
        {[1, 2, 3, 4, 5].map((n) => (
          <button
            key={n}
            ref={n === 1 ? first : undefined}
            type="button"
            role="radio"
            aria-checked={rating === n}
            aria-label={`${n} star${n === 1 ? "" : "s"}: ${WORDS[n]}`}
            onClick={() => setRating(n)}
            className={`grid place-items-center h-11 w-11 rounded-xl transition ${
              n <= rating ? "text-[var(--genda)]" : "text-ink/20 hover:text-ink/35"
            }`}
          >
            <Icon name="star" className="h-8 w-8" />
          </button>
        ))}
        {rating > 0 && <span className="ml-2 text-sm font-semibold text-[var(--ink-2)]">{WORDS[rating]}</span>}
      </div>

      {rating > 0 && (
        <>
          <div className="flex flex-wrap gap-2">
            {shown.map(([k, t]) => {
              const on = tags.includes(k);
              return (
                <button
                  key={k}
                  type="button"
                  aria-pressed={on}
                  onClick={() => setTags(on ? tags.filter((x) => x !== k) : [...tags, k])}
                  className={`chip !py-2 !px-3 min-h-[40px] ${on ? (t.good ? "chip-mint" : "chip-kesar") : ""}`}
                >
                  {lang === "hi" ? t.hi : t.label}
                </button>
              );
            })}
          </div>
          <textarea
            className="input min-h-[80px]"
            maxLength={500}
            value={comment}
            placeholder="Anything else? (optional)"
            onChange={(e) => setComment(e.target.value)}
          />
          {rating <= 2 && (
            <p className="text-xs text-[var(--muted)]">
              Goods damaged or missing? Raise a complaint too, so we can make it right.
            </p>
          )}
        </>
      )}

      {error && <p className="text-sm text-[#a8281e]">{error}</p>}
      <button type="button" className="btn btn-kesar w-full" disabled={saving || !rating} onClick={submit}>
        {saving ? "Sending…" : "Send rating"}
      </button>
    </section>
  );
}
