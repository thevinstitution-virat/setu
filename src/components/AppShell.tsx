"use client";

import { useEffect, useMemo, useState, useSyncExternalStore } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useLanguage } from "@/lib/i18n/LanguageProvider";
import type { DictKey } from "@/lib/i18n/dictionary";
import LanguageToggle from "@/components/LanguageToggle";
import { APP_NAME } from "@/lib/brand";
import { BrandLockup, BrandMark, Logo } from "@/components/BrandMark";
import Icon, { type IconName } from "@/components/Icon";
import { NOTIFY_EVENT } from "@/components/engage/kit";
import ShellNotices from "@/components/ShellNotices";
import { ToastHost } from "@/components/ui/Toast";
import TableKeys from "@/components/ui/TableKeys";
import type { Chrome } from "@/lib/chrome";

export type NavGroup = "overview" | "sell" | "deliver" | "money" | "setup";

/**
 * One menu entry. `group` sorts long menus (the office) into sections; `tab`
 * puts the entry in the phone's bottom bar (without any, the first four go
 * there, or all of them when there are five or fewer).
 */
export type NavItem = { href: string; labelKey: DictKey; icon: IconName; group?: NavGroup; tab?: boolean };

const GROUP_ORDER: NavGroup[] = ["overview", "sell", "deliver", "money", "setup"];

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

/** Menu sections in display order; one untitled section when the menu has no groups. */
function sectionsOf(nav: NavItem[]) {
  if (!nav.some((i) => i.group)) return [{ group: null as NavGroup | null, items: nav }];
  const out: { group: NavGroup | null; items: NavItem[] }[] = [];
  const loose = nav.filter((i) => !i.group);
  if (loose.length) out.push({ group: null, items: loose });
  for (const g of GROUP_ORDER) {
    const items = nav.filter((i) => i.group === g);
    if (items.length) out.push({ group: g, items });
  }
  return out;
}

/** The phone bar: flagged items, else the first four (all of them when five or fewer). */
function tabsOf(nav: NavItem[]) {
  const flagged = nav.filter((i) => i.tab);
  if (flagged.length) return flagged.slice(0, 4);
  return nav.length <= 5 ? nav : nav.slice(0, 4);
}

/** Browser online / offline, without an effect. */
function useOnline() {
  return useSyncExternalStore(
    (cb) => {
      window.addEventListener("online", cb);
      window.addEventListener("offline", cb);
      return () => {
        window.removeEventListener("online", cb);
        window.removeEventListener("offline", cb);
      };
    },
    () => navigator.onLine,
    () => true,
  );
}

const initials = (name: string) =>
  name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase())
    .join("") || "?";

