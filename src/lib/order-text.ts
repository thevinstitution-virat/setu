/**
 * A1: an order typed, pasted, spoken or sent on WhatsApp ("5 peti nimbu,
 * 2 jeera", "चाय 250 ग्राम 3 पैकेट और नमक 2") → lines with a product, a
 * quantity and units or cases. Plain rules, no AI (client-safe): the AI path
 * (lib/order-intake.ts) uses these candidates and falls back to them.
 *
 * - Lines are split on new lines, commas, "aur"/"and", and before a number
 *   that starts a new item ("5 peti nimbu 2 jeera").
 * - Quantities: digits, Hindi and English number words (do, teen, paanch,
 *   bees, dozen/darjan), halves (aadha, dedh, dhai).
 * - Units: cases (peti, carton, case, the product's own case name), pieces
 *   (packet, piece, bottle…), weight and volume (kilo, gram, litre, ml), which
 *   are turned into packs from the size in the product's name.
 * - Products: every word of what was said is compared with the product's
 *   names, Hindi name, aliases and brand, by spelling and by sound, with
 *   Hindi/English synonyms (chai = tea = चाय).
 */
import { plainKey, soundWord } from "@/lib/translit";
import { sameWords } from "@/lib/catalogue-rules";

export type OrderProduct = {
  id: string;
  name: string;
  unit: string;
  caseUnit: string | null;
  caseSize: number | null;
  /** searchText() of the product (plain | sound), as GET /api/catalogue gives it. */
  search: string;
};

export type Per = "unit" | "case";
export type Confidence = "high" | "medium" | "low";

export type ParsedLine = {
  /** The words this line came from. */
  said: string;
  productId: string | null;
  qty: number;
  per: Per;
  confidence: Confidence;
  /** Other likely products, best first (the chosen one excluded). */
  alternatives: string[];
  /** Something to check ("5 kg taken as 5 × 1 kg packs"). */
  note: string | null;
};

export const MAX_ORDER_QTY = 100_000;
export const MAX_ORDER_TEXT = 2000;

// ───────────────────────────── words ─────────────────────────────

const NUMBER_WORDS: Record<string, number> = {
  ek: 1, one: 1, do: 2, two: 2, teen: 3, three: 3, char: 4, chaar: 4, four: 4, paanch: 5, panch: 5, paach: 5, five: 5,
  chhe: 6, chhah: 6, chah: 6, chhai: 6, che: 6, six: 6, saat: 7, sat: 7, seven: 7, aath: 8, ath: 8, eight: 8, nau: 9, nine: 9,
  das: 10, dus: 10, ten: 10, gyarah: 11, gyaarah: 11, eleven: 11, barah: 12, baarah: 12, twelve: 12, pandrah: 15, pandraah: 15, fifteen: 15,
  bees: 20, bis: 20, twenty: 20, pachees: 25, pachchees: 25, pachchis: 25, tees: 30, thirty: 30, chalis: 40, chaalees: 40, chaalis: 40, forty: 40,
  pachaas: 50, pachas: 50, fifty: 50, sau: 100, hundred: 100,
};
const HALVES: Record<string, number> = { aadha: 0.5, adha: 0.5, aadhaa: 0.5, half: 0.5, dedh: 1.5, derh: 1.5, dhai: 2.5, dhaai: 2.5, adhai: 2.5 };

