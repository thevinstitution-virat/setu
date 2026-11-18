import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth";
import AppShell, { type NavItem } from "@/components/AppShell";

const nav: NavItem[] = [
  { href: "/retailer", labelKey: "nav.home", icon: "home" },
  { href: "/retailer/catalogue", labelKey: "nav.catalogue", icon: "cart" },
  { href: "/retailer/orders", labelKey: "nav.orders", icon: "box" },
  { href: "/retailer/account", labelKey: "nav.account", icon: "user" },
];

export default async function RetailerLayout({ children }: { children: React.ReactNode }) {
  const session = await getSession();
  if (!session || session.role !== "RETAILER") redirect("/login");

  return (
    <AppShell nav={nav} userName={session.name} roleKey="role.retailer">
      {children}
    </AppShell>
  );
}
