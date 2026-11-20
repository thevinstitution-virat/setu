import { describe, expect, it } from "vitest";
import { hindiName, hsnByKeyword, hsnFromCategory, latinToDevanagari, tidyName, tidyProductRows } from "@/lib/catalogue-rules";
import { scrubPersonal } from "@/lib/ai";

describe("Hindi names by the rules", () => {
  it("translates known words and units", () => {
    expect(hindiName("Masala Chai 250g")).toBe("मसाला चाय 250 ग्राम");
    expect(hindiName("Salt 1kg")).toMatch(/^नमक 1 /);
  });

  it("spells unknown words by sound", () => {
    expect(latinToDevanagari("Parle")).toBe("पर्ल"); // final silent e
    expect(latinToDevanagari("123")).toBe("");
    expect(latinToDevanagari("Fizz")).toBe(latinToDevanagari("Fiz"));
    expect(hindiName("Zorbo Tea")).toMatch(/ चाय$/);
  });
});

describe("HSN hints", () => {
  it("matches words in the name, then the category", () => {
    expect(hsnByKeyword("Tata Tea Gold 500g")).toMatchObject({ hsn: "0902", gstRate: 5 });
    expect(hsnByKeyword("House brand 1kg", "Salt")).toMatchObject({ hsn: "2501", gstRate: 0 });
    expect(hsnByKeyword("Widget")).toBeNull();
    // whole words only: "teapot" is not tea
    expect(hsnByKeyword("Teapot")).toBeNull();
  });

  it("takes the code most used in the category", () => {
    expect(
      hsnFromCategory([
        { hsnCode: "1905", gstRate: 5 },
        { hsnCode: "1905", gstRate: 5 },
        { hsnCode: "2106", gstRate: 18 },
        { hsnCode: null, gstRate: 0 },
      ])
    ).toEqual({ hsn: "1905", gstRate: 5, count: 2 });
    expect(hsnFromCategory([{ hsnCode: null, gstRate: 0 }])).toBeNull();
    // A tie is a guess: no proposal.
    expect(hsnFromCategory([{ hsnCode: "0902", gstRate: 5 }, { hsnCode: "2101", gstRate: 5 }])).toBeNull();
  });
});

describe("tidying a product sheet", () => {
  it("fixes ALL CAPS, spaces and units", () => {
    expect(tidyName("MASALA  CHAI 250GM")).toBe("Masala Chai 250 g");
    expect(tidyName("Amul Butter 500gms")).toBe("Amul Butter 500 g");
    expect(tidyName("Mustard oil 1 ltr")).toBe("Mustard oil 1 L");
    expect(tidyName("iPhone case")).toBe("iPhone case");
  });

  it("cleans fields, matches categories and flags duplicates without removing them", () => {
    const r = tidyProductRows(
      [
        { name: "MASALA CHAI 250GM", category: "staples", price: "₹1,200", sku: "mc 1", gst_rate: "5 %", hsn_code: "0902.10" },
        { name: "Masala Chai 250 g", sku: "MC2", category: "Staples", price: "1200" },
        { name: "Rice 1kg", sku: "NEW1", category: "Grains", price: "100" },
      ],
      { products: [{ name: "Rice 1kg", sku: "R1" }], categories: ["Staples"] }
    );
    expect(r.rows).toHaveLength(3);
    expect(r.rows[0]).toMatchObject({ name: "Masala Chai 250 g", category: "Staples", price: "1200", sku: "MC1", gst_rate: "5", hsn_code: "090210" });
    expect(r.changes.filter((c) => c.row === 2).map((c) => c.field).sort()).toEqual(["category", "gst_rate", "hsn_code", "name", "price", "sku"]);
    expect(r.duplicates).toContainEqual({ row: 3, name: "Masala Chai 250 g", kind: "sheet", with: "row 2" });
    expect(r.duplicates.find((d) => d.kind === "catalogue")).toMatchObject({ row: 4, with: "Rice 1kg (R1)" });
  });
});

describe("scrubPersonal", () => {
  it("removes phones, emails, GSTINs and PANs", () => {
    const s = scrubPersonal("Call 9876543210 or +91 98765 43210, mail a.b@shop.in, GSTIN 09AAAPA1234A1Z5, PAN ABCDE1234F. Pack of 250.");
    expect(s).not.toMatch(/9876|a\.b@|09AAAPA|ABCDE1234F/);
    expect(s).toContain("Pack of 250");
  });
});
