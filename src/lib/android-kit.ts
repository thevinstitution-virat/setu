import { appNameOf, parseBrand, shortNameOf, themeColour, DEFAULT_COLOURS } from "@/lib/branding";
import { platformDomain } from "@/lib/tenant";

/**
 * Per-tenant Android build settings (Phase 9, premium plans with the
 * "android" module). One codebase: the Capacitor wrapper (planned, not in
 * this repo yet — roadmap "web first, Android after") loads the tenant's own
 * address, so only these values differ per build:
 *
 *   appId (package name), appName, server URL, theme / splash colours, icon.
 *
 * scripts/android-config.ts writes capacitor.config.json + a resources note
 * from this for one tenant; the console shows it too.
 */

export type AndroidKit = {
  appId: string;
  appName: string;
  shortName: string;
  serverUrl: string;
  themeColor: string;
  splashBackground: string;
  iconUrl: string | null;
  capacitorConfig: Record<string, unknown>;
};

/** Android package names: letters, digits and underscores per segment, segments starting with a letter. */
export function packageId(slug: string, prefix = process.env.ANDROID_APP_ID_PREFIX || "in.sellerssetu.app") {
  const seg = slug.toLowerCase().replace(/[^a-z0-9]/g, "_").replace(/^([^a-z])/, "t$1").replace(/_+/g, "_");
  return `${prefix}.${seg}`;
}

export function androidKit(t: { slug: string; name: string; brand: unknown }, customHost?: string | null): AndroidKit {
  const brand = parseBrand(t.brand);
  const domain = platformDomain();
  const host = customHost || `${t.slug}.${domain}`;
  const serverUrl = `https://${host}`;
  const appName = appNameOf(brand, t.name);
  const themeColor = themeColour(brand);
  const splashBackground = brand.surface ?? DEFAULT_COLOURS.surface;
  const appId = packageId(t.slug);
  return {
    appId,
    appName,
    shortName: shortNameOf(brand, t.name),
    serverUrl,
    themeColor,
    splashBackground,
    iconUrl: brand.iconKey || brand.logoKey ? `${serverUrl}/brand/icon/512` : null,
    capacitorConfig: {
      appId,
      appName,
      webDir: "public",
      server: { url: serverUrl, cleartext: false, androidScheme: "https" },
      android: { backgroundColor: splashBackground },
      plugins: {
        SplashScreen: { backgroundColor: splashBackground, showSpinner: false, launchShowDuration: 800 },
        StatusBar: { backgroundColor: themeColor, style: "DARK" },
      },
    },
  };
}
