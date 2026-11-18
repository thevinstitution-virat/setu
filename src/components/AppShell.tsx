"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useLanguage } from "@/lib/i18n/LanguageProvider";
import type { DictKey } from "@/lib/i18n/dictionary";
import LanguageToggle from "@/components/LanguageToggle";
import { APP_SHORT_NAME } from "@/lib/brand";

export type NavItem = { href: string; labelKey: DictKey; icon: string };

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

  async function logout() {
    await fetch("/api/auth/logout", { method: "POST" });
    router.push("/login");
    router.refresh();
  }

  return (
    <div className="min-h-screen flex flex-col pb-20 md:pb-0">
      <header className="sticky top-0 z-10 bg-white border-b border-black/5">
        <div className="max-w-5xl mx-auto px-4 py-3 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="h-9 w-9 rounded-xl bg-gradient-to-br from-mor to-[#0c3634] text-genda font-bold flex items-center justify-center">
              <svg viewBox="0 0 24 24" className="h-5 w-5" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                <path d="M2 17c4-7 16-7 20 0" />
                <path d="M2 17h20M6 17v-3.5M10 17v-5M14 17v-5M18 17v-3.5" />
              </svg>
            </div>
            <div>
              <p className="text-sm font-heading font-bold leading-none">{APP_SHORT_NAME}</p>
              <p className="text-xs text-foreground/50 leading-none mt-1">{t(roleKey)}</p>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <LanguageToggle />
            <span className="text-sm text-foreground/70 hidden sm:inline">{userName}</span>
            <button
              onClick={logout}
              className="text-xs font-bold rounded-lg px-3 py-1.5 bg-ink/5 hover:bg-ink/10 transition"
            >
              {t("common.logout")}
            </button>
          </div>
        </div>
        <nav className="hidden md:flex max-w-5xl mx-auto px-4 gap-1 pb-2">
          {nav.map((item) => (
            <NavLink key={item.href} item={item} active={pathname.startsWith(item.href)} />
          ))}
        </nav>
      </header>

      <main className="flex-1 max-w-5xl w-full mx-auto px-4 py-5">{children}</main>

      <nav className="md:hidden fixed bottom-0 inset-x-0 bg-white border-t border-black/5 flex z-10">
        {nav.map((item) => (
          <NavLinkMobile key={item.href} item={item} active={pathname.startsWith(item.href)} />
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
      className={`rounded-lg px-3 py-1.5 text-sm font-medium transition ${
        active ? "bg-brand-light text-brand-dark" : "text-foreground/60 hover:bg-black/5"
      }`}
    >
      {item.icon} {t(item.labelKey)}
    </Link>
  );
}

function NavLinkMobile({ item, active }: { item: NavItem; active: boolean }) {
  const { t } = useLanguage();
  return (
    <Link
      href={item.href}
      className={`flex-1 flex flex-col items-center gap-0.5 py-2.5 text-xs ${
        active ? "text-brand-dark" : "text-foreground/50"
      }`}
    >
      <span className="text-lg leading-none">{item.icon}</span>
      {t(item.labelKey)}
    </Link>
  );
}