export default function AppShell({
  children,
  nav,
  userName,
  roleKey,
  chrome,
  surface,
}: {
  children: React.ReactNode;
  nav: NavItem[];
  userName: string;
  roleKey: DictKey;
  /** Brand, banners and plan locks for this business (Phase 9). */
  chrome?: Chrome | null;
  /** "retailer" = the green, white-chrome surface. Everyone else uses the staff default (teal + saffron). */
  surface?: "retailer";
}) {
  const pathname = usePathname();
  const router = useRouter();
  const { t } = useLanguage();
  const current = activeHref(pathname, nav);
  const locked = useMemo(() => new Set(chrome?.locked ?? []), [chrome?.locked]);
  const sections = useMemo(() => sectionsOf(nav), [nav]);
  const tabs = useMemo(() => tabsOf(nav), [nav]);
  const hasMore = tabs.length < nav.length;
  const [sheetOpen, setSheetOpen] = useState(false);
  const online = useOnline();
  const [query, setQuery] = useState("");

  const currentItem = nav.find((i) => i.href === current);
  const currentGroup = currentItem?.group;
  const home = nav[0]?.href ?? "/";
  const role = t(roleKey);

  async function logout() {
    await fetch("/api/auth/logout", { method: "POST" });
    router.push("/login");
    router.refresh();
  }

  const q = query.trim().toLowerCase();
  const filtered = q
    ? sections
        .map((s) => ({ ...s, items: s.items.filter((i) => t(i.labelKey).toLowerCase().includes(q)) }))
        .filter((s) => s.items.length)
    : sections;

  return (
    <div className="app-shell min-h-screen md:flex" data-surface={surface}>
      {/* Tablet: icon rail. PC: full sidebar with sections. */}
      <aside
        className="app-side hidden md:flex sticky top-0 h-screen shrink-0 flex-col w-[76px] lg:w-[256px] text-white"
        aria-label={t("nav.menu")}
      >
        <Link href={home} className="flex items-center gap-2.5 h-16 px-[18px] lg:px-5 shrink-0" aria-label={chrome?.brand.appName ?? APP_NAME}>
          <SideBrand name={chrome?.brand.appName} logoUrl={chrome?.brand.logoUrl} onLight={surface === "retailer"} />
        </Link>

        {nav.length > 8 && (
          <label className="hidden lg:flex mx-3.5 mb-3 items-center gap-2 h-10 px-3 rounded-[10px] bg-white/[.08] text-white/75 text-[13.5px] focus-within:ring-2 focus-within:ring-[var(--genda)]">
            <Icon name="search" className="h-4 w-4 shrink-0" />
            <input
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Escape") setQuery("");
                if (e.key === "Enter") {
                  const first = filtered[0]?.items[0];
                  if (first) {
                    router.push(first.href);
                    setQuery("");
                  }
                }
              }}
              placeholder={t("nav.jumpTo")}
              aria-label={t("nav.jumpTo")}
              className="flex-1 min-w-0 bg-transparent text-white placeholder:text-white/70 outline-none"
            />
          </label>
        )}

        <nav className="flex-1 min-h-0 overflow-y-auto overscroll-contain px-3.5 pb-4 side-scroll" aria-label="Main">
          {filtered.map((s, idx) => (
            <div key={s.group ?? `s${idx}`} className={idx ? "mt-4 lg:mt-5" : undefined}>
              {s.group && (
                <>
                  <p className="hidden lg:block px-2.5 mb-1.5 text-[11px] font-bold uppercase tracking-[.08em] text-white/65">
                    {t(`nav.group.${s.group}` as DictKey)}
                  </p>
                  {idx > 0 && <hr className="lg:hidden mx-2 mb-4 border-white/10" />}
                </>
              )}
              <ul className="flex flex-col gap-0.5">
                {s.items.map((item) => (
                  <li key={item.href}>
                    <SideLink item={item} active={item.href === current} locked={locked.has(item.href)} />
                  </li>
                ))}
              </ul>
            </div>
          ))}
          {q && filtered.length === 0 && <p className="px-2.5 text-sm text-white/70">{t("nav.noMatch")}</p>}
        </nav>

        <div className="shrink-0 border-t border-white/10 p-3 flex flex-col lg:flex-row items-center gap-2">
          <span
            className="grid place-items-center h-10 w-10 shrink-0 rounded-full bg-white/10 text-[13px] font-bold"
            title={`${userName} · ${role}`}
            aria-hidden="true"
          >
            {initials(userName)}
          </span>
          <span className="hidden lg:block flex-1 min-w-0">
            <span className="block text-sm font-semibold truncate">{userName}</span>
            <span className="block text-xs text-white/70 truncate">{role}</span>
          </span>
          <Link
            href="/account/security"
            className="grid place-items-center h-10 w-10 shrink-0 rounded-[10px] text-white/80 hover:bg-white/10 hover:text-white transition"
            aria-label={t("sec.title")}
            title={t("sec.title")}
          >
            <Icon name="lock" className="h-[18px] w-[18px]" />
          </Link>
          <button
            type="button"
            onClick={logout}
            className="grid place-items-center h-10 w-10 shrink-0 rounded-[10px] text-white/80 hover:bg-white/10 hover:text-white transition"
            aria-label={t("common.logout")}
            title={t("common.logout")}
          >
            <Icon name="logout" className="h-[18px] w-[18px]" />
          </button>
        </div>
      </aside>

      <div className="flex-1 min-w-0 flex flex-col pb-[calc(76px+env(safe-area-inset-bottom))] md:pb-0">
        <header className="app-top sticky top-0 z-20">
          <div className="mx-auto w-full max-w-[1360px] h-16 px-4 md:px-6 lg:px-8 flex items-center gap-2 sm:gap-3">
            <Link href={home} className="md:hidden min-w-0" aria-label={role}>
              <BrandLockup sub={role} name={chrome?.brand.appName} logoUrl={chrome?.brand.logoUrl} size={34} />
            </Link>
            {currentItem && (
              <nav aria-label="Breadcrumb" className="hidden md:flex items-center gap-2 min-w-0 text-sm">
                {currentGroup && (
                  <>
                    <span className="text-[var(--muted)]">{t(`nav.group.${currentGroup}` as DictKey)}</span>
                    <span className="text-[var(--muted)]" aria-hidden="true">/</span>
                  </>
                )}
                <span className="font-semibold text-ink truncate">{t(currentItem.labelKey)}</span>
              </nav>
            )}
            <span className="flex-1" />
            <LanguageToggle />
            <Bell href={`${home}/notifications`} active={pathname.endsWith("/notifications")} />
            <button
              type="button"
              onClick={() => setSheetOpen(true)}
              className="md:hidden grid place-items-center h-10 w-10 shrink-0 rounded-full bg-[var(--accent-tint)] text-[var(--accent-text)] text-[13px] font-bold"
              aria-label={`${userName} · ${t("nav.menu")}`}
              aria-haspopup="dialog"
            >
              {initials(userName)}
            </button>
          </div>
        </header>

        {!online && (
          <p role="status" className="flex items-center justify-center gap-2 bg-[var(--ink)] text-white text-[13px] font-semibold px-4 py-2 text-center">
            <Icon name="alert" className="h-4 w-4 shrink-0" /> {t("shell.offline")}
          </p>
        )}
        <main key={pathname} className="page-in flex-1 w-full max-w-[1360px] mx-auto px-4 md:px-6 lg:px-8 py-5 md:py-7">
          {chrome ? (
            <ShellNotices chrome={chrome} isOffice={roleKey === "role.admin"}>
              {children}
            </ShellNotices>
          ) : (
            children
          )}
        </main>
      </div>

      {/* Phone: bottom bar */}
      <nav className="app-tabs md:hidden fixed bottom-0 inset-x-0 z-30 flex px-1.5 pt-1" aria-label="Main">
        {tabs.map((item) => (
          <TabLink key={item.href} item={item} active={item.href === current} locked={locked.has(item.href)} />
        ))}
        {hasMore && (
          <button
            type="button"
            onClick={() => setSheetOpen(true)}
            aria-haspopup="dialog"
            className={`tab-link ${current && !tabs.some((x) => x.href === current) ? "is-on" : ""}`}
          >
            <span className="tab-ic">
              <Icon name="menu" className="h-[22px] w-[22px]" weight="duotone" />
            </span>
            {t("nav.more")}
          </button>
        )}
      </nav>

      <ToastHost />
      {surface !== "retailer" && <TableKeys />}

      {sheetOpen && (
        <MenuSheet
          sections={sections}
          current={current}
          locked={locked}
          userName={userName}
          role={role}
          onClose={() => setSheetOpen(false)}
          onLogout={logout}
        />
      )}
    </div>
  );
}

