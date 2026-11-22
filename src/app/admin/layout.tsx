import { redirect } from "next/navigation";
import { pageSession } from "@/lib/guard";
import AppShell, { type NavItem } from "@/components/AppShell";
import { layoutChrome } from "@/lib/chrome";

// The office menu in five sections (sidebar on PC, rail on tablet, More sheet on
// phone). The first entry stays /admin: the shell uses it as home and for /notifications.
// `tab` picks the four phone-bar entries.
const nav: NavItem[] = [
  { href: "/admin", labelKey: "nav.pipeline", icon: "grid", group: "overview", tab: true },
  { href: "/admin/reports", labelKey: "nav.reports", icon: "chart", group: "overview" },
  { href: "/admin/suggestions", labelKey: "nav.suggestions", icon: "sparkle", group: "overview" },

  { href: "/admin/orders", labelKey: "nav.orders", icon: "box", group: "sell", tab: true },
  { href: "/admin/schemes", labelKey: "nav.schemes", icon: "percent", group: "sell" },
  { href: "/admin/pricing", labelKey: "nav.pricing", icon: "rupee", group: "sell" },
  { href: "/admin/complaints", labelKey: "nav.complaints", icon: "chat", group: "sell" },
  { href: "/admin/engage", labelKey: "nav.engage", icon: "megaphone", group: "sell" },

  { href: "/admin/dispatch", labelKey: "nav.dispatch", icon: "truck", group: "deliver", tab: true },
  { href: "/admin/stock", labelKey: "nav.stock", icon: "stock", group: "deliver" },
  { href: "/team", labelKey: "nav.field", icon: "pin", group: "deliver" },
  { href: "/admin/regions", labelKey: "nav.regions", icon: "map", group: "deliver" },

  { href: "/admin/khata", labelKey: "nav.khata", icon: "book", group: "money", tab: true },
  { href: "/admin/invoices", labelKey: "nav.invoices", icon: "receipt", group: "money" },
  { href: "/admin/payments", labelKey: "nav.payments", icon: "card", group: "money" },
  { href: "/admin/cash", labelKey: "nav.cash", icon: "cash", group: "money" },
  { href: "/admin/bank", labelKey: "nav.bank", icon: "wallet", group: "money" },

  { href: "/admin/products", labelKey: "nav.products", icon: "tag", group: "setup" },
  { href: "/admin/team", labelKey: "nav.team", icon: "users", group: "setup" },
  { href: "/admin/import", labelKey: "nav.import", icon: "upload", group: "setup" },
  { href: "/admin/integrations", labelKey: "nav.integrations", icon: "share", group: "setup" },
  { href: "/admin/billing", labelKey: "nav.billing", icon: "file", group: "setup" },
  { href: "/admin/setup", labelKey: "nav.setup", icon: "check", group: "setup" },
  { href: "/admin/settings", labelKey: "nav.settings", icon: "settings", group: "setup" },
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
