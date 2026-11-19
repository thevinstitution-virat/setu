/**
 * A13 catalogue assist: the plain rules (no AI, client-safe). Used when AI
 * isn't available, and to tidy product sheets before an import.
 *
 * - hindiName(): common shop words from a word list, sizes and units in
 *   Hindi, everything else spelt out in Devanagari by sound (rough: check it).
 * - hsnByKeyword(): a short built-in list of common grocery and FMCG HSN
 *   codes with the GST rate in force from 22 Sep 2025. A starting point the
 *   owner confirms; the business's own HSN table always decides the rate.
 * - tidyProductRows(): spaces, ALL CAPS names, units ("250GM" → "250 g"),
 *   GST "18%" → "18", HSN digits only, category names matched to existing
 *   ones, and likely duplicates (in the sheet and in the catalogue).
 */
import { soundKey } from "@/lib/translit";

// ---------- Hindi names ----------

const WORDS: Record<string, string> = {
  tea: "चाय", chai: "चाय", coffee: "कॉफ़ी", sugar: "चीनी", salt: "नमक", namak: "नमक", oil: "तेल", tel: "तेल",
  rice: "चावल", chawal: "चावल", flour: "आटा", atta: "आटा", wheat: "गेहूं", maida: "मैदा", besan: "बेसन", suji: "सूजी", sooji: "सूजी", rava: "रवा",
  dal: "दाल", daal: "दाल", pulses: "दालें", moong: "मूंग", masoor: "मसूर", chana: "चना", toor: "तूर", arhar: "अरहर", urad: "उड़द", rajma: "राजमा",
  milk: "दूध", ghee: "घी", butter: "मक्खन", paneer: "पनीर", curd: "दही", cheese: "चीज़",
  biscuit: "बिस्कुट", biscuits: "बिस्कुट", cookies: "कुकीज़", bread: "ब्रेड", rusk: "रस्क", namkeen: "नमकीन", bhujia: "भुजिया", chips: "चिप्स",
  chocolate: "चॉकलेट", toffee: "टॉफ़ी", noodles: "नूडल्स", pasta: "पास्ता", ketchup: "केचप", sauce: "सॉस", jam: "जैम", pickle: "अचार", achar: "अचार", papad: "पापड़",
  masala: "मसाला", spices: "मसाले", turmeric: "हल्दी", haldi: "हल्दी", chilli: "मिर्च", chili: "मिर्च", mirch: "मिर्च", red: "लाल", green: "हरी", black: "काली",
  pepper: "काली मिर्च", coriander: "धनिया", dhania: "धनिया", dhaniya: "धनिया", cumin: "जीरा", jeera: "जीरा", mustard: "सरसों", sarson: "सरसों", garam: "गरम",
  lemon: "नींबू", nimbu: "नींबू", ginger: "अदरक", garlic: "लहसुन", onion: "प्याज़", cardamom: "इलायची", elaichi: "इलायची", clove: "लौंग",
  water: "पानी", juice: "जूस", drink: "ड्रिंक", soda: "सोडा",
  soap: "साबुन", detergent: "डिटर्जेंट", powder: "पाउडर", shampoo: "शैम्पू", toothpaste: "टूथपेस्ट", toothbrush: "टूथब्रश", cream: "क्रीम", hair: "बालों का",
  agarbatti: "अगरबत्ती", incense: "अगरबत्ती", candle: "मोमबत्ती", candles: "मोमबत्ती", matchbox: "माचिस", matches: "माचिस",
  groundnut: "मूंगफली", peanut: "मूंगफली", sunflower: "सूरजमुखी", soybean: "सोयाबीन", coconut: "नारियल", refined: "रिफ़ाइंड",
  cashew: "काजू", kaju: "काजू", almond: "बादाम", almonds: "बादाम", badam: "बादाम", raisins: "किशमिश", kishmish: "किशमिश",
  premium: "प्रीमियम", special: "स्पेशल", gold: "गोल्ड", classic: "क्लासिक", fresh: "फ़्रेश", pure: "शुद्ध", desi: "देसी", family: "फ़ैमिली", pack: "पैक",
};

const UNITS: [RegExp, string][] = [
  [/^(g|gm|gms|gram|grams)$/, "ग्राम"],
  [/^(kg|kgs|kilo|kilogram)$/, "किलो"],
  [/^(ml|mls)$/, "मिली"],
  [/^(l|ltr|ltrs|litre|liter|litres)$/, "लीटर"],
  [/^(pc|pcs|piece|pieces)$/, "पीस"],
  [/^(pkt|packet)$/, "पैकेट"],
];

