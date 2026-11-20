"use client";

import { use, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import Icon from "@/components/Icon";
import { formatINR, gstOn } from "@/lib/money";
import { Field, Sheet, errText, readRupees, send, useFetch } from "@/components/admin/AdminKit";
import {
  EINV_LABEL,
  InvoicePanel,
  type InvoiceJson,
  type InvoiceLineJson,
  type InvoiceResponse,
} from "@/components/invoice/InvoiceView";

export default function AdminInvoicePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  return (
    <div className="space-y-4 max-w-3xl">
      <Link href="/admin/invoices" className="inline-flex items-center gap-1 text-sm font-bold text-[var(--ink-2)]">
        <Icon name="arrow" className="h-4 w-4 rotate-180" /> All invoices
      </Link>
      <InvoicePanel
        key={id}
        id={id}
        noteHref={(noteId) => `/admin/invoices/${noteId}`}
        extra={(r, reload) => <Actions r={r} reload={reload} />}
      />
    </div>
  );
}

// ───────────────────────────── actions ─────────────────────────────

function Actions({ r, reload }: { r: InvoiceResponse; reload: () => void }) {
  const inv = r.invoice;
  const [sheet, setSheet] = useState<null | "CREDIT_NOTE" | "DEBIT_NOTE">(null);
  const showEinv = r.can.einvoice || r.can.cancelEinvoice || r.einvoiceProblems.length > 0;

  return (
    <div className="space-y-4">
      {r.can.eway && inv.ewayNeeded && (
        <div className="card p-4 flex items-start gap-3 !bg-[var(--genda-tint)]">
          <span className="icon-tile bg-white/70 text-[var(--genda-text)]">
            <Icon name="truck" />
          </span>
          <div className="min-w-0">
            <p className="font-bold text-sm">E-way bill needed</p>
            <p className="text-sm text-[var(--ink-2)]">
              This invoice is {formatINR(inv.total)}, over the e-way bill limit. Make one before the goods leave.
            </p>
            <a href="#eway" className="btn btn-kesar btn-xs mt-2">
              Make e-way bill
            </a>
          </div>
        </div>
      )}

      <LinksCard inv={inv} />

      {(r.can.creditNote || r.can.debitNote) && (
        <section className="card p-4 space-y-3">
          <div>
            <p className="font-heading font-bold">Correct this invoice</p>
            <p className="text-sm text-[var(--muted)]">
              An issued invoice can&apos;t be edited. A credit note lowers what the retailer owes (returns, discounts, cancelling); a debit note
              raises it (a missed charge, a rate that was too low). Both go into their khata.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            {r.can.creditNote && (
              <button type="button" className="btn btn-primary btn-sm" onClick={() => setSheet("CREDIT_NOTE")}>
                <Icon name="receipt" className="h-4 w-4" /> Issue credit note
              </button>
            )}
            {r.can.debitNote && (
              <button type="button" className="btn btn-outline btn-sm" onClick={() => setSheet("DEBIT_NOTE")}>
                <Icon name="plus" className="h-4 w-4" /> Issue debit note
              </button>
            )}
          </div>
        </section>
      )}

      {showEinv && <EInvoiceCard r={r} reload={reload} />}
      {r.can.eway && <EwayCard inv={inv} reload={reload} />}

      {sheet && <NoteSheet type={sheet} inv={inv} onClose={() => setSheet(null)} />}
    </div>
  );
}

function LinksCard({ inv }: { inv: InvoiceJson }) {
  const links: { href: string; label: string; icon: "box" | "book" | "file" }[] = [];
  if (inv.original) links.push({ href: `/admin/invoices/${inv.original.id}`, label: `Invoice ${inv.original.number}`, icon: "file" });
  if (inv.order) links.push({ href: `/admin/orders?q=${encodeURIComponent(inv.order.orderNumber)}`, label: `Order ${inv.order.orderNumber}`, icon: "box" });
  if (inv.retailerId) links.push({ href: `/admin/khata/${inv.retailerId}`, label: `Khata of ${inv.buyer.tradeName || inv.buyer.legalName}`, icon: "book" });
  if (!links.length) return null;
  return (
    <div className="flex flex-wrap gap-2">
      {links.map((l) => (
        <Link key={l.href} href={l.href} className="chip max-w-full">
          <Icon name={l.icon} className="h-3.5 w-3.5 shrink-0" />
          <span className="truncate">{l.label}</span>
        </Link>
      ))}
    </div>
  );
}

// ───────────────────────────── credit / debit note ─────────────────────────────

type Kind = "return" | "value" | "cancel";

