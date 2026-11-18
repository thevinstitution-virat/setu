import { redirect } from "next/navigation";
import { pageSession } from "@/lib/guard";
import AppShell, { type NavItem } from "@/components/AppShell";

const nav: NavItem[] = [
  { href: "/admin", labelKey: "nav.pipeline", icon: "chart" },
  { href: "/admin/orders", labelKey: "nav.orders", icon: "box" },
  { href: "/admin/products", labelKey: "nav.products", icon: "tag" },
  { href: "/admin/team", labelKey: "nav.team", icon: "users" },
  { href: "/admin/regions", labelKey: "nav.regions", icon: "map" },
  { href: "/admin/import", labelKey: "nav.import", icon: "upload" },
];

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const session = await pageSession();
  if (!session || session.role !== "ADMIN") redirect("/login");

  return (
    <AppShell nav={nav} userName={session.name} roleKey="role.admin">
      {children}
    </AppShell>
  );
}