const V_IND: Record<string, string> = { aa: "आ", a: "अ", ee: "ई", ea: "ई", i: "इ", oo: "ऊ", u: "उ", ai: "ऐ", ay: "ए", e: "ए", au: "औ", ou: "औ", o: "ओ" };
const V_MATRA: Record<string, string> = { aa: "ा", a: "", ee: "ी", ea: "ी", i: "ि", oo: "ू", u: "ु", ai: "ै", ay: "े", e: "े", au: "ौ", ou: "ौ", o: "ो" };
const CONS: [string, string][] = [
  ["chh", "छ"], ["kh", "ख"], ["gh", "घ"], ["ch", "च"], ["jh", "झ"], ["th", "थ"], ["dh", "ध"], ["ph", "फ"], ["bh", "भ"], ["sh", "श"],
  ["ck", "क"], ["b", "ब"], ["c", "क"], ["d", "ड"], ["f", "फ"], ["g", "ग"], ["h", "ह"], ["j", "ज"], ["k", "क"], ["l", "ल"], ["m", "म"], ["n", "न"],
  ["p", "प"], ["q", "क"], ["r", "र"], ["s", "स"], ["t", "ट"], ["v", "व"], ["w", "व"], ["x", "क्स"], ["z", "ज़"],
];
const VOWEL_KEYS = Object.keys(V_IND).sort((a, b) => b.length - a.length);
const VIRAMA = "्";

/** A Latin word spelt in Devanagari by sound ("Parle" → "पर्ले"). Rough: proper names need a check. */
export function latinToDevanagari(word: string): string {
  // A doubled last letter is said once ("Fizz", "Mill").
  const w = word.toLowerCase().replace(/[^a-z]/g, "").replace(/([b-df-hj-np-tv-z])\1$/, "$1");
  let out = "";
  let i = 0;
  let afterCons = false;
  while (i < w.length) {
    const v = VOWEL_KEYS.find((k) => w.startsWith(k, i));
    if (v) {
      // A final "e" after a consonant is usually silent in English spellings.
      if (v === "e" && i === w.length - 1 && afterCons && w.length > 3) {
        i += 1;
        continue;
      }
      out += afterCons ? V_MATRA[v] : V_IND[v];
      afterCons = false;
      i += v.length;
      continue;
    }
    if (w[i] === "y") {
      if (afterCons && i === w.length - 1) {
        out += "ी";
        afterCons = false;
        i += 1;
        continue;
      }
      if (afterCons) out += VIRAMA;
      out += "य";
      afterCons = true;
      i += 1;
      continue;
    }
    const c = CONS.find(([k]) => w.startsWith(k, i));
    if (!c) {
      i += 1;
      continue;
    }
    if (afterCons) out += VIRAMA;
    out += c[1];
    afterCons = true;
    i += c[0].length;
  }
  return out;
}

/** Hindi name by the rules: known words translated, sizes in Hindi units, the rest spelt by sound. */
export function hindiName(name: string): string {
  const tokens = name
    .replace(/(\d)([a-zA-Z])/g, "$1 $2")
    .split(/[\s/,]+/)
    .filter(Boolean);
  return tokens
    .map((t) => {
      const parts = t.split("-");
      return parts
        .map((p) => {
          const low = p.toLowerCase().replace(/[^a-z0-9.]/g, "");
          if (!low) return p;
          if (/^[\d.]+$/.test(low)) return low;
          const unit = UNITS.find(([re]) => re.test(low));
          if (unit) return unit[1];
          if (WORDS[low]) return WORDS[low];
          return latinToDevanagari(low) || p;
        })
        .join("-");
    })
    .join(" ");
}

// ---------- HSN ----------

export type HsnHint = { hsn: string; gstRate: number; label: string };

