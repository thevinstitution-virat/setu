"use client";

import { useState } from "react";
import Icon, { ICON_NAMES } from "@/components/Icon";
import { Icon3D } from "@/components/icons3d/Icon3D";
import { ICON3D, type Icon3DName } from "@/lib/ui/icons3d";
import { categoryIcon } from "@/lib/ui/categoryIcons";
import { formatINR } from "@/lib/money";
import StatCard from "@/components/ui/StatCard";
import StatusPill from "@/components/ui/StatusPill";
import EmptyState from "@/components/ui/EmptyState";
import Tabs from "@/components/ui/Tabs";
import OtpInput from "@/components/ui/OtpInput";
import CartBar from "@/components/ui/CartBar";
import CreditMeter from "@/components/ui/CreditMeter";
import KhataCard from "@/components/ui/KhataCard";
import CategoryRail from "@/components/ui/CategoryRail";
import BrandFilter from "@/components/ui/BrandFilter";
import SchemeCarousel, { SchemeBanner } from "@/components/ui/SchemeBanner";
import { ProductCardSkeleton, RowSkeleton, StatSkeletons } from "@/components/ui/Skeleton";
import { ToastHost, toast } from "@/components/ui/Toast";
import { QtyControl, Sheet, StockChip, ProductThumb, type CartEntry } from "@/components/store/shared";
import type { CatalogueProduct } from "@/lib/pricing";

const DEMO_PRODUCT = { id: "demo", name: "Black Shine Shampoo 180ml", unit: "bottle", moq: 1, caseSize: 24, caseUnit: "case" } as unknown as CatalogueProduct;
const CATS = ["Shampoo", "Biscuits", "Atta, Rice & Dal", "Liquid Detergent", "आटा", "Misc"].map((name, i) => ({ id: String(i), name }));
const BRANDS = ["Brand one", "Brand two", "Brand three", "Brand four", "Brand five"].map((name, i) => ({ id: String(i), name, logoKey: null }));

function Block({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="space-y-3">
      <h2 className="font-heading font-bold text-lg">{title}</h2>
      {children}
    </section>
  );
}

