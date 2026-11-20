import { formatINR } from "@/lib/money";
import Link from "next/link";
import { getSession } from "@/lib/auth";
import { getDb, requireTenant } from "@/lib/tenant";
import { withMoney } from "@/lib/ledger";
import { khataSummary } from "@/lib/khata";
import { STATUS_COLOR, ORDER_STATUS_FLOW } from "@/lib/orders";
import { getServerLang, tr } from "@/lib/i18n/server";
import Icon from "@/components/Icon";
import HomeShelves from "@/components/store/HomeShelves";
import { formatDay } from "@/components/store/format";
import AnnouncementCards from "@/components/engage/AnnouncementCards";
import { referralSettings } from "@/lib/engage-settings";
import RatePrompt from "./RatePrompt";

export default async function RetailerHome() {
  const db = await getDb();
  const session = await getSession();
  const lang = await getServerLang();
  const profile = await db.retailerProfile.findUnique({
    where: { userId: session!.userId },
    include: { area: { include: { region: true } } },
  });

  const latestOrder = profile
    ? await db.order.findFirst({
        where: { retailerId: profile.id },
        orderBy: { createdAt: "desc" },
        include: { items: { include: { product: true } }, delivery: { include: { deliveryAgent: { include: { user: true } } } } },
      })
    : null;

  const tenant = await requireTenant();
  const khata = profile ? await withMoney(tenant.id, session!.userId, (ctx) => khataSummary(ctx, profile.id)) : null;

  const referral = referralSettings(tenant.settings);
  const orderCount = profile ? await db.order.count({ where: { retailerId: profile.id } }) : 0;
  const reachedIdx = latestOrder ? ORDER_STATUS_FLOW.indexOf(latestOrder.status) : -1;

  return (
    <div className="space-y-6">
      <div>
        <p className="page-kick">Welcome</p>
        <h1 className="page-title">{profile?.outletName}</h1>
        <p className="page-sub">
          {profile?.area.name}, {profile?.area.region.name}
        </p>
      </div>

      <RatePrompt />

      {khata && <KhataCard k={khata} />}

      <AnnouncementCards />

      {latestOrder ? (
        <div className="panel-dark p-5 space-y-4">
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="text-xs font-bold uppercase tracking-[0.12em] text-genda">Latest order</p>
              <p className="font-heading font-bold text-xl mt-1">{latestOrder.orderNumber}</p>
              <p className="text-sm text-white/70 mt-0.5">
                {latestOrder.items.length} item{latestOrder.items.length !== 1 ? "s" : ""} · {formatINR(latestOrder.totalAmount)}
              </p>
              {latestOrder.deliveryDate && latestOrder.status !== "DELIVERED" && latestOrder.status !== "CANCELLED" && (
                <p className="text-xs font-semibold text-genda mt-1">Delivery {formatDay(latestOrder.deliveryDate)}</p>
              )}
            </div>
            <span className={`text-xs px-2.5 py-1 rounded-full ${STATUS_COLOR[latestOrder.status]}`}>
              {tr(`status.${latestOrder.status}`, lang)}
            </span>
          </div>

          {latestOrder.status !== "CANCELLED" && (
            <ol className="grid grid-cols-5 gap-1.5">
              {ORDER_STATUS_FLOW.map((s, i) => {
                const reached = reachedIdx >= i;
                const done = latestOrder.status === "DELIVERED";
                return (
                  <li key={s} className="flex flex-col gap-1.5">
                    <div
                      className={`h-1.5 rounded-full ${
                        reached ? (done ? "bg-[var(--mint)]" : "bg-[var(--kesar)]") : "bg-white/15"
                      }`}
                    />
                    <span className={`text-[10.5px] leading-tight font-semibold ${reached ? "text-white/85" : "text-white/40"}`}>
                      {tr(`status.${s}`, lang)}
                    </span>
                  </li>
                );
              })}
            </ol>
          )}

          <div className="flex items-center justify-between gap-3 pt-1">
            {latestOrder.delivery?.deliveryAgent ? (
              <p className="text-xs text-white/70 flex items-center gap-1.5">
                <Icon name="truck" className="h-4 w-4 text-genda" />
                Delivery by {latestOrder.delivery.deliveryAgent.user.name}
              </p>
            ) : (
              <span />
            )}
            <Link href={`/retailer/orders/${latestOrder.id}`} className="btn btn-kesar btn-sm">
              View timeline <Icon name="arrow" className="h-4 w-4" />
            </Link>
          </div>
        </div>
      ) : (
        <div className="card p-6 text-center space-y-3">
          <p className="text-[var(--ink-2)]">You haven&apos;t placed an order yet.</p>
          <Link href="/retailer/catalogue" className="btn btn-kesar btn-sm">
            Browse the catalogue <Icon name="arrow" className="h-4 w-4" />
          </Link>
        </div>
      )}

      <HomeShelves />

      <div className="grid grid-cols-2 gap-3">
        <Link href="/retailer/catalogue" className="card p-4 flex flex-col gap-3 hover:-translate-y-0.5 transition">
          <span className="icon-tile bg-[var(--kesar-tint)] text-[var(--kesar-text)]">
            <Icon name="cart" />
          </span>
          <span>
            <span className="block font-bold text-sm">New order</span>
            <span className="block text-xs text-[var(--muted)] mt-0.5">From the catalogue</span>
          </span>
        </Link>
        <Link href="/retailer/orders" className="card p-4 flex flex-col gap-3 hover:-translate-y-0.5 transition">
          <span className="icon-tile bg-[var(--mint-tint)] text-[var(--mint-text)]">
            <Icon name="box" />
          </span>
          <span>
            <span className="block stat-num !text-2xl">{orderCount}</span>
            <span className="block text-xs text-[var(--muted)] mt-1">Total orders</span>
          </span>
        </Link>
      </div>

      {referral.on && (
        <Link href="/retailer/refer" className="card p-4 flex items-center gap-3 hover:-translate-y-0.5 transition">
          <span className="icon-tile bg-[var(--genda-tint)] text-[var(--genda-text)] shrink-0">
            <Icon name="gift" />
          </span>
          <span className="flex-1 min-w-0">
            <span className="block font-bold text-sm">Refer a shop, earn {formatINR(referral.referrerReward, { whole: true })}</span>
            <span className="block text-xs text-[var(--muted)] mt-0.5">Added to your wallet after their first order</span>
          </span>
          <Icon name="arrow" className="h-4 w-4 shrink-0" />
        </Link>
      )}

      <Link href="/retailer/help" className="card p-4 flex items-center gap-3 hover:-translate-y-0.5 transition">
        <span className="icon-tile bg-ink/5 text-[var(--ink-2)] shrink-0">
          <Icon name="chat" />
        </span>
        <span className="flex-1 min-w-0">
          <span className="block font-bold text-sm">Need help?</span>
          <span className="block text-xs text-[var(--muted)] mt-0.5">Raise a complaint about an order or a bill</span>
        </span>
        <Icon name="arrow" className="h-4 w-4 shrink-0" />
      </Link>
    </div>
  );
}