type UnitKind = "case" | "piece" | "weight" | "volume" | "dozen";
/** Unit word → kind and, for weight / volume, grams or millilitres in one. */
const UNIT_WORDS: Record<string, { kind: UnitKind; base?: number }> = {
  peti: { kind: "case" }, petti: { kind: "case" }, petee: { kind: "case" }, case: { kind: "case" }, cases: { kind: "case" },
  carton: { kind: "case" }, cartons: { kind: "case" }, cartoon: { kind: "case" }, ctn: { kind: "case" }, ctns: { kind: "case" }, khoka: { kind: "case" },
  box: { kind: "case" }, boxes: { kind: "case" }, dabba: { kind: "case" }, dibba: { kind: "case" }, bori: { kind: "case" }, katta: { kind: "case" },
  pc: { kind: "piece" }, pcs: { kind: "piece" }, piece: { kind: "piece" }, pieces: { kind: "piece" }, nag: { kind: "piece" }, unit: { kind: "piece" }, units: { kind: "piece" },
  packet: { kind: "piece" }, packets: { kind: "piece" }, paket: { kind: "piece" }, pkt: { kind: "piece" }, pkts: { kind: "piece" }, pack: { kind: "piece" }, packs: { kind: "piece" },
  paikat: { kind: "piece" }, paiket: { kind: "piece" }, bottle: { kind: "piece" }, bottles: { kind: "piece" }, botal: { kind: "piece" }, botall: { kind: "piece" },
  jar: { kind: "piece" }, jars: { kind: "piece" }, tube: { kind: "piece" }, tubes: { kind: "piece" }, can: { kind: "piece" }, cans: { kind: "piece" },
  pouch: { kind: "piece" }, sachet: { kind: "piece" }, tin: { kind: "piece" }, bag: { kind: "piece" }, bags: { kind: "piece" }, thaili: { kind: "piece" },
  dozen: { kind: "dozen" }, dozens: { kind: "dozen" }, darjan: { kind: "dozen" }, darjen: { kind: "dozen" }, dazan: { kind: "dozen" }, dajan: { kind: "dozen" },
  kg: { kind: "weight", base: 1000 }, kgs: { kind: "weight", base: 1000 }, kilo: { kind: "weight", base: 1000 }, kilos: { kind: "weight", base: 1000 }, killo: { kind: "weight", base: 1000 },
  kilogram: { kind: "weight", base: 1000 }, g: { kind: "weight", base: 1 }, gm: { kind: "weight", base: 1 }, gms: { kind: "weight", base: 1 }, gram: { kind: "weight", base: 1 },
  grams: { kind: "weight", base: 1 }, graam: { kind: "weight", base: 1 }, l: { kind: "volume", base: 1000 }, ltr: { kind: "volume", base: 1000 }, ltrs: { kind: "volume", base: 1000 },
  litre: { kind: "volume", base: 1000 }, liter: { kind: "volume", base: 1000 }, litres: { kind: "volume", base: 1000 }, leetar: { kind: "volume", base: 1000 }, litar: { kind: "volume", base: 1000 }, ml: { kind: "volume", base: 1 },
};
/** Spoken or Devanagari forms that plainKey gives for units ("पेटी" → "petee", "किलो" → "kilo"). */
const UNIT_ALIASES: Record<string, string> = { paiket: "packet", paikat: "packet", petee: "peti", botal: "bottle", leetar: "litre", graam: "gram", darjan: "dozen" };

/** Words that say nothing about the product ("bhej do", "chahiye", "please"). */
const FILLER = new Set([
  "bhej", "bhejo", "bhejna", "bhejiye", "bhejdo", "dena", "dedo", "dijiye", "dijie", "de", "chahiye", "chaahiye", "chaahie", "chahie", "chaiye", "please", "pls", "plz",
  "sir", "ji", "bhai", "bhaiya", "order", "send", "kar", "karo", "karna", "kardo", "wala", "wali", "wale", "vaala", "vaalee", "vaale", "ka", "ki", "ke", "ko", "bhi", "hi",
  "the", "of", "a", "an", "and", "aur", "or", "me", "mujhe", "hame", "hamein", "humko", "x", "nos", "no", "qty", "quantity", "aaj", "kal", "jaldi", "abhi", "ek", "sath",
  "saath", "ye", "yeh", "is", "us", "liye", "lie", "hai", "hain", "h", "to", "bhejiyega", "rakhna", "rakh", "lena", "lo", "dijiyega", "maal", "item", "items",
]);
// "ek" is both "one" and filler ("ek aur"): it counts as a number only before a product or unit.
FILLER.delete("ek");
const HINDI_DIGITS = /[०-९]/g;

/** "do" after "bhej"/"de"/"kar" is "give", not "two". */
const GIVE_BEFORE = new Set(["bhej", "de", "kar", "rakh", "le"]);

// ───────────────────────────── splitting ─────────────────────────────

const toLatin = (s: string) => plainKey(s.replace(HINDI_DIGITS, (d) => String("०१२३४५६७८९".indexOf(d))));

type Token = { w: string; num: number | null; unit: { kind: UnitKind; base?: number; word: string } | null; filler: boolean };

