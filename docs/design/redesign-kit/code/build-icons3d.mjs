// Re-export 3D icons from source PNGs (Gemini, transparent, any size >= 1024).
// Usage: node scripts/build-icons3d.mjs <folder-with-pngs> [name ...]
// Writes public/icons3d/{name}.webp (512) and {name}-2x.webp (1024), trimmed and re-centred at 84% fill, each <= 40 KB where possible.
// Needs `sharp` (ships with Next.js; otherwise `npm i -D sharp`).
import sharp from "sharp";
import { readdir, mkdir } from "node:fs/promises";
import path from "node:path";

const [src, ...only] = process.argv.slice(2);
if (!src) { console.error("usage: node scripts/build-icons3d.mjs <png-folder> [name ...]"); process.exit(1); }
const out = "public/icons3d";
await mkdir(out, { recursive: true });

const files = (await readdir(src)).filter((f) => f.endsWith(".png") && (!only.length || only.includes(f.replace(/\.png$/, ""))));
for (const f of files) {
  const name = f.replace(/\.png$/, "");
  const trimmed = await sharp(path.join(src, f)).ensureAlpha().trim({ threshold: 6 }).toBuffer({ resolveWithObject: true });
  const { width, height } = trimmed.info;
  const side = Math.round(Math.max(width, height) / 0.84);
  const square = await sharp(trimmed.data)
    .extend({
      top: Math.floor((side - height) / 2), bottom: Math.ceil((side - height) / 2),
      left: Math.floor((side - width) / 2), right: Math.ceil((side - width) / 2),
      background: { r: 0, g: 0, b: 0, alpha: 0 },
    })
    .png().toBuffer();
  for (const [px, suffix] of [[512, ""], [1024, "-2x"]]) {
    let q = 82, buf;
    do {
      buf = await sharp(square).resize(px, px, { kernel: "lanczos3" }).webp({ quality: q, alphaQuality: 90, effort: 6 }).toBuffer();
      q -= 6;
    } while (buf.length > 40 * 1024 && q >= 40);
    await sharp(buf).toFile(path.join(out, `${name}${suffix}.webp`));
    console.log(`${name}${suffix}.webp  ${(buf.length / 1024).toFixed(1)} KB  q${q + 6}`);
  }
}
