import type { Metadata, Viewport } from "next";
import { Geist_Mono, Poppins, Manrope, Anek_Devanagari } from "next/font/google";
import "./globals.css";
import { APP_NAME } from "@/lib/brand";
import { currentBrand } from "@/lib/branding-server";
import { appNameOf, themeColour, themeCss, themeVars } from "@/lib/branding";
import { LanguageProvider } from "@/lib/i18n/LanguageProvider";
import { getServerLang } from "@/lib/i18n/server";

/* Poppins: headings, big money figures, banners. Manrope: everything else. */
const poppins = Poppins({
  variable: "--font-heading",
  subsets: ["latin"],
  weight: ["500", "600", "700", "800"],
});

const manrope = Manrope({
  variable: "--font-body",
  subsets: ["latin"],
  weight: ["400", "500", "600", "700", "800"],
});

const anekDevanagari = Anek_Devanagari({
  variable: "--font-deva",
  subsets: ["devanagari"],
  weight: ["400", "500", "600", "700", "800"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

/** Per business (white-label): its app name, icon and theme colour; ours on the platform address. */
export async function generateMetadata(): Promise<Metadata> {
  const { tenant, brand } = await currentBrand();
  const name = appNameOf(brand, tenant?.name);
  const hasIcon = !!(brand.iconKey || brand.logoKey);
  return {
    title: tenant ? name : `${APP_NAME} — Retailer to Delivery, one app`,
    description: tenant
      ? `Order, deliver and pay with ${name}.`
      : "One connected app for retailer ordering, sales field activity and delivery — replacing three separate apps with one lucid workflow.",
    manifest: "/manifest.webmanifest",
    icons: hasIcon ? { icon: [{ url: "/brand/icon/32", sizes: "32x32" }, { url: "/brand/icon/192", sizes: "192x192" }], apple: "/brand/icon/180" } : undefined,
    appleWebApp: {
      capable: true,
      statusBarStyle: "default",
      title: name,
    },
  };
}

export async function generateViewport(): Promise<Viewport> {
  const { brand } = await currentBrand();
  return {
    themeColor: themeColour(brand),
    width: "device-width",
    initialScale: 1,
    maximumScale: 1,
  };
}

export default async function RootLayout({ children }: LayoutProps<"/">) {
  const lang = await getServerLang();
  const { brand } = await currentBrand();
  // Only #rrggbb values reach this (lib/branding.ts), so it can't break out of the style tag.
  const base = themeCss(brand);
  // The retailer surface is green, but a white-label business colour wins there too
  // (it has to come after the surface rules, hence the extra specificity).
  const tenantAccent = themeVars(brand)["--kesar"]
    ? `html [data-surface="retailer"]{--accent:var(--kesar-mid);--accent-hover:var(--kesar-dark);--accent-text:var(--accent-text);--accent-tint:var(--accent-tint);--chrome-highlight:var(--kesar-mid)}`
    : "";
  const theme = base + tenantAccent;
  return (
    <html
      lang={lang}
      className={`${poppins.variable} ${manrope.variable} ${anekDevanagari.variable} ${geistMono.variable} h-full antialiased`}
      suppressHydrationWarning
    >
      {theme && (
        <head>
          <style id="tenant-theme" dangerouslySetInnerHTML={{ __html: theme }} />
        </head>
      )}
      <body className="min-h-full flex flex-col bg-background text-foreground">
        <LanguageProvider initialLang={lang}>{children}</LanguageProvider>
        <script
          dangerouslySetInnerHTML={{
            __html: `if ('serviceWorker' in navigator) { window.addEventListener('load', () => { navigator.serviceWorker.register('/sw.js').catch(() => {}); }); }`,
          }}
        />
      </body>
    </html>
  );
}
