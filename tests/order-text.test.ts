import { describe, expect, it } from "vitest";
import { searchText } from "@/lib/translit";
import { cartQty, matchProducts, parseOrderText, parsePhrase, sizeOf, splitOrderText, type OrderProduct } from "@/lib/order-text";

const P = (id: string, name: string, o: Partial<OrderProduct> & { nameHi?: string; aliases?: string; brand?: string; category?: string } = {}): OrderProduct => ({
  id,
  name,
  unit: o.unit ?? "pack",
  caseUnit: o.caseUnit ?? null,
  caseSize: o.caseSize ?? null,
  search: searchText([name, o.nameHi, o.aliases, id, o.brand, o.category ?? "Grocery"]),
});

const catalogue: OrderProduct[] = [
  P("LEMON", "Lemon (nimbu) 1kg", { unit: "bag", caseUnit: "peti", caseSize: 10, category: "Fresh" }),
  P("JEERA", "Cumin Seeds 100g", { nameHi: "जीरा 100 ग्राम", caseUnit: "box", caseSize: 24 }),
  P("CHAI250", "Masala Chai 250g", { nameHi: "मसाला चाय 250 ग्राम", caseUnit: "box", caseSize: 12, category: "Beverages" }),
  P("CHAI1K", "Masala Chai 1kg", { nameHi: "मसाला चाय 1 किलो", category: "Beverages" }),
  P("SALT", "Salt 1kg", { nameHi: "नमक 1 किलो", caseUnit: "bag", caseSize: 25 }),
  P("SUGAR1", "Sugar 1kg", { nameHi: "चीनी 1 किलो" }),
  P("RICE5", "Basmati Rice 5kg", { unit: "bag", nameHi: "बासमती चावल 5 किलो" }),
  P("OIL1", "Sunflower Oil 1L", { unit: "bottle", nameHi: "सूरजमुखी तेल 1 लीटर", caseUnit: "carton", caseSize: 12 }),
  P("PARLEG", "Parle-G Biscuits 100g", { brand: "Parle", aliases: "parle g, glucose biscuit" }),
  P("SOAP", "Bathing Soap (pack of 4)", { aliases: "sabun" }),
];
const ids = (text: string) => parseOrderText(text, catalogue).map((l) => [l.productId, l.qty, l.per]);

describe("splitting a message", () => {
  it("splits on commas, new lines, aur/and and a number that starts a new item", () => {
    expect(splitOrderText("5 peti nimbu, 2 jeera")).toEqual(["5 peti nimbu", "2 jeera"]);
    expect(splitOrderText("5 peti nimbu 2 jeera")).toEqual(["5 peti nimbu", "2 jeera"]);
    expect(splitOrderText("chai 250g 3 packet\nnamak 2 aur cheeni 5 kilo")).toEqual(["chai 250g 3 packet", "namak 2", "cheeni 5 kilo"]);
    expect(splitOrderText("नमक 2 और चीनी 5 किलो")).toEqual(["नमक 2", "चीनी 5 किलो"]);
    // A size after product words isn't a new item.
    expect(splitOrderText("2 chai 250 g 3 namak")).toEqual(["2 chai 250 g", "3 namak"]);
    expect(splitOrderText("bhej do please")).toEqual([]);
  });
});

describe("one phrase", () => {
  it("reads quantities, units and sizes in Hindi and English", () => {
    expect(parsePhrase("5 peti nimbu")).toMatchObject({ qty: 5, unit: { kind: "case" }, words: ["nimbu"] });
    expect(parsePhrase("do darjan sabun bhej do")).toMatchObject({ qty: 2, unit: { kind: "dozen" }, words: ["sabun"] });
    expect(parsePhrase("chai 250g 3 packet")).toMatchObject({ qty: 3, unit: { kind: "piece" }, size: { kind: "weight", amount: 250 }, words: ["chai"] });
    expect(parsePhrase("आधा किलो जीरा")).toMatchObject({ qty: 0.5, unit: { kind: "weight", base: 1000 } });
    expect(parsePhrase("तीन पैकेट नमक")).toMatchObject({ qty: 3, unit: { kind: "piece" } });
    expect(parsePhrase("oil 1.5 ltr")).toMatchObject({ qty: 1.5, unit: { kind: "volume" } });
  });

  it("finds pack sizes in product names", () => {
    expect(sizeOf("Salt 1kg")).toEqual({ kind: "weight", amount: 1000 });
    expect(sizeOf("Sunflower Oil 1L")).toEqual({ kind: "volume", amount: 1000 });
    expect(sizeOf("Cumin Seeds 100 g")).toEqual({ kind: "weight", amount: 100 });
    expect(sizeOf("Bathing Soap (pack of 4)")).toBeNull();
  });
});

