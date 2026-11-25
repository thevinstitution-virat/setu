import { describe, expect, it } from "vitest";
import { roleAssignedMail, ROLE_LABEL } from "@/lib/email-messages";

describe("role email", () => {
  const base = { name: "Rajesh Kumar", role: "SALES_AGENT", byName: "Asha", loginUrl: "https://acme.example.com/login" };

  it("welcomes a new person politely and says how to sign in", () => {
    const m = roleAssignedMail("r@example.com", "Acme Distributors", { ...base, changed: false });
    expect(m.subject).toBe("You have been added to Acme Distributors as Sales agent");
    expect(m.text).toContain("Dear Rajesh,");
    expect(m.text).toContain("Asha has added you");
    expect(m.text).toContain("one-time code");
    expect(m.text).toContain("no password");
    expect(m.text).toContain("https://acme.example.com/login");
    expect(m.text).toContain("Warm regards");
  });

  it("says the role changed for someone who already had a login", () => {
    const m = roleAssignedMail("r@example.com", "Acme", { ...base, role: "DELIVERY_AGENT", changed: true });
    expect(m.subject).toBe("Your role at Acme is now Delivery agent");
    expect(m.text).toContain("updated your role");
  });

  it("has a label for every role", () => {
    for (const r of ["ADMIN", "SALES_AGENT", "DELIVERY_AGENT", "SUPERVISOR", "ACCOUNTANT", "RETAILER"]) expect(ROLE_LABEL[r]).toBeTruthy();
  });
});
