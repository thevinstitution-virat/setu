import { formatINR } from "@/lib/money";
import Link from "next/link";
import { getSession } from "@/lib/auth";
import { getDb, requireTenant } from "@/lib/tenant";
import { withMoney } from "@/lib/ledger";
import { khataSummary } from "@/lib/khata";
import { ORDER_STATUS_FLOW } from "@/lib/orders";
import { getServerLang, tr } from "@/lib/i18n/server";
import Icon from "@/components/Icon";
import HomeShelves from "@/components/store/HomeShelves";
import { formatDay } from "@/components/store/format";
import AnnouncementCards from "@/components/engage/AnnouncementCards";
import { referralSettings } from "@/lib/engage-settings";
import KhataCard from "@/components/ui/KhataCard";
import CreditMeter from "@/components/ui/CreditMeter";
import StatusPill from "@/components/ui/StatusPill";
import EmptyState from "@/components/ui/EmptyState";
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
  const prepaid = khata?.terms.mode === "PREPAID";

  const money = khata && (
    <div className={`grid gap-3 ${prepaid ? "" : "grid-cols-2"}`}>
      <KhataCard
        owes={khata.balances.receivable}
        overdue={khata.overdue}
        prepaid={prepaid}
        walletAvailable={khata.balances.walletAvailable}
        pendingVerification={khata.pendingVerification.amount}
      />
      {!prepaid && <CreditMeter limit={khata.terms.creditLimit} available={khata.creditAvailable} />}
    </div>
  );

  const below = (
    <div className="space-y-5">
      <RatePrompt />

      {latestOrder ? (
        <section className="card p-4 space-y-4">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="page-kick">Latest order</p>
              <p className="font-heading font-bold text-lg mt-0.5">{latestOrder.orderNumber}</p>
              <p className="text-sm text-[var(--muted)] mt-0.5 num">
                {latestOrder.items.length} item{latestOrder.items.length !== 1 ? "s" : ""} · {formatINR(latestOrder.totalAmount)}
              </p>
              {latestOrder.deliveryDate && latestOrder.status !== "DELIVERED" && latestOrder.status !== "CANCELLED" && (
                <p className="text-xs font-bold text-[var(--accent-text)] mt-1">Delivery {formatDay(latestOrder.deliveryDate)}</p>
              )}
            </div>
            <StatusPill status={latestOrder.status}>{tr(`status.${latestOrder.status}`, lang)}</StatusPill>
          </div>

          {latestOrder.status !== "CANCELLED" && (
            <ol className="grid grid-cols-5 gap-1.5">
              {ORDER_STATUS_FLOW.map((s, i) => {
                const reached = reachedIdx >= i;
                const done = latestOrder.status === "DELIVERED";
                return (
                  <li key={s} className="flex flex-col gap-1.5">
                    <div className={`h-1.5 rounded-full ${reached ? (done ? "bg-[var(--success)]" : "bg-[var(--accent)]") : "bg-[var(--surface-2)]"}`} />
                    <span className={`text-[10.5px] leading-tight font-semibold ${reached ? "text-[var(--ink)]" : "text-[var(--faint)]"}`}>{tr(`status.${s}`, lang)}</span>
                  </li>
                );
              })}
            </ol>
          )}

          <div className="flex items-center justify-between gap-3">
            {latestOrder.delivery?.deliveryAgent ? (
              <p className="text-xs text-[var(--muted)] flex items-center gap-1.5 min-w-0">
                <Icon name="truck" className="h-4 w-4 shrink-0 text-[var(--accent)]" weight="duotone" />
                <span className="truncate">Delivery by {latestOrder.delivery.deliveryAgent.user.name}</span>
              </p>
            ) : (
              <span />
            )}
            <Link href={`/retailer/orders/${latestOrder.id}`} className="btn btn-primary btn-sm shrink-0">
              View timeline <Icon name="arrow" className="h-4 w-4" />
            </Link>
          </div>
        </section>
      ) : (
        <div className="card">
          <EmptyState icon="empty-orders" title="No order yet" text="Your first order will show here with its delivery timeline." action={{ label: "Browse the catalogue", href: "/retailer/catalogue" }} />
        </div>
      )}

      <AnnouncementCards />

      <div className="grid grid-cols-2 gap-3">
        <Link href="/retailer/catalogue" className="card p-4 flex flex-col gap-3 hover:-translate-y-0.5 transition">
          <span className="icon-tile bg-[var(--accent-tint)] text-[var(--accent-text)]">
            <Icon name="cart" weight="duotone" />
          </span>
          <span>
            <span className="block font-bold text-sm">New order</span>
            <span className="block text-xs text-[var(--muted)] mt-0.5">From the catalogue</span>
          </span>
        </Link>
        <Link href="/retailer/orders" className="card p-4 flex flex-col gap-3 hover:-translate-y-0.5 transition">
          <span className="icon-tile bg-[var(--success-tint)] text-[var(--success-text)]">
            <Icon name="box" weight="duotone" />
          </span>
          <span>
            <span className="block stat-num !text-2xl">{orderCount}</span>
            <span className="block text-xs text-[var(--muted)] mt-1">Total orders</span>
          </span>
        </Link>
      </div>

      {referral.on && (
        <Link href="/retailer/refer" className="card p-4 flex items-center gap-3 hover:-translate-y-0.5 transition">
          <span className="icon-tile bg-[var(--scheme-tint)] text-[var(--scheme-text)] shrink-0">
            <Icon name="gift" weight="duotone" />
          </span>
          <span className="flex-1 min-w-0">
            <span className="block font-bold text-sm">Refer a shop, earn {formatINR(referral.referrerReward, { whole: true })}</span>
            <span className="block text-xs text-[var(--muted)] mt-0.5">Added to your wallet after their first order</span>
          </span>
          <Icon name="arrow" className="h-4 w-4 shrink-0" />
        </Link>
      )}

      <Link href="/retailer/help" className="card p-4 flex items-center gap-3 hover:-translate-y-0.5 transition">
        <span className="icon-tile bg-[var(--surface-2)] text-[var(--ink-2)] shrink-0">
          <Icon name="chat" weight="duotone" />
        </span>
        <span className="flex-1 min-w-0">
          <span className="block font-bold text-sm">Need help?</span>
          <span className="block text-xs text-[var(--muted)] mt-0.5">Raise a complaint about an order or a bill</span>
        </span>
        <Icon name="arrow" className="h-4 w-4 shrink-0" />
      </Link>
    </div>
  );

  return <HomeShelves shopName={profile?.outletName ?? ""} area={profile ? `${profile.area.name}, ${profile.area.region.name}` : ""} money={money} below={below} />;
}