/** Common grocery and FMCG codes, GST rates from 22 Sep 2025 (first match wins: more specific first). */
const BUILTIN_HSN: { words: string[]; hint: HsnHint }[] = [
  { words: ["instant coffee"], hint: { hsn: "2101", gstRate: 5, label: "Instant coffee" } },
  { words: ["coffee"], hint: { hsn: "0901", gstRate: 5, label: "Coffee" } },
  { words: ["tea", "chai"], hint: { hsn: "0902", gstRate: 5, label: "Tea" } },
  { words: ["sugar", "cheeni", "chini"], hint: { hsn: "1701", gstRate: 5, label: "Sugar" } },
  { words: ["salt", "namak"], hint: { hsn: "2501", gstRate: 0, label: "Salt" } },
  { words: ["atta", "flour", "maida", "besan", "suji", "sooji", "rava"], hint: { hsn: "1101", gstRate: 5, label: "Flour (packed)" } },
  { words: ["rice", "chawal", "basmati"], hint: { hsn: "1006", gstRate: 5, label: "Rice (packed)" } },
  { words: ["dal", "daal", "moong", "masoor", "chana", "toor", "arhar", "urad", "rajma"], hint: { hsn: "0713", gstRate: 5, label: "Pulses (packed)" } },
  { words: ["mustard oil", "sarson oil", "sarson tel"], hint: { hsn: "1514", gstRate: 5, label: "Mustard oil" } },
  { words: ["sunflower oil"], hint: { hsn: "1512", gstRate: 5, label: "Sunflower oil" } },
  { words: ["groundnut oil", "peanut oil"], hint: { hsn: "1508", gstRate: 5, label: "Groundnut oil" } },
  { words: ["soybean oil", "soya oil"], hint: { hsn: "1507", gstRate: 5, label: "Soybean oil" } },
  { words: ["coconut oil"], hint: { hsn: "1513", gstRate: 5, label: "Coconut oil" } },
  { words: ["hair oil"], hint: { hsn: "3305", gstRate: 5, label: "Hair oil" } },
  { words: ["ghee", "butter"], hint: { hsn: "0405", gstRate: 5, label: "Ghee and butter" } },
  { words: ["biscuit", "biscuits", "cookies", "rusk"], hint: { hsn: "1905", gstRate: 5, label: "Biscuits" } },
  { words: ["namkeen", "bhujia", "mixture"], hint: { hsn: "2106", gstRate: 5, label: "Namkeen" } },
  { words: ["chocolate"], hint: { hsn: "1806", gstRate: 5, label: "Chocolate" } },
  { words: ["noodles", "pasta", "vermicelli"], hint: { hsn: "1902", gstRate: 5, label: "Noodles and pasta" } },
  { words: ["ketchup", "sauce"], hint: { hsn: "2103", gstRate: 5, label: "Sauces" } },
  { words: ["jam"], hint: { hsn: "2007", gstRate: 5, label: "Jam" } },
  { words: ["turmeric", "haldi"], hint: { hsn: "0910", gstRate: 5, label: "Turmeric" } },
  { words: ["chilli", "chili", "mirch"], hint: { hsn: "0904", gstRate: 5, label: "Chilli" } },
  { words: ["coriander", "dhania", "dhaniya", "cumin", "jeera"], hint: { hsn: "0909", gstRate: 5, label: "Coriander and cumin" } },
  { words: ["masala", "spices"], hint: { hsn: "0910", gstRate: 5, label: "Spice mixes" } },
  { words: ["mineral water", "drinking water", "water"], hint: { hsn: "2201", gstRate: 5, label: "Packaged water" } },
  { words: ["juice"], hint: { hsn: "2009", gstRate: 5, label: "Fruit juice" } },
  { words: ["cola", "soft drink", "soda", "aerated"], hint: { hsn: "2202", gstRate: 40, label: "Aerated drinks" } },
  { words: ["soap"], hint: { hsn: "3401", gstRate: 5, label: "Toilet soap" } },
  { words: ["shampoo"], hint: { hsn: "3305", gstRate: 5, label: "Shampoo" } },
  { words: ["toothpaste"], hint: { hsn: "3306", gstRate: 5, label: "Toothpaste" } },
  { words: ["toothbrush"], hint: { hsn: "9603", gstRate: 5, label: "Toothbrush" } },
  { words: ["detergent", "washing powder"], hint: { hsn: "3402", gstRate: 18, label: "Detergent" } },
  { words: ["agarbatti", "incense"], hint: { hsn: "3307", gstRate: 5, label: "Agarbatti" } },
  { words: ["candle", "candles"], hint: { hsn: "3406", gstRate: 5, label: "Candles" } },
  { words: ["matchbox", "matches", "machis"], hint: { hsn: "3605", gstRate: 5, label: "Matches" } },
];

const words = (s: string) => ` ${s.toLowerCase().replace(/[^a-z]+/g, " ").trim()} `;

/** First built-in code whose words appear in the product's name (or category). */
export function hsnByKeyword(name: string, category = ""): HsnHint | null {
  for (const text of [words(name), words(category)]) {
    for (const e of BUILTIN_HSN) if (e.words.some((w) => text.includes(` ${w} `))) return e.hint;
  }
  return null;
}

