import { redirect } from "next/navigation";
import { pageSession } from "@/lib/guard";
import { requireTenant } from "@/lib/tenant";
import { inventorySettings } from "@/lib/inventory-settings";
import AppShell, { type NavItem } from "@/components/AppShell";
import DutyTracker from "@/components/field/DutyTracker";

const nav: NavItem[] = [
  { href: "/delivery", labelKey: "nav.deliveries", icon: "truck" },
  { href: "/delivery/history", labelKey: "nav.history", icon: "receipt" },
  { href: "/delivery/cash", labelKey: "nav.cash", icon: "cash" },
  { href: "/delivery/attendance", labelKey: "nav.attendance", icon: "clock" },
  { href: "/delivery/stores", labelKey: "nav.shops", icon: "plus" },
];

export default async function DeliveryLayout({ children }: { children: React.ReactNode }) {
  const session = await pageSession();
  if (!session || session.role !== "DELIVERY_AGENT") redirect("/login");
  // Van stock only when the business tracks stock.
  const tenant = await requireTenant();
  const items: NavItem[] = inventorySettings(tenant.settings).enabled
    ? [nav[0], { href: "/delivery/van", labelKey: "nav.van", icon: "stock" }, ...nav.slice(1)]
    : nav;

  return (
    <AppShell nav={items} userName={session.name} roleKey="role.deliveryAgent">
      <DutyTracker />
      {children}
    </AppShell>
  );
}