/** Our logo for the dark sidebar, or the business's own (white label). */
function SideBrand({ name, logoUrl, onLight }: { name?: string; logoUrl?: string | null; onLight?: boolean }) {
  const own = !name || name === APP_NAME;
  if (own && !logoUrl) {
    return (
      <>
        <span className="lg:hidden">
          <BrandMark size={40} />
        </span>
        <span className="hidden lg:block">
          <Logo kind={onLight ? "wide" : "onDark"} height={30} priority />
        </span>
      </>
    );
  }
  return (
    <>
      {logoUrl ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={logoUrl} alt="" width={40} height={40} className="h-10 w-10 shrink-0 rounded-[10px] bg-white object-contain" />
      ) : (
        <BrandMark size={40} />
      )}
      <span className={`hidden lg:block font-heading font-bold text-[17px] leading-tight truncate ${onLight ? "text-ink" : ""}`}>{own ? APP_NAME : name}</span>
    </>
  );
}

function SideLink({ item, active, locked }: { item: NavItem; active: boolean; locked?: boolean }) {
  const { t } = useLanguage();
  const label = t(item.labelKey);
  return (
    <Link
      href={item.href}
      aria-current={active ? "page" : undefined}
      aria-label={locked ? `${label} (${t("shell.notInPlan")})` : undefined}
      title={`${label}${locked ? ` (${t("shell.notInPlan")})` : ""}`}
      className={`side-link ${active ? "is-on" : ""}`}
    >
      <Icon name={item.icon} className="side-ic" weight={active ? "fill" : "duotone"} />
      <span className="hidden lg:inline flex-1 truncate">{label}</span>
      {locked && <Icon name="lock" className="hidden lg:block h-3.5 w-3.5 opacity-60" />}
    </Link>
  );
}