/** The code most used by the business's own products in the same category (none when two codes tie). */
export function hsnFromCategory(siblings: { hsnCode: string | null; gstRate: number }[]): { hsn: string; gstRate: number; count: number } | null {
  const count = new Map<string, { n: number; rate: number }>();
  for (const s of siblings) {
    if (!s.hsnCode) continue;
    const c = count.get(s.hsnCode);
    count.set(s.hsnCode, { n: (c?.n ?? 0) + 1, rate: s.gstRate });
  }
  let best: { hsn: string; gstRate: number; count: number } | null = null;
  let tie = false;
  for (const [hsn, c] of count) {
    if (!best || c.n > best.count) {
      best = { hsn, gstRate: c.rate, count: c.n };
      tie = false;
    } else if (c.n === best.count) tie = true;
  }
  return tie ? null : best;
}

// ---------- tidying a product sheet ----------

export type SheetRow = Record<string, string>;
export type TidyChange = { row: number; field: string; from: string; to: string };
export type TidyDuplicate = { row: number; name: string; kind: "sheet" | "catalogue"; with: string };

const UNIT_TIDY: [RegExp, string][] = [
  [/(\d+(?:\.\d+)?)\s*(?:gms?|grams?|g)\b/gi, "$1 g"],
  [/(\d+(?:\.\d+)?)\s*(?:kgs?|kilos?)\b/gi, "$1 kg"],
  [/(\d+(?:\.\d+)?)\s*(?:mls?)\b/gi, "$1 ml"],
  [/(\d+(?:\.\d+)?)\s*(?:ltrs?|litres?|liters?|l)\b/gi, "$1 L"],
];

const titleCase = (s: string) => s.toLowerCase().replace(/(^|[\s(-])([a-z])/g, (_, a: string, b: string) => a + b.toUpperCase());

/** "MASALA  CHAI 250GM" → "Masala Chai 250 g". Mixed-case names only get spaces and units fixed. */
export function tidyName(raw: string): string {
  let s = raw.replace(/\s+/g, " ").trim();
  const letters = s.replace(/[^A-Za-z]/g, "");
  if (letters.length >= 4 && letters === letters.toUpperCase()) s = titleCase(s);
  for (const [re, by] of UNIT_TIDY) s = s.replace(re, by);
  return s.replace(/\s+/g, " ").trim();
}

/** Key for spotting the same product: tidied, sizes written together ("250 g" = "250g" = "250GM"), by sound. */
const nameKey = (name: string) => soundKey(tidyName(name).replace(/(\d)\s+(?=[a-z])/gi, "$1"));

/**
 * Tidies product sheet rows (normalised headers, as importers.parseSheet
 * gives them) before they are checked and imported. Returns new rows and
 * what changed; flags likely duplicates without removing them.
 */
export function tidyProductRows(rows: SheetRow[], existing: { products: { name: string; sku: string }[]; categories: string[] }) {
  const changes: TidyChange[] = [];
  const duplicates: TidyDuplicate[] = [];
  const catByKey = new Map(existing.categories.map((c) => [soundKey(c), c]));
  const prodByKey = new Map(existing.products.map((p) => [nameKey(p.name), p]));
  const seen = new Map<string, number>();
  const out = rows.map((r, i) => {
    const row = i + 2;
    const n: SheetRow = { ...r };
    const set = (field: string, to: string) => {
      const from = r[field] ?? "";
      if (from !== to) {
        changes.push({ row, field, from, to });
        n[field] = to;
      }
    };
    for (const k of Object.keys(n)) if (typeof n[k] === "string" && n[k] !== n[k].trim()) n[k] = n[k].trim();
    if (n.name) set("name", tidyName(n.name));
    if (n.gst_rate) set("gst_rate", n.gst_rate.replace(/\s|%/g, ""));
    if (n.hsn_code) set("hsn_code", n.hsn_code.replace(/\D/g, ""));
    if (n.price) set("price", n.price.replace(/[₹,\s]|rs\.?/gi, ""));
    if (n.mrp) set("mrp", n.mrp.replace(/[₹,\s]|rs\.?/gi, ""));
    if (n.unit) set("unit", n.unit.toLowerCase().replace(/\s+/g, " "));
    if (n.sku) set("sku", n.sku.replace(/\s+/g, "").toUpperCase());
    if (n.category) {
      const match = catByKey.get(soundKey(n.category));
      if (match && match !== n.category) set("category", match);
    }
    if (n.name) {
      const key = nameKey(n.name);
      if (seen.has(key)) duplicates.push({ row, name: n.name, kind: "sheet", with: `row ${seen.get(key)}` });
      else seen.set(key, row);
      const existingMatch = prodByKey.get(key);
      if (existingMatch && existingMatch.sku.toUpperCase() !== (n.sku ?? "").toUpperCase()) duplicates.push({ row, name: n.name, kind: "catalogue", with: `${existingMatch.name} (${existingMatch.sku})` });
    }
    return n;
  });
  return { rows: out, changes, duplicates };
}
