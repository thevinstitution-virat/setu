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

/**
 * 123456 → "₹1,234.56"; whole: true → "₹1,235".
 * compact: true → "₹4.82L" / "₹1.2Cr" / "₹12.4k" for cards and tiles (Indian units);
 * amounts under ₹1,000 stay whole, and detail views and tables should not use it.
 */
export function formatINR(p: Paise, opts?: { whole?: boolean; symbol?: boolean; compact?: boolean }): string {
  if (opts?.compact) {
    const r = p / 100;
    const abs = Math.abs(r);
    const sign = r < 0 ? "-" : "";
    const trim = (n: number, d: number) => n.toFixed(d).replace(/\.0+$/, "").replace(/(\.\d*?)0+$/, "$1");
    let body: string;
    if (abs >= 1e7) body = `${trim(abs / 1e7, 2)}Cr`;
    else if (abs >= 1e5) body = `${trim(abs / 1e5, 2)}L`;
    else if (abs >= 1e4) body = `${trim(abs / 1e3, 1)}k`;
    else body = inrWhole.format(abs);
    return opts.symbol === false ? `${sign}${body}` : `${sign}₹${body}`;
  }
  const s = (opts?.whole ? inrWhole : inr).format(p / 100);
  return opts?.symbol === false ? s : `₹${s}`;
}

/** GST on a line, rounded to the paisa. rate is a percentage, e.g. 18. */
export function gstOn(amount: Paise, rate: number): Paise {
  return Math.round((amount * rate) / 100);
}