function tokenize(text: string): Token[] {
  // Keep decimals ("1.5 kilo") and split numbers from units ("250gm", "5kg", "2x").
  const s = toLatin(text.replace(/(\d)[.,](\d)/g, "$1d$2"))
    .replace(/(\d)d(\d)/g, "$1.$2")
    .replace(/(\d)([a-z])/g, "$1 $2")
    .replace(/([a-z])(\d)/g, "$1 $2");
  const raw = s.split(" ").filter(Boolean);
  const out: Token[] = [];
  for (let i = 0; i < raw.length; i++) {
    const w = raw[i];
    if (w === "do" && i > 0 && GIVE_BEFORE.has(raw[i - 1])) continue;
    // Devanagari comes through as long vowels ("डिब्बा" → "dibbaa", "पेटी" → "petee"): look up the short form too.
    const short = w.replace(/aa/g, "a").replace(/ee/g, "i").replace(/oo/g, "u");
    const n = /^\d+(\.\d+)?$/.test(w) ? Number(w) : (NUMBER_WORDS[w] ?? HALVES[w] ?? NUMBER_WORDS[short] ?? HALVES[short] ?? null);
    const key = UNIT_ALIASES[w] ?? (UNIT_WORDS[w] ? w : (UNIT_ALIASES[short] ?? short));
    const u = UNIT_WORDS[key];
    out.push({ w, num: n, unit: u ? { ...u, word: key } : null, filler: FILLER.has(w) || FILLER.has(short) });
  }
  return out;
}

/** Splits a message into item phrases. */
export function splitOrderText(text: string): string[] {
  const parts = text
    .slice(0, MAX_ORDER_TEXT)
    .replace(/\s+(?:aur|and|or|और|एवं|तथा)\s+/gi, "\n")
    .split(/[\n,;।|&+]+|\s-\s|\.(?=\s|$)/)
    .map((p) => p.trim())
    .filter(Boolean);
  const out: string[] = [];
  for (const p of parts) {
    // "5 peti nimbu 2 jeera": a bare number after product words starts a new item (only when the phrase opened with a number).
    const toks = p.split(/\s+/);
    let cur: string[] = [];
    let startsWithNumber = false;
    let sawWords = false;
    for (let i = 0; i < toks.length; i++) {
      const t = tokenize(toks[i])[0];
      const next = tokenize(toks.slice(i + 1, i + 2).join(" "))[0];
      const isNum = !!t && t.num !== null && !t.unit;
      const isSize = isNum && !!next?.unit && (next.unit.kind === "weight" || next.unit.kind === "volume") && sawWords;
      if (cur.length === 0) startsWithNumber = isNum;
      if (isNum && !isSize && startsWithNumber && sawWords) {
        out.push(cur.join(" "));
        cur = [];
        sawWords = false;
        startsWithNumber = true;
      }
      cur.push(toks[i]);
      if (t && t.num === null && !t.unit && !t.filler) sawWords = true;
    }
    if (cur.length) out.push(cur.join(" "));
  }
  return out.filter((p) => tokenize(p).some((t) => t.num === null && !t.unit && !t.filler));
}

// ───────────────────────────── one phrase ─────────────────────────────

export type Phrase = {
  said: string;
  /** How many (null = not said: 1). */
  qty: number | null;
  /** The unit said with the quantity. */
  unit: { kind: UnitKind; base?: number; word: string } | null;
  /** A pack size said with the product ("chai 250 g"), in g or ml. */
  size: { kind: "weight" | "volume"; amount: number } | null;
  /** The product words (fillers removed). */
  words: string[];
};

export function parsePhrase(said: string): Phrase {
  const toks = tokenize(said);
  let qty: number | null = null;
  let unit: Phrase["unit"] = null;
  let size: Phrase["size"] = null;
  const words: string[] = [];
  for (let i = 0; i < toks.length; i++) {
    const t = toks[i];
    const next = toks[i + 1];
    if (t.num !== null) {
      // A number with a weight / volume: the quantity when no other number is in the phrase ("cheeni 5 kilo"), else a pack size ("chai 250 g 3 packet").
      if (next?.unit && (next.unit.kind === "weight" || next.unit.kind === "volume")) {
        const amount = t.num * (next.unit.base ?? 1);
        const isQty = qty === null && !toks.some((x, j) => j !== i && x.num !== null);
        if (isQty) {
          qty = t.num;
          unit = next.unit;
        } else size = { kind: next.unit.kind, amount };
        i++;
        continue;
      }
      if (qty === null) {
        qty = t.num;
        if (next?.unit) {
          unit = next.unit;
          i++;
        }
      } else if (next?.unit && !unit) {
        unit = next.unit;
        i++;
      }
      continue;
    }
    if (t.unit) {
      if (!unit) unit = t.unit;
      continue;
    }
    if (!t.filler && t.w.length > 0) words.push(t.w);
  }
  return { said: said.trim(), qty, unit, size, words };
}