function TabLink({ item, active, locked }: { item: NavItem; active: boolean; locked?: boolean }) {
  const { t } = useLanguage();
  return (
    <Link href={item.href} aria-current={active ? "page" : undefined} className={`tab-link ${active ? "is-on" : ""}`}>
      <span className="tab-ic">
        <Icon name={locked ? "lock" : item.icon} className="h-[22px] w-[22px]" weight={active ? "fill" : "duotone"} />
      </span>
      <span className="max-w-full truncate px-0.5">{t(item.labelKey)}</span>
    </Link>
  );
}

/** Phone: every section of the menu, the language switch and log out, in a sheet. */
function MenuSheet({
  sections,
  current,
  locked,
  userName,
  role,
  onClose,
  onLogout,
}: {
  sections: { group: NavGroup | null; items: NavItem[] }[];
  current: string | null;
  locked: Set<string>;
  userName: string;
  role: string;
  onClose: () => void;
  onLogout: () => void;
}) {
  const { t } = useLanguage();

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
    };
  }, [onClose]);

  return (
    <div className="md:hidden fixed inset-0 z-40" role="dialog" aria-modal="true" aria-label={t("nav.menu")}>
      <button type="button" className="absolute inset-0 bg-[rgba(8,38,37,.45)]" aria-label={t("nav.close")} onClick={onClose} />
      <div className="menu-sheet absolute inset-x-0 bottom-0 max-h-[88vh] flex flex-col rounded-t-[22px] bg-[var(--canvas)]">
        <div className="flex items-center gap-3 px-4 pt-4 pb-3 bg-white rounded-t-[22px] border-b border-[var(--line)]">
          <span className="grid place-items-center h-11 w-11 shrink-0 rounded-full bg-[var(--mint-tint)] text-[var(--mint-text)] text-sm font-bold" aria-hidden="true">
            {initials(userName)}
          </span>
          <span className="flex-1 min-w-0">
            <span className="block font-bold truncate">{userName}</span>
            <span className="block text-xs text-[var(--muted)] truncate">{role}</span>
          </span>
          <button type="button" onClick={onClose} className="grid place-items-center h-11 w-11 rounded-xl bg-ink/5" aria-label={t("nav.close")} autoFocus>
            <Icon name="x" className="h-5 w-5" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto overscroll-contain px-4 py-4 space-y-3">
          {sections.map((s, idx) => (
            <section key={s.group ?? `s${idx}`} className="rounded-2xl bg-white border border-[var(--line)] px-2 pt-2.5 pb-1.5">
              {s.group && (
                <h2 className="px-2 mb-1 text-[11px] font-bold uppercase tracking-[.08em] text-[var(--muted)]">{t(`nav.group.${s.group}` as DictKey)}</h2>
              )}
              <ul className="grid grid-cols-4 gap-0.5">
                {s.items.map((item) => {
                  const on = item.href === current;
                  const isLocked = locked.has(item.href);
                  return (
                    <li key={item.href}>
                      <Link
                        href={item.href}
                        onClick={onClose}
                        aria-current={on ? "page" : undefined}
                        className={`flex flex-col items-center justify-center gap-1.5 min-h-[76px] px-1 py-2 rounded-xl text-center text-[12px] font-semibold leading-tight ${
                          on ? "bg-[var(--accent-tint)] text-[var(--accent-text)]" : "text-ink active:bg-ink/5"
                        }`}
                      >
                        <span className={`grid place-items-center h-10 w-10 rounded-[11px] ${on ? "bg-white" : "bg-[var(--surface-2)] text-[var(--mor)]"}`}>
                          <Icon name={isLocked ? "lock" : item.icon} className="h-5 w-5" weight="duotone" />
                        </span>
                        {t(item.labelKey)}
                      </Link>
                    </li>
                  );
                })}
              </ul>
            </section>
          ))}

          <Link
            href="/account/security"
            className="w-full flex items-center justify-center gap-2 min-h-[48px] rounded-2xl bg-white border border-[var(--line)] font-semibold mb-2"
          >
            <Icon name="lock" className="h-5 w-5" />
            {t("sec.title")}
          </Link>
          <button
            type="button"
            onClick={onLogout}
            className="w-full flex items-center justify-center gap-2 min-h-[48px] rounded-2xl bg-white border border-[var(--line)] font-semibold text-[var(--risk-text)]"
          >
            <Icon name="logout" className="h-5 w-5" />
            {t("common.logout")}
          </button>
        </div>
      </div>
    </div>
  );
}