/** One column of the showcase; rendered once per surface. */
function Surface({ name, surface }: { name: string; surface?: "retailer" }) {
  const [entry, setEntry] = useState<CartEntry | undefined>();
  const [tab, setTab] = useState<"a" | "b">("a");
  const [otp, setOtp] = useState("");
  const [cat, setCat] = useState<string | null>("0");
  const [brand, setBrand] = useState<string | null>(null);
  const [sheet, setSheet] = useState(false);
  const [loadingBtn, setLoadingBtn] = useState(false);

  return (
    <div data-surface={surface} className="rounded-3xl p-5 space-y-8 bg-[var(--canvas)] border border-[var(--line)] min-w-0">
      <p className="chip chip-mor">{name}</p>

      <Block title="Buttons">
        <div className="flex flex-wrap gap-2">
          <button className="btn btn-primary">Primary</button>
          <button className="btn btn-outline">Outline</button>
          <button className="btn btn-money">Money</button>
          <button className="btn btn-scheme">Scheme</button>
          <button className="btn btn-soft">Soft</button>
          <button className="btn btn-quiet">Ghost</button>
          <button className="btn btn-danger">Danger</button>
          <button className="btn btn-primary" disabled>Disabled</button>
          <button className={`btn btn-primary ${loadingBtn ? "is-loading" : ""}`} onClick={() => { setLoadingBtn(true); setTimeout(() => setLoadingBtn(false), 1500); }}>Loading</button>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button className="btn btn-primary btn-xs">32</button>
          <button className="btn btn-primary btn-sm">40</button>
          <button className="btn btn-primary">48</button>
          <button className="btn btn-primary btn-lg">56</button>
        </div>
      </Block>

      <Block title="Chips and status">
        <div className="flex flex-wrap gap-2">
          <span className="chip chip-kesar">Accent</span>
          <span className="chip chip-money">Money</span>
          <span className="chip chip-scheme">Scheme</span>
          <span className="chip chip-risk">Risk</span>
          <span className="chip chip-mint">Success</span>
          <span className="chip chip-neutral">Neutral</span>
          <StatusPill status="PLACED">Placed</StatusPill>
          <StatusPill status="OUT_FOR_DELIVERY">On the way</StatusPill>
          <StatusPill status="DELIVERED">Delivered</StatusPill>
          <StatusPill status="CANCELLED">Cancelled</StatusPill>
          <StockChip stock="low" />
          <StockChip stock="out" />
        </div>
      </Block>

      <Block title="Add stepper and product thumb (no photo)">
        <div className="flex items-center gap-3">
          <ProductThumb name="Black Shine Shampoo 180ml" className="h-16 w-16" />
          <ProductThumb name="Mystery item" className="h-16 w-16" />
          <QtyControl product={DEMO_PRODUCT} entry={entry} onChangeAction={(e) => setEntry(e ?? undefined)} />
        </div>
      </Block>

      <Block title="Stat cards">
        <div className="grid grid-cols-2 gap-3">
          <StatCard tone="accent" label="Sales today" value={formatINR(48200000, { compact: true })} delta="▲ 12% vs last Tue" spark={[3, 5, 4, 7, 6, 9, 8, 12]} />
          <StatCard tone="money" label="Outstanding" value={formatINR(186000000, { compact: true })} delta="₹3.1L over 30 days" />
          <StatCard tone="scheme" label="Live schemes" value="9" delta="5 + 4" />
          <StatCard tone="risk" label="Low-stock SKUs" value="14" delta="Reorder →" />
          <StatCard label="Neutral" value="₹1,84,000" delta="full amount in tables" />
        </div>
      </Block>

      <Block title="Khata and credit">
        <div className="grid grid-cols-2 gap-3">
          <KhataCard href="#" owes={1248000} overdue={0} prepaid={false} walletAvailable={0} />
          <CreditMeter limit={5000000} available={3752000} />
          <KhataCard href="#" owes={1248000} overdue={420000} prepaid={false} walletAvailable={0} />
          <CreditMeter limit={5000000} available={400000} />
          <CreditMeter limit={5000000} available={0} />
          <CreditMeter limit={null} available={null} />
        </div>
      </Block>

      <Block title="Scheme banners">
        <SchemeBanner b={{ id: "1", kicker: "Scheme · till 30 Nov", title: "Buy 12 soap, get 2 free", cta: "Add to cart", progress: { have: 11, need: 12, label: "Add 1 more case to unlock" } }} bob />
        <SchemeCarousel items={[{ id: "a", kicker: "Offer", title: "Slab discount on detergent" }, { id: "b", kicker: "Offer", title: "Free case on 10 cases" }]} />
      </Block>

      <Block title="Category rail and brand filter">
        <div className="grid grid-cols-[84px_1fr] gap-3">
          <CategoryRail items={CATS} value={cat} onChangeAction={setCat} />
          <div className="space-y-3 min-w-0">
            <BrandFilter brands={BRANDS} value={brand} onChangeAction={setBrand} />
            <p className="text-sm text-[var(--muted)]">Rail icons come from the category name: {CATS.map((c) => `${c.name} → ${categoryIcon(c.name)}`).join(", ")}</p>
          </div>
        </div>
      </Block>

      <Block title="Tabs, OTP, inputs">
        <Tabs label="Demo" value={tab} onChangeAction={setTab} options={[{ value: "a", label: "Active", count: 3 }, { value: "b", label: "Past" }]} />
        <OtpInput value={otp} onChangeAction={setOtp} />
        <label className="field">
          <input className="input" placeholder=" " id={`f-${name}`} />
          <span className="field-label">Floating label</span>
        </label>
        <div className="flex gap-2">
          <button className="btn btn-outline" onClick={() => setSheet(true)}>Open sheet</button>
          <button className="btn btn-outline" onClick={() => toast("Scheme applied")}>Show toast</button>
        </div>
        <Sheet open={sheet} title="Sheet" onCloseAction={() => setSheet(false)} footer={<button className="btn btn-primary w-full" onClick={() => setSheet(false)}>Done</button>}>
          <p className="text-sm">A drag handle on phones, an X button, a 22px blurred backdrop, and focus kept inside.</p>
        </Sheet>
      </Block>

      <Block title="Loading, empty, error">
        <StatSkeletons n={2} />
        <div className="grid grid-cols-2 gap-3"><ProductCardSkeleton /><ProductCardSkeleton /></div>
        <RowSkeleton rows={2} />
        <div className="card"><EmptyState icon="empty-cart" title="Your cart is empty" text="Add something from the catalogue to start an order." action={{ label: "Browse", href: "#" }} /></div>
        <div className="rounded-xl bg-[var(--risk-tint)] text-[var(--risk-text)] p-3 text-sm font-semibold flex items-center justify-between gap-3">
          Could not load the catalogue. <button className="btn btn-danger btn-xs">Retry</button>
        </div>
      </Block>

      <CartBar count={2} total={288000} note="saving ₹412" onClickAction={() => {}} />
    </div>
  );
}

export default function Showcase() {
  const names = Object.keys(ICON3D) as Icon3DName[];
  return (
    <div className="mx-auto max-w-[1400px] p-4 md:p-8 space-y-8 pb-40">
      <header>
        <p className="page-kick">Development only</p>
        <h1 className="page-title">UI showcase</h1>
        <p className="page-sub">Every shared component, on the staff surface (saffron) and the retailer surface (green).</p>
      </header>
      <div className="grid gap-6 lg:grid-cols-2">
        <Surface name="Staff surface" />
        <Surface name="Retailer surface" surface="retailer" />
      </div>
      <section className="space-y-3">
        <h2 className="font-heading font-bold text-lg">Line icons ({ICON_NAMES.length})</h2>
        <div className="flex flex-wrap gap-3">
          {ICON_NAMES.map((n) => (
            <span key={n} className="flex flex-col items-center gap-1 w-16 text-[10px] text-[var(--muted)]">
              <Icon name={n} className="h-6 w-6 text-[var(--ink)]" weight="duotone" />
              {n}
            </span>
          ))}
        </div>
      </section>
      <section className="space-y-3">
        <h2 className="font-heading font-bold text-lg">3D icons ({names.length}) at 56 and 120</h2>
        <div className="grid grid-cols-[repeat(auto-fill,minmax(96px,1fr))] gap-3">
          {names.map((n) => (
            <div key={n} className="card p-2 grid place-items-center gap-1 text-[10px] text-[var(--muted)]">
              <Icon3D name={n} size={56} tinted />
              <Icon3D name={n} size={56} />
              {n}
            </div>
          ))}
        </div>
        <div data-ground="dark" className="panel-dark p-4 flex flex-wrap gap-3">
          {(["gift-box", "truck", "ledger", "van"] as Icon3DName[]).map((n) => (
            <Icon3D key={n} name={n} size={120} />
          ))}
        </div>
      </section>
      <ToastHost />
    </div>
  );
}
