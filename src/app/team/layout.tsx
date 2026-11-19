import { redirect } from "next/navigation";
import { pageSession } from "@/lib/guard";
import { can } from "@/lib/permissions";
import AppShell, { type NavItem } from "@/components/AppShell";
import DutyTracker from "@/components/field/DutyTracker";

const nav: NavItem[] = [
  { href: "/team", labelKey: "nav.teamToday", icon: "map" },
  { href: "/team/leave", labelKey: "nav.leave", icon: "clock" },
  { href: "/team/beats", labelKey: "nav.beats", icon: "route" },
  { href: "/team/targets", labelKey: "nav.targets", icon: "chart" },
  { href: "/team/stores", labelKey: "nav.shops", icon: "plus" },
  { href: "/team/reports", labelKey: "nav.reports", icon: "download" },
];

/** The supervisor's app; admins reach it from the admin app to watch the field team. */
export default async function TeamLayout({ children }: { children: React.ReactNode }) {
  const session = await pageSession();
  if (!session || !can(session.role, "team.supervise")) redirect("/login");
  const supervisor = session.role === "SUPERVISOR";

  const items: NavItem[] = supervisor
    ? [...nav, { href: "/team/me", labelKey: "nav.attendance", icon: "user" }]
    : [{ href: "/admin", labelKey: "nav.pipeline", icon: "home" }, ...nav];

  return (
    <AppShell nav={items} userName={session.name} roleKey={supervisor ? "role.supervisor" : "role.admin"}>
      {supervisor && <DutyTracker />}
      {children}
    </AppShell>
  );
}