function KhataCard({ k }: { k: Awaited<ReturnType<typeof khataSummary>> }) {
  const owes = k.balances.receivable;
  const prepaid = k.terms.mode === "PREPAID";
  return (
    <Link href="/retailer/khata" className="card p-4 flex items-center gap-3 hover:-translate-y-0.5 transition">
      <span
        className={`icon-tile ${
          k.overdue > 0 ? "bg-[#fde4e1] text-[#a8281e]" : "bg-[var(--mint-tint)] text-[var(--mint-text)]"
        }`}
      >
        <Icon name={prepaid ? "wallet" : "book"} />
      </span>
      <span className="flex-1 min-w-0">
        <span className="block text-xs text-[var(--muted)]">
          {prepaid ? "Wallet balance" : owes > 0 ? "You owe" : owes < 0 ? "Advance with us" : "My khata"}
        </span>
        <span className="block font-heading font-bold text-xl leading-tight mt-0.5">
          {prepaid ? formatINR(k.balances.walletAvailable) : owes === 0 ? "All paid" : formatINR(Math.abs(owes))}
        </span>
        {k.overdue > 0 ? (
          <span className="block text-xs font-bold text-[#a8281e] mt-0.5">{formatINR(k.overdue)} overdue</span>
        ) : prepaid && owes > 0 ? (
          <span className="block text-xs text-[var(--muted)] mt-0.5">Dues {formatINR(owes)}</span>
        ) : k.pendingVerification.amount > 0 ? (
          <span className="block text-xs text-[var(--muted)] mt-0.5">
            {formatINR(k.pendingVerification.amount)} waiting for confirmation
          </span>
        ) : null}
      </span>
      <span className="btn btn-kesar btn-xs">
        {owes > 0 || prepaid ? "Pay now" : "Open"} <Icon name="arrow" className="h-3.5 w-3.5" />
      </span>
    </Link>
  );
}
