"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import type { CatalogueProduct } from "@/lib/pricing";
import { formatINR } from "@/lib/money";
import Icon from "@/components/Icon";
import { fileUrl } from "./format";
import { ProductThumb, type Banner, type CatalogueData } from "./shared";

const CATALOGUE = "/retailer/catalogue";

/** Where a banner leads in the catalogue (null = no link). url banners open outside. */
function bannerHref(b: Banner): string | null {
  if (!b.linkId) return null;
  const id = encodeURIComponent(b.linkId);
  switch (b.linkType) {
    case "product":
      return `${CATALOGUE}?product=${id}`;
    case "brand":
      return `${CATALOGUE}?brand=${id}`;
    case "category":
      return `${CATALOGUE}?category=${id}`;
    case "scheme":
      return `${CATALOGUE}?scheme=${id}`;
    case "url":
      return /^https:\/\//i.test(b.linkId) ? b.linkId : null;
    default:
      return null;
  }
}

/**
 * Retailer home: banners, "Schemes for you" and "Buy again", from the same
 * GET /api/catalogue the storefront uses. Each links into the catalogue with
 * a filter. Shows nothing while loading or if the catalogue can't be read.
 */
export default function HomeShelves() {
  const [data, setData] = useState<CatalogueData | null>(null);

  useEffect(() => {
    let live = true;
    fetch("/api/catalogue")
      .then((r) => (r.ok ? r.json() : null))
      .then((d: CatalogueData | null) => {
        if (live && d) setData(d);
      })
      .catch(() => {});
    return () => {
      live = false;
    };
  }, []);

  if (!data) return null;
  const byId = new Map(data.products.map((p) => [p.id, p]));
  const buyAgain = data.buyAgain.map((id) => byId.get(id)).filter((p): p is CatalogueProduct => !!p).slice(0, 10);
  if (!data.banners.length && !data.offers.length && !buyAgain.length) return null;

  return (
    <div className="space-y-5">
      {data.banners.length > 0 && (
        <div className="flex gap-3 overflow-x-auto snap-x snap-mandatory pb-1 [scrollbar-width:none]">
          {data.banners.map((b) => {
            const href = bannerHref(b);
            const cls = "panel-dark relative overflow-hidden snap-start shrink-0 w-[85%] sm:w-[360px] h-32 flex flex-col";
            const body = (
              <>
                {b.imageKey && (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={fileUrl(b.imageKey)} alt="" className="absolute inset-0 h-full w-full object-cover" />
                )}
                {b.imageKey && <span className="absolute inset-0 bg-gradient-to-t from-[rgba(8,38,37,0.85)] via-[rgba(8,38,37,0.25)] to-transparent" />}
                <span className="relative mt-auto block p-4">
                  <span className="block font-heading font-bold text-lg leading-tight">{b.title}</span>
                  {b.subtitle && <span className="block text-xs text-white/80 mt-0.5">{b.subtitle}</span>}
                </span>
              </>
            );
            if (!href) return <div key={b.id} className={cls}>{body}</div>;
            if (b.linkType === "url")
              return (
                <a key={b.id} href={href} target="_blank" rel="noopener noreferrer" className={cls}>
                  {body}
                </a>
              );
            return (
              <Link key={b.id} href={href} className={cls}>
                {body}
              </Link>
            );
          })}
        </div>
      )}

      {data.offers.length > 0 && (
        <section className="space-y-2">
          <div className="flex items-center justify-between gap-3">
            <p className="page-kick">Schemes for you</p>
            <Link href={CATALOGUE} className="text-xs font-bold text-[var(--kesar-text)]">
              See all
            </Link>
          </div>
          <div className="flex gap-2 overflow-x-auto pb-1 [scrollbar-width:none]">
            {data.offers.map((o) => (
              <Link key={o.id} href={`${CATALOGUE}?scheme=${encodeURIComponent(o.id)}`} className="chip chip-kesar shrink-0 !py-1.5" title={o.name}>
                <Icon name="tag" className="h-3.5 w-3.5" />
                {o.summary}
              </Link>
            ))}
          </div>
        </section>
      )}

      {buyAgain.length > 0 && (
        <section className="space-y-2">
          <div className="flex items-center justify-between gap-3">
            <p className="page-kick">Buy again</p>
            <Link href={CATALOGUE} className="text-xs font-bold text-[var(--kesar-text)]">
              Catalogue
            </Link>
          </div>
          <div className="flex gap-2.5 overflow-x-auto pb-1 [scrollbar-width:none]">
            {buyAgain.map((p) => (
              <Link
                key={p.id}
                href={`${CATALOGUE}?product=${encodeURIComponent(p.id)}`}
                className="card shrink-0 w-[132px] p-2.5 space-y-1.5 hover:-translate-y-0.5 transition"
              >
                <ProductThumb name={p.name} imageKey={p.images[0]} className="h-12 w-12" />
                <span className="block text-xs font-semibold leading-snug line-clamp-2">{p.name}</span>
                <span className="block text-xs text-[var(--muted)]">
                  {formatINR(p.price)} / {p.unit}
                </span>
              </Link>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
