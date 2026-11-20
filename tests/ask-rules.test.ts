import { describe, expect, it } from "vitest";
import { cleanQuery, normalizeQuestion, readQuestion } from "@/lib/ask-rules";

describe("reading questions", () => {
  it("normalises Hindi, money and long vowels", () => {
    expect(normalizeQuestion("₹20,000 se zyaada baaki")).toBe("rs 20000 se zyada baki");
    expect(normalizeQuestion("२० हज़ार")).toMatch(/^20 ha/);
  });

  it("dues with amount, age and overdue", () => {
    expect(readQuestion("Who owes more than ₹20,000 for over 30 days?")).toEqual({ intent: "dues", params: { minAmount: 2_000_000, minDays: 30 } });
    expect(readQuestion("20 hazar se zyada baki 1 mahine se")).toEqual({ intent: "dues", params: { minAmount: 2_000_000, minDays: 30 } });
    expect(readQuestion("kiska 50k udhaar hai")).toEqual({ intent: "dues", params: { minAmount: 5_000_000 } });
    expect(readQuestion("overdue shops above 2 lakh")).toMatchObject({ intent: "dues", params: { minAmount: 20_000_000, overdueOnly: true } });
    expect(readQuestion("किसका कितना बाकी है")).toMatchObject({ intent: "dues" });
  });

  it("sales, collections and periods", () => {
    expect(readQuestion("Is mahine kitni sale hui?")).toEqual({ intent: "sales_total", params: { period: "mtd" } });
    expect(readQuestion("pichhle mahine ki bikri")).toEqual({ intent: "sales_total", params: { period: "last_month" } });
    expect(readQuestion("sales last 45 days")).toEqual({ intent: "sales_total", params: { period: { days: 45 } } });
    expect(readQuestion("Aaj kitna collection hua?")).toEqual({ intent: "collections", params: { period: "today" } });
    expect(readQuestion("kal ki vasooli")).toEqual({ intent: "collections", params: { period: "yesterday" } });
  });

  it("products, shops and the team", () => {
    expect(readQuestion("Top 10 products last month")).toEqual({ intent: "top_products", params: { limit: 10, period: "last_month" } });
    expect(readQuestion("sabse kam bikne wala maal is hafte")).toMatchObject({ intent: "top_products", params: { bottom: true, period: "7d" } });
    expect(readQuestion("kaunsa item sabse zyada bika")).toMatchObject({ intent: "top_products" });
    expect(readQuestion("best 5 shops this month")).toEqual({ intent: "top_shops", params: { limit: 5, period: "mtd" } });
    expect(readQuestion("Kisne kitna becha is hafte?")).toEqual({ intent: "agent_sales", params: { period: "7d" } });
  });

  it("inactive shops, stock and pending orders", () => {
    expect(readQuestion("कौन सी दुकानों ने 15 दिन से ऑर्डर नहीं किया?")).toEqual({ intent: "inactive_shops", params: { minDays: 15 } });
    expect(readQuestion("shops not ordered in 2 weeks")).toEqual({ intent: "inactive_shops", params: { minDays: 14 } });
    expect(readQuestion("which shops stopped ordering")).toEqual({ intent: "inactive_shops", params: { minDays: 30 } });
    expect(readQuestion("Kaunsa maal khatam hone wala hai?")).toMatchObject({ intent: "low_stock" });
    expect(readQuestion("Pending orders")).toMatchObject({ intent: "pending_orders" });
    expect(readQuestion("orders not delivered yet")).toMatchObject({ intent: "pending_orders" });
  });

  it("gives up rather than guess", () => {
    expect(readQuestion("hello")).toBeNull();
    expect(readQuestion("what is the weather")).toBeNull();
    expect(readQuestion("")).toBeNull();
  });

  it("cleans what the AI sends", () => {
    expect(cleanQuery({ intent: "drop_tables" })).toBeNull();
    expect(cleanQuery({ intent: "dues", params: { minAmount: -5, minDays: 30.4, limit: 500, period: "forever" } })).toEqual({ intent: "dues", params: { minDays: 30 } });
    expect(cleanQuery({ intent: "sales_total", params: { period: { days: 45 } } })).toEqual({ intent: "sales_total", params: { period: { days: 45 } } });
  });
});