const KINDS: { key: Kind; label: string; hint: string }[] = [
  { key: "return", label: "Goods returned", hint: "The retailer sent goods back." },
  { key: "value", label: "Change in value", hint: "Lower the price of some lines (discount, rate difference, damage)." },
  { key: "cancel", label: "Cancel the whole invoice", hint: "Credit everything on this invoice that hasn't been credited yet." },
];

const REASONS: Record<Kind | "debit", string[]> = {
  return: ["Damaged goods", "Expired goods", "Wrong item sent", "Not ordered"],
  value: ["Rate difference", "Extra discount", "Short supply", "Damaged in transit"],
  cancel: ["Order cancelled", "Billed by mistake"],
  debit: ["Rate was too low", "Missed charge", "Freight charge"],
};

type Restock = "good" | "damaged" | "expired" | "none";

const RESTOCK: { key: Restock; label: string }[] = [
  { key: "good", label: "Good (back on the shelf)" },
  { key: "damaged", label: "Damaged" },
  { key: "expired", label: "Expired" },
  { key: "none", label: "Don't put back" },
];

/** Rough GST on a part of a line, at the line's rate (zero when the line carried no GST). */
function lineTax(l: InvoiceLineJson, taxable: number) {
  return l.cgst + l.sgst + l.igst > 0 ? gstOn(taxable, l.gstRate) : 0;
}

