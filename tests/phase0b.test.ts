import { describe, expect, it } from "vitest";
import { cleanPhone, parseCsv, templateCsv, validateProducts, validateRetailers } from "@/lib/importers";
import { keyBelongsTo, newKey, sniffType } from "@/lib/storage";
import { can } from "@/lib/permissions";

describe("CSV parsing", () => {
  it("handles quotes, commas, escaped quotes, CRLF and BOM", () => {
    const rows = parseCsv('﻿a,b\r\n"Shop, 1","He said ""hi"""\r\n\r\nx,y');
    expect(rows).toEqual([
      ["a", "b"],
      ["Shop, 1", 'He said "hi"'],
      ["x", "y"],
    ]);
  });
  it("templates round-trip through the parser", () => {
    const [head] = parseCsv(templateCsv("retailers"));
    expect(head[0]).toBe("outlet_name");
  });
});

describe("retailer rows", () => {
  const base = { outlet_name: "A", phone: "9876543210", pin_code: "400058", region: "Mumbai", area: "Andheri" };
  it("cleans Indian phone formats", () => {
    expect(cleanPhone("+91 98765-43210")).toBe("9876543210");
    expect(cleanPhone("09876543210")).toBe("9876543210");
  });
  it("reports missing fields, bad phones, bad PINs and duplicates with spreadsheet row numbers", () => {
    const { valid, errors } = validateRetailers([
      base,
      { ...base, phone: "12345" },
      { ...base, pin_code: "4000" },
      { ...base, region: "" },
      { ...base, phone: "+91 9876543210" },
    ]);
    expect(valid).toHaveLength(1);
    expect(errors.map((e) => e.row)).toEqual([3, 4, 5, 6]);
    expect(errors[3].message).toContain("repeated");
  });
});

describe("product rows", () => {
  const base = { name: "Tea", sku: "T-1", category: "Bev", unit: "pack", price: "85", mrp: "95", gst_rate: "5" };
  it("converts rupees to paise and checks GST slabs and price ≤ MRP", () => {
    const { valid, errors } = validateProducts([
      base,
      { ...base, sku: "T-2", gst_rate: "7" },
      { ...base, sku: "T-3", price: "100" },
      { ...base, sku: "t-1" },
    ]);
    expect(valid[0]).toMatchObject({ price: 8500, mrp: 9500, gstRate: 5 });
    expect(errors.map((e) => e.row)).toEqual([3, 4, 5]);
  });
});

describe("storage keys", () => {
  it("are tenant-prefixed and checked", () => {
    const key = newKey("tenantA", "pod-photo", "image/jpeg");
    expect(key.startsWith("t/tenantA/pod-photo/")).toBe(true);
    expect(keyBelongsTo(key, "tenantA")).toBe(true);
    expect(keyBelongsTo(key, "tenantB")).toBe(false);
    expect(keyBelongsTo("t/tenantA/../tenantB/x.jpg", "tenantA")).toBe(false);
  });
  it("detects file type from bytes, not the name", () => {
    expect(sniffType(Buffer.from([0xff, 0xd8, 0xff, 0xe0]))).toBe("image/jpeg");
    expect(sniffType(Buffer.from("%PDF-1.7"))).toBe("application/pdf");
    expect(sniffType(Buffer.from("<svg onload=alert(1)>"))).toBeNull();
  });
});

describe("permissions", () => {
  it("grants by role", () => {
    expect(can("ADMIN", "import.run")).toBe(true);
    expect(can("SALES_AGENT", ["orders.place", "field.work"])).toBe(true);
    expect(can("SALES_AGENT", "catalogue.manage")).toBe(false);
    expect(can("RETAILER", "orders.view_all")).toBe(false);
    expect(can("DELIVERY_AGENT", "orders.place")).toBe(false);
  });
});