// ───────────────────────────── matching ─────────────────────────────

type Indexed = { p: OrderProduct; plain: string[]; sound: string[]; size: Phrase["size"] };

/** Pack size in a product name: "Salt 1kg" → 1000 g, "Oil 500 ml" → 500 ml. */
export function sizeOf(name: string): Phrase["size"] {
  const m = toLatin(name)
    .replace(/(\d)\s+(?=[a-z])/g, "$1")
    .match(/(\d+(?:\.\d+)?)(kg|kgs|kilo|g|gm|gms|gram|grams|l|ltr|litre|liter|ml)\b/);
  if (!m) return null;
  const u = UNIT_WORDS[m[2]];
  return u && (u.kind === "weight" || u.kind === "volume") ? { kind: u.kind, amount: Number(m[1]) * (u.base ?? 1) } : null;
}

const cache = new WeakMap<OrderProduct[], Indexed[]>();
function index(products: OrderProduct[]): Indexed[] {
  let ix = cache.get(products);
  if (!ix) {
    ix = products.map((p) => {
      const [plain = "", sound = ""] = p.search.split(" | ");
      return { p, plain: plain.split(" ").filter((w) => w && !/^\d+$/.test(w)), sound: sound.split(" ").filter(Boolean), size: sizeOf(p.name) };
    });
    cache.set(products, ix);
  }
  return ix;
}

function editDistance1(a: string, b: string) {
  if (Math.abs(a.length - b.length) > 1) return false;
  let i = 0;
  let j = 0;
  let diff = 0;
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) {
      i++;
      j++;
      continue;
    }
    if (++diff > 1) return false;
    if (a.length > b.length) i++;
    else if (b.length > a.length) j++;
    else {
      i++;
      j++;
    }
  }
  return diff + (a.length - i) + (b.length - j) <= 1;
}

/** How well one said word matches a product's words, 0–1. */
function wordScore(w: string, it: Indexed): number {
  let best = 0;
  const forms = [w, ...sameWords(w)];
  for (const f of forms) {
    const synonym = f !== w;
    const k = soundWord(f);
    for (const t of it.plain) {
      if (t === f) best = Math.max(best, synonym ? 0.9 : 1);
      else if (f.length >= 3 && t.startsWith(f)) best = Math.max(best, synonym ? 0.75 : 0.85);
      else if (t.length >= 4 && f.startsWith(t)) best = Math.max(best, 0.7);
    }
    if (k.length >= 2) {
      for (const t of it.sound) {
        if (t === k) best = Math.max(best, synonym ? 0.75 : 0.8);
        else if (k.length >= 3 && t.startsWith(k)) best = Math.max(best, 0.65);
        else if (k.length >= 3 && editDistance1(k, t)) best = Math.max(best, 0.55);
      }
    }
    if (best >= 1) break;
  }
  return best;
}

/** Products for the words said, best first, with a 0–1 score. */
export function matchProducts(words: string[], size: Phrase["size"], products: OrderProduct[], limit = 5): { id: string; score: number }[] {
  if (!words.length) return [];
  const out: { id: string; score: number }[] = [];
  for (const it of index(products)) {
    const scores = words.map((w) => wordScore(w, it));
    if (!scores.some((s) => s >= 0.75)) continue;
    let score = scores.reduce((a, s) => a + s, 0) / words.length;
    // Fewer extra words in the product's name is a closer match ("chai" → "Chai", not "Chai Masala Premium").
    score -= Math.min(0.1, Math.max(0, it.plain.length - words.length) * 0.02);
    if (size && it.size) score += it.size.kind === size.kind && Math.abs(it.size.amount - size.amount) < 0.5 ? 0.2 : -0.15;
    out.push({ id: it.p.id, score: Math.round(Math.max(0, Math.min(1.2, score)) * 100) / 100 });
  }
  return out.sort((a, b) => b.score - a.score).slice(0, limit);
}