/** Header bell: unread count, refreshed every minute, on focus, on page change and after reading here. */
function Bell({ href, active }: { href: string; active: boolean }) {
  const { t } = useLanguage();
  const pathname = usePathname();
  const [count, setCount] = useState(0);

  useEffect(() => {
    let live = true;
    const load = async () => {
      try {
        const res = await fetch("/api/notifications/unread", { cache: "no-store" });
        const d = await res.json();
        if (live && typeof d.count === "number") setCount(d.count);
      } catch {
        // Offline: keep the last count.
      }
    };
    load();
    const timer = window.setInterval(() => {
      if (document.visibilityState === "visible") load();
    }, 60_000);
    window.addEventListener("focus", load);
    window.addEventListener(NOTIFY_EVENT, load);
    return () => {
      live = false;
      window.clearInterval(timer);
      window.removeEventListener("focus", load);
      window.removeEventListener(NOTIFY_EVENT, load);
    };
  }, [pathname]);

  const label = count ? `${t("nav.notifications")}: ${count} unread` : t("nav.notifications");
  return (
    <Link
      href={href}
      aria-label={label}
      title={label}
      aria-current={active ? "page" : undefined}
      className={`relative grid place-items-center h-10 w-10 shrink-0 rounded-xl transition ${
        active ? "bg-[var(--accent-tint)] text-[var(--accent-text)]" : "text-[var(--ink-2)] hover:bg-ink/5"
      }`}
    >
      <Icon name="bell" className="h-5 w-5" />
      {count > 0 && (
        <span className="absolute top-0.5 right-0.5 min-w-[18px] h-[18px] px-1 rounded-full bg-[var(--risk)] text-white text-[10.5px] font-bold leading-[18px] text-center">
          {count > 99 ? "99+" : count}
        </span>
      )}
    </Link>
  );
}
