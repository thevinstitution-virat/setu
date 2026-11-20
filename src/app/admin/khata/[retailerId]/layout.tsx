import { pageSession } from "@/lib/guard";
import { can } from "@/lib/permissions";
import { KhataPermsProvider } from "@/components/admin/RetailerDeliveryCards";

/** Works out on the server what this user may change on the khata's delivery and crate cards. */
export default async function RetailerKhataLayout({ children }: { children: React.ReactNode }) {
  const session = await pageSession();
  const perms = {
    delivery: !!session && can(session.role, "retailers.manage"),
    crates: !!session && can(session.role, "ledger.adjust"),
  };
  return <KhataPermsProvider value={perms}>{children}</KhataPermsProvider>;
}
