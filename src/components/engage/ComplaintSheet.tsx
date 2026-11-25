"use client";

import { useState } from "react";
import { formatINR } from "@/lib/money";
import { useLanguage } from "@/lib/i18n/LanguageProvider";
import { TICKET_CATEGORIES, type TicketCategory } from "@/lib/engage-settings";
import { Field, Sheet, errText, send } from "@/components/admin/AdminKit";
import PhotoPicker from "@/components/engage/PhotoPicker";

export type OrderOption = { id: string; orderNumber: string; totalAmount: number; createdAt: string };
export type Raised = { id: string; number: string };

const day = (iso: string) => new Date(iso).toLocaleDateString("en-IN", { day: "numeric", month: "short", timeZone: "Asia/Kolkata" });

/**
 * Raise a complaint: what the problem is, which order (optional), a short
 * subject, the message and up to 4 photos. Staff pass `retailerId` (the shop
 * they are raising it for); a retailer raises for their own shop.
 */
export default function ComplaintSheet({
  orders,
  retailerId,
  shopName,
  initialOrderId,
  initialCategory,
  onClose,
  onRaised,
}: {
  orders: OrderOption[];
  retailerId?: string;
  shopName?: string;
  initialOrderId?: string | null;
  initialCategory?: TicketCategory | null;
  onClose: () => void;
  onRaised: (t: Raised) => void;
}) {
  const { lang } = useLanguage();
  const [category, setCategory] = useState<TicketCategory | null>(initialCategory ?? null);
  const [orderId, setOrderId] = useState(initialOrderId && orders.some((o) => o.id === initialOrderId) ? initialOrderId : "");
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [photos, setPhotos] = useState<string[]>([]);
  const [uploading, setUploading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const catLabel = (k: TicketCategory) => (lang === "hi" ? TICKET_CATEGORIES[k].hi : TICKET_CATEGORIES[k].label);

  async function submit() {
    setError(null);
    if (!category) return setError("Pick what the problem is");
    if (body.trim().length < 5) return setError("Tell us a little more (at least 5 letters)");
    setSaving(true);
    try {
      const r = await send<{ result: Raised }>("/api/tickets", "POST", {
        ...(retailerId ? { retailerId } : {}),
        category,
        orderId: orderId || null,
        subject: subject.trim(),
        body: body.trim(),
        photoKeys: photos,
      });
      onRaised(r.result);
    } catch (e) {
      setError(errText(e));
    } finally {
      setSaving(false);
    }
  }

  return (
    <Sheet
      title={shopName ? `Complaint for ${shopName}` : "New complaint"}
      onClose={onClose}
      footer={
        <div className="space-y-2">
          {error && <p className="text-sm text-[var(--risk-text)]">{error}</p>}
          <div className="flex gap-2">
            <button type="button" className="btn btn-quiet flex-1" onClick={onClose} disabled={saving}>
              Cancel
            </button>
            <button type="button" className="btn btn-kesar flex-[2]" onClick={submit} disabled={saving || uploading}>
              {saving ? "Sending…" : uploading ? "Adding photos…" : "Send complaint"}
            </button>
          </div>
        </div>
      }
    >
      <div className="space-y-2">
        <p className="text-sm font-medium text-[var(--ink-2)]">What is the problem?</p>
        <div className="flex flex-wrap gap-2" role="radiogroup" aria-label="What is the problem?">
          {(Object.keys(TICKET_CATEGORIES) as TicketCategory[]).map((k) => (
            <button
              key={k}
              type="button"
              role="radio"
              aria-checked={category === k}
              onClick={() => setCategory(k)}
              className={`chip !py-2 !px-3 min-h-[40px] ${category === k ? "chip-mor" : ""}`}
            >
              {catLabel(k)}
            </button>
          ))}
        </div>
      </div>

      <Field label="Which order? (optional)" hint={orders.length ? undefined : "No recent orders."}>
        <select className="input" value={orderId} onChange={(e) => setOrderId(e.target.value)} disabled={!orders.length}>
          <option value="">Not about one order</option>
          {orders.map((o) => (
            <option key={o.id} value={o.id}>
              {o.orderNumber} · {day(o.createdAt)} · {formatINR(o.totalAmount)}
            </option>
          ))}
        </select>
      </Field>

      <Field label="Subject (optional)">
        <input
          className="input"
          maxLength={120}
          value={subject}
          placeholder={category ? TICKET_CATEGORIES[category].label : "A few words"}
          onChange={(e) => setSubject(e.target.value)}
        />
      </Field>

      <Field label="What happened?">
        <textarea
          className="input min-h-[120px]"
          maxLength={2000}
          value={body}
          placeholder="For example: 2 boxes of biscuits were crushed."
          onChange={(e) => setBody(e.target.value)}
        />
      </Field>

      <div className="space-y-1.5">
        <p className="text-sm font-medium text-[var(--ink-2)]">Photos (up to 4)</p>
        <PhotoPicker value={photos} onChange={setPhotos} onBusy={setUploading} />
      </div>
    </Sheet>
  );
}
