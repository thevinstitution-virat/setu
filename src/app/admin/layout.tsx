import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth";
import AppShell, { type NavItem } from "@/components/AppShell";

const nav: NavItem[] = [
  { href: "/admin", labelKey: "nav.pipeline", icon: "📊" },
  { href: "/admin/orders", labelKey: "nav.orders", icon: "📦" },
  { href: "/admin/products", labelKey: "nav.products", icon: "🏷️" },
  { href: "/admin/team", labelKey: "nav.team", icon: "👥" },
  { href: "/admin/regions", labelKey: "nav.regions", icon: "🗺️" },
];

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const session = await getSession();
  if (!session || session.role !== "ADMIN") redirect("/login");

  return (
    <AppShell nav={nav} userName={session.name} roleKey="role.admin">
      {children}
    </AppShell>
  );
}
