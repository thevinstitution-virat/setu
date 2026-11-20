import { getSession } from "@/lib/auth";
import Link from "next/link";
import { getDb, requireTenant } from "@/lib/tenant";
import { referralSettings } from "@/lib/engage-settings";
import Icon, { type IconName } from "@/components/Icon";
import DeliveryPrefsCard from "./DeliveryPrefsCard";

export default async function RetailerAccount() {
  const db = await getDb();
  const session = await getSession();
  const profile = await db.retailerProfile.findUnique({
    where: { userId: session!.userId },
    include: { user: true, area: { include: { region: true } }, salesAgent: { include: { user: true } } },
  });

  if (!profile) return null;
  const referOn = referralSettings((await requireTenant()).settings).on;
  const links: [string, IconName, string, string][] = [
    ...(referOn ? [["/retailer/refer", "gift", "Refer & earn", "Share your code with other shops"] as [string, IconName, string, string]] : []),
    ["/retailer/notifications", "bell", "Notifications", "Messages, language, WhatsApp and phone alerts"],
    ["/retailer/help", "chat", "Help and complaints", "Report a problem with an order or bill"],
  ];

  const rows: [string, string][] = [
    ["Outlet name", profile.outletName],
    ["Mobile", profile.user.phone ?? "—"],
    ["Shop number", profile.shopNumber],
    ["Complex", profile.complexName],
    ["PIN code", profile.pinCode],
    ["Area", profile.area.name],
    ["Region", profile.area.region.name],
    ["Sales agent", profile.salesAgent?.user.name ?? "Not yet assigned"],
  ];

  return (
    <div className="space-y-4">
      <h1 className="page-title">Account</h1>
      <div className="card divide-y divide-black/5">
        {rows.map(([label, value]) => (
          <div key={label} className="flex justify-between px-4 py-3 text-sm">
            <span className="text-foreground/50">{label}</span>
            <span className="font-medium text-right">{value}</span>
          </div>
        ))}
      </div>
      <DeliveryPrefsCard pref={profile.deliveryPref} note={profile.deliveryNote} />
      <div className="card divide-y divide-[var(--line)]">
        {links.map(([href, icon, label, sub]) => (
          <Link key={href} href={href} className="flex items-center gap-3 px-4 py-3 min-h-[60px] hover:bg-black/[0.03]">
            <span className="icon-tile !h-10 !w-10 shrink-0 bg-ink/5 text-[var(--ink-2)]">
              <Icon name={icon} className="h-5 w-5" />
            </span>
            <span className="flex-1 min-w-0">
              <span className="block font-bold text-sm">{label}</span>
              <span className="block text-xs text-[var(--muted)]">{sub}</span>
            </span>
            <Icon name="chevronRight" className="h-4 w-4 shrink-0 text-[var(--muted)]" />
          </Link>
        ))}
      </div>
    </div>
  );
}
