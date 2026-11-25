/**
 * Money helpers. All amounts are integer paise (₹1 = 100 paise) in the
 * database and in API JSON. Convert only at the edges: user input → toPaise,
 * display → formatINR.
 */

export type Paise = number;

/** "12.5", 12.5 → 1250. Rounds half away from zero to the nearest paisa. */
export function toPaise(rupees: number | string): Paise {
  const n = typeof rupees === "string" ? Number(rupees.replace(/[,₹\s]/g, "")) : rupees;
  if (!Number.isFinite(n)) throw new Error(`Not a money amount: ${rupees}`);
  return Math.sign(n) * Math.round(Math.abs(n) * 100);
}

export function fromPaise(p: Paise): number {
  return p / 100;
}

const inr = new Intl.NumberFormat("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const inrWhole = new Intl.NumberFormat("en-IN", { maximumFractionDigits: 0 });

/** 123456 → "₹1,234.56"; whole: true → "₹1,235". */
export function formatINR(p: Paise, opts?: { whole?: boolean; symbol?: boolean }): string {
  const s = (opts?.whole ? inrWhole : inr).format(p / 100);
  return opts?.symbol === false ? s : `₹${s}`;
}

/** GST on a line, rounded to the paisa. rate is a percentage, e.g. 18. */
export function gstOn(amount: Paise, rate: number): Paise {
  return Math.round((amount * rate) / 100);
}

/**
 * GST already inside an amount that includes it. Worked out the way dealer
 * billing software prints it: each half (CGST, SGST) is taken out of the line
 * and rounded to the paisa, so the tax is always even and splits exactly.
 * ₹3,088 at 5% → 2 × ₹73.52 = ₹147.04.
 */
export function gstInside(amount: Paise, rate: number): Paise {
  if (rate <= 0) return 0;
  return 2 * Math.round((amount * rate) / (2 * (100 + rate)));
}

/**
 * A bill total rounded to the whole rupee (50 paise and above go up).
 * `roundOff` is what was added (+) or taken off (−), so exact + roundOff = total.
 * ₹1,234.50 → +50 paise, ₹1,235.00; ₹1,234.49 → −49 paise, ₹1,234.00.
 */
export function roundRupee(exact: Paise): { roundOff: Paise; total: Paise } {
  const total = Math.sign(exact) * Math.round(Math.abs(exact) / 100) * 100;
  return { roundOff: total - exact, total };
}

export type LineMoney ={ gross: Paise; discount: Paise; taxable: Paise; tax: Paise; total: Paise };

/**
 * One line's money. price and discount are as stored on the order: before
 * GST, or including GST when `inclusive`. Either way gross and discount come
 * back before GST, so gross − discount = taxable and taxable + tax = total
 * always hold; with inclusive rates the total is exactly price × qty − discount.
 */
export function lineMoney(price: Paise, quantity: number, discount: Paise, gstRate: number, inclusive = false): LineMoney {
  if (!inclusive || gstRate <= 0) {
    const gross = price * quantity;
    const taxable = gross - discount;
    const tax = gstOn(taxable, gstRate);
    return { gross, discount, taxable, tax, total: taxable + tax };
  }
  const total = price * quantity - discount;
  const tax = gstInside(total, gstRate);
  const taxable = total - tax;
  const discountEx = discount ? Math.round((discount * 100) / (100 + gstRate)) : 0;
  return { gross: taxable + discountEx, discount: discountEx, taxable, tax, total };
}
