/**
 * Write the Android build settings for one tenant (premium, "android" module).
 *
 *   npm run android:config -- --slug agarwal [--out android-builds/agarwal]
 *
 * Writes capacitor.config.json and BUILD.md (package id, app name, colours,
 * where to fetch the 512 px icon) into the folder. The Capacitor wrapper
 * itself is a later step (docs/PHASE9.md).
 */
import "dotenv/config";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { asPlatform } from "../src/lib/db";
import { androidKit } from "../src/lib/android-kit";
import { entitlements } from "../src/lib/plans";
import { prisma } from "../src/lib/prisma";

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i > -1 ? process.argv[i + 1] : undefined;
}

function fail(msg: string): never {
  console.error(`✖ ${msg}`);
  process.exit(1);
}

async function main() {
  const slug = (arg("slug") ?? "").toLowerCase();
  if (!slug) fail("--slug is required");
  const t = await asPlatform((tx) =>
    tx.tenant.findUnique({ where: { slug }, select: { id: true, slug: true, name: true, brand: true, domains: { where: { verifiedAt: { not: null } }, select: { host: true }, take: 1 } } })
  );
  if (!t) fail(`No tenant "${slug}"`);
  const e = await entitlements(t.id);
  if (!e.features.has("android")) console.warn(`! "${slug}" is on ${e.planName}, which has no own Android app. Writing the settings anyway.`);

  const kit = androidKit(t, t.domains[0]?.host ?? null);
  const out = arg("out") ?? path.join("android-builds", slug);
  await mkdir(out, { recursive: true });
  await writeFile(path.join(out, "capacitor.config.json"), JSON.stringify(kit.capacitorConfig, null, 2) + "\n");
  await writeFile(
    path.join(out, "BUILD.md"),
    [
      `# ${kit.appName} (Android)`,
      "",
      `- Package id: \`${kit.appId}\``,
      `- App name: ${kit.appName} (launcher: ${kit.shortName})`,
      `- Loads: ${kit.serverUrl}`,
      `- Theme colour: ${kit.themeColor} · splash background: ${kit.splashBackground}`,
      `- Icon (512 px): ${kit.iconUrl ?? "none uploaded; the default icon is used"}`,
      "",
      "Steps: copy capacitor.config.json into the wrapper project, put the icon",
      "through the Android asset tool, set the version, build a signed release.",
      "",
    ].join("\n")
  );
  console.log(`✔ Wrote ${out}/capacitor.config.json and BUILD.md for ${kit.appId}`);
}

main()
  .catch((e) => fail(e instanceof Error ? e.message : String(e)))
  .finally(() => prisma.$disconnect());