/** The quantity said, as units or cases of one product. */
export function cartQty(ph: Pick<Phrase, "qty" | "unit">, p: OrderProduct): { qty: number; per: Per; note: string | null } {
  const n = ph.qty ?? 1;
  const u = ph.unit;
  const whole = (x: number) => Math.max(1, Math.min(MAX_ORDER_QTY, Math.ceil(x - 1e-9)));
  if (!u || u.kind === "piece") {
    if (u && p.caseUnit && plainKey(p.caseUnit) === u.word && p.caseSize) return { qty: whole(n), per: "case", note: null };
    return { qty: whole(n), per: "unit", note: n % 1 ? `${n} rounded up to ${whole(n)}` : null };
  }
  if (u.kind === "dozen") return { qty: whole(n * 12), per: "unit", note: null };
  if (u.kind === "case") {
    if (p.caseSize) return { qty: whole(n), per: "case", note: null };
    return { qty: whole(n), per: "unit", note: `No case size for this product: taken as ${whole(n)} ${p.unit}` };
  }
  // Weight or volume: packs of the size in the product's name.
  const size = sizeOf(p.name);
  const want = n * (u.base ?? 1);
  if (size && size.kind === u.kind) {
    const packs = whole(want / size.amount);
    const exact = Math.abs(packs * size.amount - want) < 0.5;
    return { qty: packs, per: "unit", note: exact ? (packs > 1 ? `${n} ${u.word} = ${packs} × ${fmtSize(size)}` : null) : `${n} ${u.word} rounded up to ${packs} × ${fmtSize(size)}` };
  }
  return { qty: whole(n), per: "unit", note: `Taken as ${whole(n)} ${p.unit}: check the quantity` };
}

const fmtSize = (s: NonNullable<Phrase["size"]>) =>
  s.kind === "weight" ? (s.amount >= 1000 ? `${s.amount / 1000} kg` : `${s.amount} g`) : s.amount >= 1000 ? `${s.amount / 1000} L` : `${s.amount} ml`;

/** Confidence from the best score and how far ahead of the next it is. */
export function confidenceOf(best: number, second: number | undefined): Confidence {
  if (best >= 0.85 && (second === undefined || best - second >= 0.1)) return "high";
  if (best >= 0.65) return "medium";
  return "low";
}

/** The whole message → lines (by the rules). */
export function parseOrderText(text: string, products: OrderProduct[]): ParsedLine[] {
  const byId = new Map(products.map((p) => [p.id, p]));
  const lines: ParsedLine[] = [];
  for (const said of splitOrderText(text)) {
    const ph = parsePhrase(said);
    // A weight said as the quantity can also be the pack size asked for ("5 kilo chawal" → the 5 kg bag).
    const sizeHint = ph.size ?? (ph.unit && (ph.unit.kind === "weight" || ph.unit.kind === "volume") && ph.qty !== null ? { kind: ph.unit.kind, amount: ph.qty * (ph.unit.base ?? 1) } : null);
    let m = matchProducts(ph.words, sizeHint, products);
    if (!ph.size && sizeHint && m.length) {
      // Only prefer an exact pack when one exists; otherwise match without the size.
      const exact = m.find((x) => {
        const s = sizeOf(byId.get(x.id)!.name);
        return s && s.kind === sizeHint.kind && Math.abs(s.amount - sizeHint.amount) < 0.5;
      });
      if (!exact) m = matchProducts(ph.words, null, products);
    }
    const best = m[0];
    if (!best || best.score < 0.5) {
      // No number and no product: a greeting or chatter ("Namaste bhaiya"), not an item.
      if (ph.qty === null && !m.length) continue;
      lines.push({ said, productId: null, qty: ph.qty ?? 1, per: "unit", confidence: "low", alternatives: m.map((x) => x.id), note: "Couldn't tell which product: pick one" });
      continue;
    }
    const p = byId.get(best.id)!;
    let q = cartQty(ph, p);
    const s = sizeOf(p.name);
    if (!ph.size && sizeHint && s && s.kind === sizeHint.kind && Math.abs(s.amount - sizeHint.amount) < 0.5) q = { qty: 1, per: "unit", note: null };
    lines.push({ said, productId: p.id, qty: q.qty, per: q.per, confidence: confidenceOf(best.score, m[1]?.score), alternatives: m.slice(1).map((x) => x.id), note: q.note });
  }
  return lines;
}
