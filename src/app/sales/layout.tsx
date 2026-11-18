import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth";
import AppShell, { type NavItem } from "@/components/AppShell";

const nav: NavItem[] = [
  { href: "/sales", labelKey: "nav.today", icon: "pin" },
  { href: "/sales/beat", labelKey: "nav.beat", icon: "route" },
  { href: "/sales/orders", labelKey: "nav.orders", icon: "box" },
  { href: "/sales/attendance", labelKey: "nav.attendance", icon: "clock" },
];

export default async function SalesLayout({ children }: { children: React.ReactNode }) {
  const session = await getSession();
  if (!session || session.role !== "SALES_AGENT") redirect("/login");

  return (
    <AppShell nav={nav} userName={session.name} roleKey="role.salesAgent">
      {children}
    </AppShell>
  );
}
