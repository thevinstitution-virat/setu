import { redirect } from "next/navigation";
import { pageSession } from "@/lib/guard";
import AppShell, { type NavItem } from "@/components/AppShell";
import { layoutChrome } from "@/lib/chrome";

const nav: NavItem[] = [
  { href: "/retailer", labelKey: "nav.home", icon: "home" },
  { href: "/retailer/catalogue", labelKey: "nav.catalogue", icon: "cart" },
  { href: "/retailer/orders", labelKey: "nav.orders", icon: "box" },
  { href: "/retailer/khata", labelKey: "nav.khata", icon: "book" },
  { href: "/retailer/help", labelKey: "nav.help", icon: "chat" },
  { href: "/retailer/account", labelKey: "nav.account", icon: "user" },
];

export default async function RetailerLayout({ children }: { children: React.ReactNode }) {
  const session = await pageSession();
  if (!session || session.role !== "RETAILER") redirect("/login");

  const chrome = await layoutChrome(session, nav);

  return (
    <AppShell chrome={chrome} nav={nav} userName={session.name} roleKey="role.retailer" surface="retailer">
      {children}
    </AppShell>
  );
}
