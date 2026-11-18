import { getSession } from "@/lib/auth";
import { getDb } from "@/lib/tenant";

export default async function RetailerAccount() {
  const db = await getDb();
  const session = await getSession();
  const profile = await db.retailerProfile.findUnique({
    where: { userId: session!.userId },
    include: { user: true, area: { include: { region: true } }, salesAgent: { include: { user: true } } },
  });

  if (!profile) return null;

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
    </div>
  );
}
