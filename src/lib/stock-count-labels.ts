/** Client-safe labels for stock valuation and physical counts (A6). */

export type CountMode = "TRACKED" | "QUANTITY" | "VALUE";
export type CountStatus = "DRAFT" | "ACCEPTED" | "CANCELLED";
export type ValuationBy = "company" | "category" | "place" | "product";

export const COUNT_MODE_LABEL: Record<CountMode, string> = {
  TRACKED: "Count against the app's stock",
  QUANTITY: "Quantities and rates",
  VALUE: "Value per company",
};

export const COUNT_MODE_HINT: Record<CountMode, string> = {
  TRACKED: "Count each batch at one place. Accepting it corrects the app's stock to what was counted, and the difference at cost goes to stock shortage.",
  QUANTITY: "Stock tracking is off: enter the quantity of every product in stock, with its rate. The total is the closing stock.",
  VALUE: "Stock tracking is off: enter the stock value of each company's goods. The total is the closing stock.",
};

export const COUNT_STATUS_LABEL: Record<CountStatus, string> = { DRAFT: "Counting", ACCEPTED: "Accepted", CANCELLED: "Cancelled" };

export const VALUATION_BY: { key: ValuationBy; label: string }[] = [
  { key: "company", label: "Company" },
  { key: "category", label: "Category" },
  { key: "place", label: "Place" },
  { key: "product", label: "Product" },
];

export const isValuationBy = (v: unknown): v is ValuationBy => v === "company" || v === "category" || v === "place" || v === "product";