describe("matching products", () => {
  it("matches by spelling, sound, Hindi and synonyms", () => {
    expect(matchProducts(["nimbu"], null, catalogue)[0].id).toBe("LEMON");
    expect(matchProducts(["jeera"], null, catalogue)[0].id).toBe("JEERA");
    expect(matchProducts(["cheeni"], null, catalogue)[0].id).toBe("SUGAR1");
    expect(matchProducts(["namak"], null, catalogue)[0].id).toBe("SALT");
    expect(matchProducts(["parle", "g"], null, catalogue)[0].id).toBe("PARLEG");
    expect(matchProducts(["chawal"], null, catalogue)[0].id).toBe("RICE5");
    expect(matchProducts(["tel"], null, catalogue)[0].id).toBe("OIL1");
    expect(matchProducts(["xyzzy"], null, catalogue)).toEqual([]);
  });

  it("uses the size said to pick the pack", () => {
    expect(matchProducts(["chai"], { kind: "weight", amount: 1000 }, catalogue)[0].id).toBe("CHAI1K");
    expect(matchProducts(["chai"], { kind: "weight", amount: 250 }, catalogue)[0].id).toBe("CHAI250");
  });
});

describe("quantities for the cart", () => {
  const lemon = catalogue[0];
  const salt = catalogue[4];
  const soap = catalogue[9];
  it("turns cases, dozens and weights into units or cases", () => {
    expect(cartQty({ qty: 5, unit: { kind: "case", word: "peti" } }, lemon)).toEqual({ qty: 5, per: "case", note: null });
    expect(cartQty({ qty: 2, unit: { kind: "dozen", word: "dozen" } }, soap)).toEqual({ qty: 24, per: "unit", note: null });
    expect(cartQty({ qty: 5, unit: { kind: "weight", base: 1000, word: "kilo" } }, salt)).toMatchObject({ qty: 5, per: "unit" });
    expect(cartQty({ qty: 2, unit: { kind: "case", word: "peti" } }, soap)).toMatchObject({ qty: 2, per: "unit", note: expect.stringMatching(/No case size/) });
    expect(cartQty({ qty: null, unit: null }, soap)).toEqual({ qty: 1, per: "unit", note: null });
  });
});

describe("whole messages", () => {
  it("reads typical shop messages", () => {
    expect(ids("5 peti nimbu, 2 jeera")).toEqual([
      ["LEMON", 5, "case"],
      ["JEERA", 2, "unit"],
    ]);
    expect(ids("masala chai 1 kilo wala 2 packet\nnamak 1 bori, cheeni 5 kilo")).toEqual([
      ["CHAI1K", 2, "unit"],
      ["SALT", 1, "case"],
      ["SUGAR1", 5, "unit"],
    ]);
    expect(ids("5 kilo chawal")).toEqual([["RICE5", 1, "unit"]]);
    expect(ids("तीन पैकेट नमक और दो डिब्बा चाय 250 ग्राम")).toEqual([
      ["SALT", 3, "unit"],
      ["CHAI250", 2, "case"],
    ]);
    expect(ids("Namaste bhaiya, 5 peti nimbu bhej do. Dhanyavad")).toEqual([["LEMON", 5, "case"]]);
    expect(ids("parle g 2 dozen, sabun 3")).toEqual([
      ["PARLEG", 24, "unit"],
      ["SOAP", 3, "unit"],
    ]);
  });

  it("asks when it can't tell", () => {
    const [l] = parseOrderText("2 zorbo", catalogue);
    expect(l).toMatchObject({ productId: null, qty: 2, confidence: "low" });
    const [c] = parseOrderText("2 chai", catalogue);
    expect(c.productId).toMatch(/^CHAI/);
    expect(c.confidence).not.toBe("high"); // two chai packs: check
    expect(c.alternatives[0]).toMatch(/^CHAI/);
  });
});
