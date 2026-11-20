import { describe, expect, it } from "vitest";
import { comparePayment, cratesDiffer, deliveryVerdict, normRef, parseShelfCounts, pickupVerdict, sameRef, shelfShare, verdictOf, type PaymentRead } from "@/lib/photo-rules";

const upi = (o: Partial<PaymentRead> = {}): PaymentRead => ({ readable: true, kind: "upi", amount: 5000, reference: "4321 5678 9012", date: "2026-11-19", status: "success", chequeNumber: null, signed: null, ...o });
const entered = { method: "UPI", amount: 500_000, reference: "432156789012", chequeNumber: null, collectedDay: "2026-11-19", chequeDate: null };
const none = { reused: false, referenceUsedBy: null };

describe("payment proofs (A3)", () => {
  it("matches amount, UTR and date", () => {
    const r = comparePayment(upi(), entered, none);
    expect(r.verdict).toBe("ok");
    expect(r.flags).toEqual([]);
    expect(r.summary).toBe("Screenshot matches: ₹5,000 · UTR 432156789012 · 19 Nov");
  });

  it("flags a different amount as bad and a different UTR as a warning", () => {
    const r = comparePayment(upi({ amount: 500, reference: "999988887777" }), entered, none);
    expect(r.verdict).toBe("bad");
    expect(r.flags).toEqual(["amount_differs", "reference_differs"]);
    expect(r.notes[0]).toBe("The photo shows ₹500; entered ₹5,000.");
  });

  it("allows paise rounding and shortened UTRs", () => {
    expect(comparePayment(upi({ amount: 5000.4, reference: "56789012" }), entered, none).verdict).toBe("ok");
    expect(sameRef("XXXX9012", "432156789012")).toBe(false);
    expect(sameRef("789012", "4321-5678-9012")).toBe(true);
    expect(normRef(" ab-12 ")).toBe("AB12");
  });

  it("flags failed, pending, old screenshots and cheques for UPI", () => {
    expect(comparePayment(upi({ status: "failed" }), entered, none).flags).toEqual(["failed"]);
    expect(comparePayment(upi({ status: "pending" }), entered, none).verdict).toBe("warn");
    expect(comparePayment(upi({ date: "2026-11-10" }), entered, none).flags).toEqual(["date_differs"]);
    expect(comparePayment(upi({ date: "2026-11-17" }), entered, none).flags).toEqual([]);
    expect(comparePayment(upi({ kind: "cheque" }), entered, none).flags).toContain("wrong_kind");
    expect(comparePayment(upi({ kind: "other" }), entered, none).flags).toEqual(["not_payment"]);
    expect(comparePayment(upi({ readable: false }), entered, none).flags).toEqual(["unclear"]);
  });

  it("checks cheque number, date and signature", () => {
    const cheque = { method: "CHEQUE", amount: 1_200_000, reference: "001234", chequeNumber: "001234", collectedDay: "2026-11-19", chequeDate: "2026-11-25" };
    const read = upi({ kind: "cheque", amount: 12000, reference: null, chequeNumber: "001234", date: "2026-11-25", status: "unknown", signed: true });
    expect(comparePayment(read, cheque, none).verdict).toBe("ok");
    const off = comparePayment({ ...read, chequeNumber: "001243", date: "2026-11-26", signed: false }, cheque, none);
    expect(off.flags).toEqual(["cheque_differs", "unsigned", "date_differs"]);
    expect(off.verdict).toBe("warn");
  });

  it("without AI only reuse counts", () => {
    expect(comparePayment(null, entered, none)).toMatchObject({ verdict: "ok", summary: "Checked for reuse only" });
    const r = comparePayment(null, entered, { reused: true, referenceUsedBy: "PAY-7" });
    expect(r.verdict).toBe("bad");
    expect(r.flags).toEqual(["reused", "reference_reused"]);
    expect(r.notes[1]).toBe("The same UTR is on payment PAY-7.");
  });
});

describe("delivery and pickup photos (A8)", () => {
  it("flags blank, unclear and empty delivery photos", () => {
    const ok = { readable: true, blank: false, showsShop: true, showsGoods: false, note: "" };
    expect(deliveryVerdict(ok, { reused: false })).toMatchObject({ verdict: "ok", summary: "Photo shows the drop" });
    expect(deliveryVerdict({ ...ok, blank: true }, { reused: false }).flags).toEqual(["blank"]);
    expect(deliveryVerdict({ ...ok, readable: false }, { reused: false }).flags).toEqual(["unclear"]);
    expect(deliveryVerdict({ ...ok, showsShop: false }, { reused: false }).flags).toEqual(["no_shop_or_goods"]);
    expect(deliveryVerdict(null, { reused: true }).verdict).toBe("bad");
  });

  it("counts crates with some slack", () => {
    expect(cratesDiffer(9, 10)).toBe(false);
    expect(cratesDiffer(8, 10)).toBe(true);
    expect(cratesDiffer(46, 50)).toBe(false);
    expect(cratesDiffer(45, 50)).toBe(true);
    expect(pickupVerdict({ readable: true, crates: 6 }, 10, { reused: false })).toMatchObject({ verdict: "bad", flags: ["crates_differ"], notes: ["About 6 in the photo; 10 entered."] });
    expect(pickupVerdict({ readable: true, crates: null }, 10, { reused: false }).flags).toEqual(["unclear"]);
  });

  it("orders verdicts", () => {
    expect(verdictOf([])).toBe("ok");
    expect(verdictOf(["unclear"])).toBe("warn");
    expect(verdictOf(["unclear", "reused"])).toBe("bad");
  });
});

describe("shelf audits (A10)", () => {
  it("works out our share", () => {
    expect(shelfShare(6, 14)).toBe(30);
    expect(shelfShare(0, 0)).toBeNull();
  });

  it("checks typed counts", () => {
    expect(parseShelfCounts({ ours: 4, others: 10, empty: 0 })).toEqual({ ours: 4, others: 10, empty: 0 });
    expect(parseShelfCounts({ ours: -1, others: 10, empty: 0 })).toMatch(/our facings/);
    expect(parseShelfCounts({ ours: 1, others: 2.5, empty: 0 })).toMatch(/other brands/);
    expect(parseShelfCounts({ ours: 1, others: 2, empty: 1001 })).toMatch(/empty slots/);
  });
});