function NoteSheet({ type, inv, onClose }: { type: "CREDIT_NOTE" | "DEBIT_NOTE"; inv: InvoiceJson; onClose: () => void }) {
  const router = useRouter();
  const credit = type === "CREDIT_NOTE";
  const [kind, setKind] = useState<Kind>(credit ? "return" : "value");
  const [qty, setQty] = useState<Record<string, string>>({});
  const [amt, setAmt] = useState<Record<string, string>>({});
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Returned goods can go back into stock when stock tracking is on (alerts is null when it's off).
  const stockOn = useFetch<{ alerts: unknown }>(credit ? "/api/stock/alerts" : null);
  const canRestock = credit && !!stockOn.data && stockOn.data.alerts !== null;
  const [restock, setRestock] = useState<Restock>("good");
  const [restocked, setRestocked] = useState<{ noteId: string; text: string } | null>(null);

  const lines =
    kind === "return" ? inv.lines.filter((l) => !l.isService && l.quantity > 0) : credit ? inv.lines.filter((l) => l.taxable > 0) : inv.lines;

  // Build the request lines and a live estimate (the server has the final word).
  let problem: string | null = null;
  let taxable = 0;
  let tax = 0;
  const body: { lineId: string; quantity?: number; amount?: number }[] = [];
  if (kind === "return") {
    for (const l of lines) {
      const s = (qty[l.id] ?? "").trim();
      if (!s) continue;
      const n = Number(s);
      if (!Number.isInteger(n) || n < 0) {
        problem = `${l.description}: returned quantity must be a whole number`;
        continue;
      }
      if (n === 0) continue;
      if (n > l.quantity) {
        problem = `${l.description}: only ${l.quantity} ${l.unit} were billed`;
        continue;
      }
      const t = Math.round((l.taxable * n) / l.quantity);
      taxable += t;
      tax += lineTax(l, t);
      body.push({ lineId: l.id, quantity: n });
    }
  } else if (kind === "value") {
    for (const l of lines) {
      const p = readRupees(amt[l.id] ?? "");
      if (p === null || p === 0) continue;
      if (p === "bad") {
        problem = `${l.description}: enter an amount in rupees`;
        continue;
      }
      if (credit && p > l.taxable) {
        problem = `${l.description}: at most ${formatINR(l.taxable)} (its value before GST)`;
        continue;
      }
      taxable += p;
      tax += lineTax(l, p);
      body.push({ lineId: l.id, amount: p });
    }
  }
  const credited = inv.notes.filter((n) => n.type === "CREDIT_NOTE").reduce((a, n) => a + n.total, 0);
  const cancelLeft = Math.max(0, inv.total - credited);

  async function submit() {
    if (problem) return setError(problem);
    if (kind !== "cancel" && body.length === 0)
      return setError(kind === "return" ? "Enter how many came back on at least one line" : "Enter an amount on at least one line");
    if (!reason.trim()) return setError("Give a reason (it prints on the note)");
    setBusy(true);
    setError(null);
    try {
      const putBack = canRestock && kind === "return" && restock !== "none" ? restock : null;
      const res = await send<{ note: { id: string }; restocked?: { productId: string; qty: number }[] }>(`/api/invoices/${inv.id}/notes`, "POST", {
        type,
        kind,
        reason: reason.trim(),
        lines: kind === "cancel" ? [] : body,
        ...(putBack ? { restock: putBack } : {}),
      });
      if (!putBack) return router.push(`/admin/invoices/${res.note.id}`);
      const back = res.restocked ?? [];
      const units = back.reduce((a, r) => a + r.qty, 0);
      const where = putBack === "good" ? "back on the shelf" : `in the damaged bin (${putBack})`;
      setRestocked({
        noteId: res.note.id,
        text: back.length
          ? `${units} unit${units === 1 ? "" : "s"} of ${back.length} product${back.length === 1 ? "" : "s"} put ${where}.`
          : "Nothing went back into stock: the order isn't delivered yet, or these goods already came back.",
      });
      setBusy(false);
    } catch (e) {
      setError(errText(e));
      setBusy(false);
    }
  }

  const total = taxable + tax;
  if (restocked) {
    return (
      <Sheet
        title="Credit note issued"
        onClose={() => router.push(`/admin/invoices/${restocked.noteId}`)}
        footer={
          <div className="flex justify-end">
            <button type="button" className="btn btn-kesar btn-sm" onClick={() => router.push(`/admin/invoices/${restocked.noteId}`)}>
              Open credit note
            </button>
          </div>
        }
      >
        <div className="rounded-2xl bg-[var(--mint-tint)] p-3 text-sm text-[var(--mint-text)] flex items-start gap-2" role="status">
          <Icon name="check" className="h-4 w-4 shrink-0 mt-0.5" />
          <span>{restocked.text}</span>
        </div>
      </Sheet>
    );
  }
  return (
    <Sheet
      title={credit ? `Credit note on ${inv.number}` : `Debit note on ${inv.number}`}
      onClose={onClose}
      footer={
        <div className="space-y-2">
          <div className="flex items-center justify-between gap-2 text-sm">
            <span className="text-[var(--muted)]">{kind === "cancel" ? "Credits up to about" : "Note total, about"}</span>
            <span className="font-heading font-bold text-lg">{formatINR(kind === "cancel" ? cancelLeft : total)}</span>
          </div>
          {kind !== "cancel" && total > 0 && (
            <p className="text-xs text-[var(--muted)] -mt-1.5 text-right">
              {formatINR(taxable)} + {formatINR(tax)} GST
            </p>
          )}
          {error && <p className="text-sm text-[#a8281e]">{error}</p>}
          <div className="flex gap-2 justify-end">
            <button type="button" className="btn btn-quiet btn-sm" onClick={onClose} disabled={busy}>
              Cancel
            </button>
            <button type="button" className="btn btn-kesar btn-sm" onClick={submit} disabled={busy}>
              {busy ? "Issuing…" : credit ? "Issue credit note" : "Issue debit note"}
            </button>
          </div>
        </div>
      }
    >
      {credit ? (
        <div className="space-y-2" role="radiogroup" aria-label="What happened">
          {KINDS.map((k) => (
            <button
              key={k.key}
              type="button"
              role="radio"
              aria-checked={kind === k.key}
              onClick={() => {
                setKind(k.key);
                setError(null);
              }}
              className={`w-full text-left rounded-2xl border px-3 py-2.5 transition ${
                kind === k.key ? "border-mor bg-[var(--mint-tint)]" : "border-[var(--line)] bg-white"
              }`}
            >
              <span className="block text-sm font-bold">{k.label}</span>
              <span className="block text-xs text-[var(--muted)]">{k.hint}</span>
            </button>
          ))}
        </div>
      ) : (
        <p className="text-sm text-[var(--ink-2)]">
          Add value to lines on this invoice, before GST. GST is added at each line&apos;s rate and the total goes into the retailer&apos;s khata.
        </p>
      )}

      {kind === "cancel" ? (
        <div className="rounded-2xl bg-ink/5 p-3 text-sm text-[var(--ink-2)] space-y-1">
          <p>Everything on this invoice that hasn&apos;t been credited yet is credited back, and the retailer&apos;s bill is cleared.</p>
          {credited > 0 && <p className="text-xs text-[var(--muted)]">Already credited: {formatINR(credited)}.</p>}
        </div>
      ) : (
        <div className="space-y-2">
          <p className="text-sm font-medium text-[var(--ink-2)]">
            {kind === "return" ? "How many came back?" : credit ? "Lower the value by (₹, before GST)" : "Add value (₹, before GST)"}
          </p>
          {lines.length === 0 && <p className="text-sm text-[var(--muted)]">No lines on this invoice can take this.</p>}
          <ul className="divide-y divide-[var(--line)] rounded-2xl border border-[var(--line)] bg-white">
            {lines.map((l) => (
              <li key={l.id} className="flex items-center gap-3 px-3 py-2.5">
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium break-words">{l.description}</p>
                  <p className="text-xs text-[var(--muted)]">
                    {kind === "return"
                      ? `Billed ${l.quantity} ${l.unit}${l.freeQty ? ` (${l.freeQty} free)` : ""} · ${formatINR(l.taxable)}`
                      : `${l.quantity > 0 ? `${l.quantity} ${l.unit} · ` : ""}${formatINR(l.taxable)} before GST · GST ${l.gstRate}%`}
                  </p>
                </div>
                {kind === "return" ? (
                  <input
                    className="input !w-20 shrink-0 text-right"
                    inputMode="numeric"
                    placeholder="0"
                    aria-label={`Returned quantity of ${l.description}`}
                    value={qty[l.id] ?? ""}
                    onChange={(e) => {
                      setQty({ ...qty, [l.id]: e.target.value.replace(/\D/g, "") });
                      setError(null);
                    }}
                  />
                ) : (
                  <input
                    className="input !w-24 shrink-0 text-right"
                    inputMode="decimal"
                    placeholder="₹0"
                    aria-label={`Amount for ${l.description}`}
                    value={amt[l.id] ?? ""}
                    onChange={(e) => {
                      setAmt({ ...amt, [l.id]: e.target.value.replace(/[^\d.]/g, "") });
                      setError(null);
                    }}
                  />
                )}
              </li>
            ))}
          </ul>
          {problem && <p className="text-xs text-[#a8281e]">{problem}</p>}
        </div>
      )}

      {kind === "return" && canRestock && (
        <div className="space-y-2">
          <p className="text-sm font-medium text-[var(--ink-2)]">Goods back in stock?</p>
          <div className="grid grid-cols-2 gap-2" role="radiogroup" aria-label="Goods back in stock?">
            {RESTOCK.map((o) => (
              <button
                key={o.key}
                type="button"
                role="radio"
                aria-checked={restock === o.key}
                onClick={() => setRestock(o.key)}
                className={`min-h-[44px] rounded-2xl border px-3 py-2 text-left text-sm font-semibold transition ${
                  restock === o.key ? "border-mor bg-[var(--mint-tint)]" : "border-[var(--line)] bg-white"
                }`}
              >
                {o.label}
              </button>
            ))}
          </div>
          <p className="text-xs text-[var(--muted)]">
            {restock === "good"
              ? "Goes back into the loading warehouse, in the batch it was sold from."
              : restock === "none"
                ? "Stock stays as it is."
                : "Goes to the damaged bin. Clear it from Stock later."}
          </p>
        </div>
      )}

      <Field label="Reason" hint="Prints on the note and shows in the khata.">
        <input
          className="input"
          maxLength={200}
          value={reason}
          placeholder="e.g. Damaged goods"
          onChange={(e) => {
            setReason(e.target.value);
            setError(null);
          }}
        />
      </Field>
      <div className="flex flex-wrap gap-1.5 -mt-2">
        {REASONS[credit ? kind : "debit"].map((s) => (
          <button
            key={s}
            type="button"
            className="chip !py-1"
            onClick={() => {
              setReason(s);
              if (s === "Damaged goods") setRestock("damaged");
              else if (s === "Expired goods") setRestock("expired");
            }}
          >
            {s}
          </button>
        ))}
      </div>
    </Sheet>
  );
}

// ───────────────────────────── e-invoice ─────────────────────────────

function EInvoiceCard({ r, reload }: { r: InvoiceResponse; reload: () => void }) {
  const inv = r.invoice;
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [cancelling, setCancelling] = useState(false);
  const [reason, setReason] = useState("");

  async function act(body: { action: "generate" } | { action: "cancel"; reason: string }) {
    setBusy(true);
    setError(null);
    try {
      await send(`/api/invoices/${inv.id}/einvoice`, "POST", body);
      setCancelling(false);
      setReason("");
      reload();
    } catch (e) {
      setError(errText(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="card p-4 space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="font-heading font-bold">e-Invoice</p>
        {inv.einvStatus !== "NOT_REQUIRED" && <span className="chip">{EINV_LABEL[inv.einvStatus]}</span>}
      </div>
      {inv.einvStatus === "FAILED" && inv.einvError && <p className="text-sm text-[var(--kesar-text)]">Last try: {inv.einvError}</p>}
      {r.einvoiceProblems.length > 0 && (
        <div className="rounded-2xl bg-[var(--genda-tint)] p-3 text-sm space-y-1">
          <p className="font-semibold">Fix these first</p>
          <ul className="list-disc pl-5 space-y-0.5">
            {r.einvoiceProblems.map((p) => (
              <li key={p}>{p}</li>
            ))}
          </ul>
          <p className="text-xs text-[var(--ink-2)]">
            Your details are in{" "}
            <Link href="/admin/settings#gst" className="font-semibold underline">
              Settings
            </Link>
            {inv.retailerId && (
              <>
                ; the retailer&apos;s GSTIN is on their{" "}
                <Link href={`/admin/khata/${inv.retailerId}`} className="font-semibold underline">
                  khata
                </Link>
              </>
            )}
            . Changes apply to the e-invoice when you try again.
          </p>
        </div>
      )}
      {r.can.einvoice && (
        <button type="button" className="btn btn-primary btn-sm" disabled={busy} onClick={() => act({ action: "generate" })}>
          {busy && !cancelling ? "Working…" : inv.einvStatus === "FAILED" ? "Try again" : "Generate e-invoice"}
        </button>
      )}
      {r.can.cancelEinvoice &&
        (cancelling ? (
          <div className="space-y-2 rounded-2xl border border-[var(--line)] p-3">
            <p className="text-sm text-[var(--ink-2)]">
              Cancelling is allowed within 24 hours of generating. The invoice itself stays; issue a credit note if the sale is also reversed.
            </p>
            <Field label="Reason for cancelling">
              <input className="input" maxLength={100} value={reason} placeholder="e.g. Wrong GSTIN on invoice" onChange={(e) => setReason(e.target.value)} />
            </Field>
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                className="btn btn-danger btn-sm"
                disabled={busy || !reason.trim()}
                onClick={() => act({ action: "cancel", reason: reason.trim() })}
              >
                {busy ? "Cancelling…" : "Cancel e-invoice"}
              </button>
              <button type="button" className="btn btn-quiet btn-sm" disabled={busy} onClick={() => setCancelling(false)}>
                Keep it
              </button>
            </div>
          </div>
        ) : (
          <button type="button" className="btn btn-quiet btn-sm" onClick={() => setCancelling(true)}>
            Cancel e-invoice
          </button>
        ))}
      {error && <p className="text-sm text-[#a8281e]">{error}</p>}
    </section>
  );
}

// ───────────────────────────── e-way bill ─────────────────────────────

function EwayCard({ inv, reload }: { inv: InvoiceJson; reload: () => void }) {
  const [vehicle, setVehicle] = useState("");
  const [km, setKm] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    const vehicleNo = vehicle.replace(/[\s-]/g, "").toUpperCase();
    const distanceKm = Number(km);
    if (!vehicleNo) return setError("Enter the vehicle number");
    if (!km.trim() || !Number.isInteger(distanceKm) || distanceKm < 1) return setError("Distance must be whole kilometres (1 or more)");
    setBusy(true);
    setError(null);
    try {
      await send(`/api/invoices/${inv.id}/eway`, "POST", { vehicleNo, distanceKm });
      reload();
    } catch (e) {
      setError(errText(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section id="eway" className={`card p-4 space-y-3 scroll-mt-20 ${inv.ewayNeeded ? "ring-2 ring-[var(--genda)]" : ""}`}>
      <div>
        <p className="font-heading font-bold flex items-center gap-2">
          <Icon name="truck" className="h-5 w-5" /> E-way bill
        </p>
        <p className="text-sm text-[var(--muted)]">
          {inv.ewayNeeded ? "Needed for this invoice before the goods move by road." : "Not required for this amount, but you can make one if the transporter asks."}
        </p>
      </div>
      <div className="grid grid-cols-[minmax(0,1fr)_7rem] gap-2">
        <Field label="Vehicle number">
          <input
            className="input uppercase"
            autoCapitalize="characters"
            autoCorrect="off"
            spellCheck={false}
            placeholder="MH02AB1234"
            value={vehicle}
            onChange={(e) => setVehicle(e.target.value.toUpperCase())}
          />
        </Field>
        <Field label="Distance (km)">
          <input className="input" inputMode="numeric" placeholder="12" value={km} onChange={(e) => setKm(e.target.value.replace(/\D/g, ""))} />
        </Field>
      </div>
      {error && <p className="text-sm text-[#a8281e]">{error}</p>}
      <button type="button" className={`btn btn-sm ${inv.ewayNeeded ? "btn-kesar" : "btn-outline"}`} disabled={busy} onClick={submit}>
        {busy ? "Making…" : "Make e-way bill"}
      </button>
    </section>
  );
}
