import { redirect } from "next/navigation";
import { pageSession } from "@/lib/guard";
import AppShell, { type NavItem } from "@/components/AppShell";
import { layoutChrome } from "@/lib/chrome";

const nav: NavItem[] = [
  { href: "/admin", labelKey: "nav.pipeline", icon: "chart" },
  { href: "/admin/orders", labelKey: "nav.orders", icon: "box" },
  { href: "/admin/dispatch", labelKey: "nav.dispatch", icon: "truck" },
  { href: "/admin/stock", labelKey: "nav.stock", icon: "stock" },
  { href: "/admin/khata", labelKey: "nav.khata", icon: "book" },
  { href: "/admin/invoices", labelKey: "nav.invoices", icon: "receipt" },
  { href: "/admin/payments", labelKey: "nav.payments", icon: "card" },
  { href: "/admin/cash", labelKey: "nav.cash", icon: "cash" },
  { href: "/admin/bank", labelKey: "nav.bank", icon: "wallet" },
  { href: "/admin/products", labelKey: "nav.products", icon: "tag" },
  { href: "/admin/pricing", labelKey: "nav.pricing", icon: "rupee" },
  { href: "/admin/schemes", labelKey: "nav.schemes", icon: "percent" },
  { href: "/admin/team", labelKey: "nav.team", icon: "users" },
  { href: "/team", labelKey: "nav.field", icon: "pin" },
  { href: "/admin/regions", labelKey: "nav.regions", icon: "map" },
  { href: "/admin/import", labelKey: "nav.import", icon: "upload" },
  { href: "/admin/complaints", labelKey: "nav.complaints", icon: "chat" },
  { href: "/admin/engage", labelKey: "nav.engage", icon: "megaphone" },
  { href: "/admin/integrations", labelKey: "nav.integrations", icon: "share" },
  { href: "/admin/billing", labelKey: "nav.billing", icon: "receipt" },
  { href: "/admin/setup", labelKey: "nav.setup", icon: "check" },
  { href: "/admin/settings", labelKey: "nav.settings", icon: "settings" },
];

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const session = await pageSession();
  if (!session || session.role !== "ADMIN") redirect("/login");

  const chrome = await layoutChrome(session, nav);

  return (
    <AppShell chrome={chrome} nav={nav} userName={session.name} roleKey="role.admin">
      {children}
    </AppShell>
  );
}
