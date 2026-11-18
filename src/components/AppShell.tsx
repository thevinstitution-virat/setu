"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useLanguage } from "@/lib/i18n/LanguageProvider";
import type { DictKey } from "@/lib/i18n/dictionary";
import LanguageToggle from "@/components/LanguageToggle";
import { BrandLockup } from "@/components/BrandMark";
import Icon, { type IconName } from "@/components/Icon";

export type NavItem = { href: string; labelKey: DictKey; icon: IconName };

/**
 * The nav item for the current page: the longest href that is the path itself
 * or a parent of it. Plain `startsWith` marked the role's home link ("/sales")
 * active on every page, since every page path starts with it.
 */
function activeHref(pathname: string, nav: NavItem[]) {
  let best: string | null = null;
  for (const { href } of nav) {
    if (pathname === href || pathname.startsWith(href + "/")) {
      if (!best || href.length > best.length) best = href;
    }
  }
  return best;
}

export default function AppShell({
  children,
  nav,
  userName,
  roleKey,
}: {
  children: React.ReactNode;
  nav: NavItem[];
  userName: string;
  roleKey: DictKey;
}) {
  const pathname = usePathname();
  const router = useRouter();
  const { t } = useLanguage();
  const current = activeHref(pathname, nav);

  async function logout() {
    await fetch("/api/auth/logout", { method: "POST" });
    router.push("/login");
    router.refresh();
  }

  return (
    <div className="min-h-screen flex flex-col pb-24 md:pb-0">
      <header className="sticky top-0 z-20 border-b border-[var(--line)] bg-[rgba(246,241,231,0.78)] backdrop-blur-xl backdrop-saturate-150">
        <div className="max-w-5xl mx-auto px-4 h-16 flex items-center gap-3">
          <Link href={nav[0]?.href ?? "/"} className="min-w-0" aria-label={t(roleKey)}>
            <BrandLockup sub={t(roleKey)} />
          </Link>

          <nav className="hidden md:flex items-center gap-1 ml-4" aria-label="Main">
            {nav.map((item) => (
              <NavLink key={item.href} item={item} active={item.href === current} />
            ))}
          </nav>

          <span className="flex-1" />
          <LanguageToggle />
          <span className="text-sm font-semibold text-[var(--ink-2)] hidden lg:inline max-w-[160px] truncate">
            {userName}
          </span>
          <button
            onClick={logout}
            className="btn btn-quiet btn-xs"
            aria-label={t("common.logout")}
            title={t("common.logout")}
          >
            <Icon name="logout" className="h-4 w-4" />
            <span className="hidden sm:inline">{t("common.logout")}</span>
          </button>
        </div>
      </header>

      <main className="flex-1 max-w-5xl w-full mx-auto px-4 py-6">{children}</main>

      <nav
        className="md:hidden fixed bottom-3 inset-x-3 z-20 flex rounded-2xl glass"
        aria-label="Main"
      >
        {nav.map((item) => (
          <NavLinkMobile key={item.href} item={item} active={item.href === current} />
        ))}
      </nav>
    </div>
  );
}

function NavLink({ item, active }: { item: NavItem; active: boolean }) {
  const { t } = useLanguage();
  return (
    <Link
      href={item.href}
      aria-current={active ? "page" : undefined}
      className={`inline-flex items-center gap-1.5 rounded-xl px-3 py-2 text-sm font-bold transition ${
        active
          ? "bg-gradient-to-br from-mor to-[#0c3634] text-white shadow-[0_10px_20px_-12px_rgba(8,38,37,.9)]"
          : "text-[var(--ink-2)] hover:bg-ink/5"
      }`}
    >
      <Icon name={item.icon} className={`h-4 w-4 ${active ? "text-genda" : ""}`} />
      {t(item.labelKey)}
    </Link>
  );
}

function NavLinkMobile({ item, active }: { item: NavItem; active: boolean }) {
  const { t } = useLanguage();
  return (
    <Link
      href={item.href}
      aria-current={active ? "page" : undefined}
      className={`flex-1 flex flex-col items-center gap-1 py-2.5 text-[11.5px] font-bold ${
        active ? "text-[var(--kesar-text)]" : "text-[var(--muted)]"
      }`}
    >
      <span
        className={`grid place-items-center h-8 w-12 rounded-xl transition ${
          active ? "bg-[var(--kesar-tint)]" : ""
        }`}
      >
        <Icon name={item.icon} className="h-5 w-5" />
      </span>
      {t(item.labelKey)}
    </Link>
  );
}
