import { redirect } from "next/navigation";
import { getPlatformSession } from "@/lib/platform-auth";
import { PlatformRoleProvider } from "@/components/platform/kit";
import AppShell, { type NavItem, type ShellAccount } from "@/components/AppShell";

/**
 * The console menu, in the same shell as the business office (sidebar on PC,
 * rail on tablet, bottom bar and More sheet on phone). The first entry is home.
 */
const nav: NavItem[] = [
  { href: "/platform", label: "Businesses", icon: "layers", group: "businesses", tab: true },
  { href: "/platform/invoices", label: "Invoices", icon: "receipt", group: "businesses", tab: true },
  { href: "/platform/plans", label: "Plans", icon: "tag", group: "businesses" },
  { href: "/platform/announcements", label: "Announcements", icon: "megaphone", group: "operate" },
  { href: "/platform/usage", label: "Usage", icon: "chart", group: "operate", tab: true },
  { href: "/platform/health", label: "Health", icon: "check", group: "operate", tab: true },
  { href: "/platform/audit", label: "Audit log", icon: "clipboard", group: "safety" },
  { href: "/platform/security", label: "Security", icon: "lock", group: "safety" },
];

const account: ShellAccount = {
  securityHref: "/platform/security",
  logoutUrl: "/api/platform/auth/logout",
  loginHref: "/platform/login",
  bell: false,
  language: false,
};

/** Every console page needs a platform sign-in (the login pages sit outside this group). */
export default async function ConsoleLayout({ children }: { children: React.ReactNode }) {
  const session = await getPlatformSession();
  if (!session) redirect("/platform/login");
  return (
    <AppShell nav={nav} userName={session.name} roleLabel={session.role === "OWNER" ? "Super-admin" : "Support"} account={account}>
      <PlatformRoleProvider role={session.role}>{children}</PlatformRoleProvider>
    </AppShell>
  );
}
