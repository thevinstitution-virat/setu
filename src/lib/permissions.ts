import type { Role } from "@/generated/prisma/client";

/**
 * Permission-based access control. Routes ask for a permission, never a role,
 * so new staff roles (accountant, warehouse, supervisor …) only need a new
 * entry in ROLE_PERMISSIONS — no route changes.
 *
 * Data scopes (a retailer sees only its orders, an agent only its beat) are
 * still enforced inside each route from the session's role and profile.
 */
export const PERMISSIONS = {
  "orders.place": "Place orders",
  "orders.view_all": "See every order and the pipeline",
  "orders.manage": "Confirm, pack and cancel orders",
  "orders.dispatch": "Assign orders to delivery agents",
  "catalogue.manage": "Add and edit products and prices",
  "retailers.manage": "Edit retailers and assign sales agents",
  "areas.manage": "Add regions and areas",
  "team.view": "See staff",
  "team.manage": "Add, deactivate and edit staff",
  "import.run": "Bulk import retailers and products",
  "audit.view": "Read the audit log",
  "field.work": "Sales field work: attendance, beat, visits",
  "delivery.work": "Delivery work: deliver orders, collect cash",
} as const;

export type Permission = keyof typeof PERMISSIONS;

const ALL = Object.keys(PERMISSIONS) as Permission[];

export const ROLE_PERMISSIONS: Record<Role, readonly Permission[]> = {
  ADMIN: ALL,
  RETAILER: ["orders.place"],
  SALES_AGENT: ["orders.place", "field.work"],
  DELIVERY_AGENT: ["delivery.work"],
};

export function can(role: Role, perm: Permission | Permission[]): boolean {
  const granted = ROLE_PERMISSIONS[role] ?? [];
  const needed = Array.isArray(perm) ? perm : [perm];
  return needed.every((p) => granted.includes(p));
}
