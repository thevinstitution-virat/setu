import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth";
import AppShell, { type NavItem } from "@/components/AppShell";

const nav: NavItem[] = [
  { href: "/delivery", labelKey: "nav.deliveries", icon: "truck" },
  { href: "/delivery/history", labelKey: "nav.history", icon: "receipt" },
];

export default async function DeliveryLayout({ children }: { children: React.ReactNode }) {
  const session = await getSession();
  if (!session || session.role !== "DELIVERY_AGENT") redirect("/login");

  return (
    <AppShell nav={nav} userName={session.name} roleKey="role.deliveryAgent">
      {children}
    </AppShell>
  );
}
