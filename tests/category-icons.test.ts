import { describe, expect, it } from "vitest";
import { categoryIcon } from "@/lib/ui/categoryIcons";
import { ICON3D } from "@/lib/ui/icons3d";

describe("categoryIcon", () => {
  const cases: [string, string][] = [
    ["Shampoo", "shampoo"],
    ["शैम्पू", "shampoo"],
    ["Hair Care – Shampoo", "shampoo"],
    ["Cream Biscuits", "cream-biscuits"],
    ["Liquid Detergent", "detergent-liquid"],
    ["Atta, Rice & Dal", "atta"],
    ["आटा", "atta"],
    ["Namkeen & Snacks", "chips"],
    ["Pooja Samagri", "agarbatti"],
    ["अगरबत्ती", "agarbatti"],
    ["Personal Care", "box-sealed"],
    ["Misc", "box-sealed"],
    ["", "box-sealed"],
    ["चाय", "tea"],
    ["Mustard Oil", "atta"],
    ["सरसों का तेल", "atta"],
    ["Hair Oil", "hair-oil"],
    ["बालों का तेल", "hair-oil"],
    ["Desi Ghee", "atta"],
    ["बिस्कुट", "biscuits"],
    ["साबुन", "soap"],
    ["नमकीन", "chips"],
    ["टूथपेस्ट", "toothpaste"],
  ];
  it.each(cases)("%s -> %s", (name, icon) => {
    expect(categoryIcon(name)).toBe(icon);
  });
  it("always returns a real icon", () => {
    for (const n of ["xyz", "???", "Soap & Detergent", "Home care"]) expect(ICON3D[categoryIcon(n)]).toBeTruthy();
  });
});
