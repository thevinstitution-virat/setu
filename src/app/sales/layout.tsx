import { redirect } from "next/navigation";
import { pageSession } from "@/lib/guard";
import AppShell, { type NavItem } from "@/components/AppShell";
import DutyTracker from "@/components/field/DutyTracker";

const nav: NavItem[] = [
  { href: "/sales", labelKey: "nav.today", icon: "pin" },
  { href: "/sales/beat", labelKey: "nav.beat", icon: "route" },
  { href: "/sales/orders", labelKey: "nav.orders", icon: "box" },
  { href: "/sales/stores", labelKey: "nav.shops", icon: "plus" },
  { href: "/sales/targets", labelKey: "nav.targets", icon: "chart" },
  { href: "/sales/attendance", labelKey: "nav.attendance", icon: "clock" },
];

export default async function SalesLayout({ children }: { children: React.ReactNode }) {
  const session = await pageSession();
  if (!session || session.role !== "SALES_AGENT") redirect("/login");

  return (
    <AppShell nav={nav} userName={session.name} roleKey="role.salesAgent">
      <DutyTracker />
      {children}
    </AppShell>
  );
}
