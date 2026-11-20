/**
 * Search that works across Hindi and English spellings. Devanagari is turned
 * into rough Latin letters, then both sides are reduced to a loose "sound
 * key" (spelling variants like aa/a, ee/i, sh/s, ph/f, w/v collapse), so
 * "chai" finds "चाय", "biskut" finds "बिस्कुट" and "Parle" finds "पारले".
 * Runs on the client too (no dependencies).
 */

const VOWELS: Record<string, string> = {
  "अ": "a", "आ": "aa", "इ": "i", "ई": "ee", "उ": "u", "ऊ": "oo", "ऋ": "ri",
  "ए": "e", "ऐ": "ai", "ओ": "o", "औ": "au",
};
const MATRAS: Record<string, string> = {
  "ा": "aa", "ि": "i", "ी": "ee", "ु": "u", "ू": "oo", "ृ": "ri",
  "े": "e", "ै": "ai", "ो": "o", "ौ": "au",
};
const CONSONANTS: Record<string, string> = {
  "क": "k", "ख": "kh", "ग": "g", "घ": "gh", "ङ": "n",
  "च": "ch", "छ": "chh", "ज": "j", "झ": "jh", "ञ": "n",
  "ट": "t", "ठ": "th", "ड": "d", "ढ": "dh", "ण": "n",
  "त": "t", "थ": "th", "द": "d", "ध": "dh", "न": "n",
  "प": "p", "फ": "ph", "ब": "b", "भ": "bh", "म": "m",
  "य": "y", "र": "r", "ल": "l", "व": "v", "श": "sh", "ष": "sh", "स": "s", "ह": "h",
  "क़": "k", "ख़": "kh", "ग़": "g", "ज़": "z", "ड़": "d", "ढ़": "dh", "फ़": "f", "य़": "y",
};
const VIRAMA = "्";
const NUKTA = "़";
const MARKS: Record<string, string> = { "ं": "n", "ँ": "n", "ः": "h" };
const DIGITS = "०१२३४५६७८९";

/** Devanagari → rough Latin ("चाय" → "chaay"). Other text passes through. */
export function devanagariToLatin(input: string): string {
  let out = "";
  const s = input.normalize("NFC");
  for (let i = 0; i < s.length; i++) {
    let ch = s[i];
    if (s[i + 1] === NUKTA) {
      ch += NUKTA;
      i++;
    }
    const c = CONSONANTS[ch];
    if (c) {
      out += c;
      const next = s[i + 1];
      // Inherent "a" unless a matra, virama or the end of a word follows.
      if (next && !MATRAS[next] && next !== VIRAMA && /[ऀ-ॿ]/.test(next) && !MARKS[next]) out += "a";
      continue;
    }
    if (MATRAS[ch]) out += MATRAS[ch];
    else if (VOWELS[ch]) out += VOWELS[ch];
    else if (MARKS[ch]) out += MARKS[ch];
    else if (ch === VIRAMA) continue;
    else if (DIGITS.includes(ch)) out += String(DIGITS.indexOf(ch));
    else out += ch;
  }
  return out;
}

/** Plain lower-case Latin letters and digits. */
export function plainKey(s: string): string {
  return devanagariToLatin(s).toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

/** Loose sound key of one word: first letter kept, then consonants only, doubles collapsed. */
export function soundWord(w: string): string {
  const x = w
    .replace(/ph/g, "f")
    .replace(/w/g, "v")
    .replace(/z/g, "j")
    .replace(/q/g, "k")
    .replace(/ck/g, "k")
    .replace(/c(?!h)/g, "k")
    .replace(/sh/g, "s")
    .replace(/([kgcjtdpb])h/g, "$1");
  if (!x) return "";
  const head = /[aeiou]/.test(x[0]) ? "a" : x[0];
  const rest = x.slice(1).replace(/[aeiouyh]/g, "").replace(/(.)\1+/g, "$1");
  return (head + rest).replace(/(.)\1+/g, "$1");
}

export function soundKey(s: string): string {
  return plainKey(s).split(" ").filter(Boolean).map(soundWord).join(" ");
}

/** One string to search for a product: names, aliases, brand, category, SKU. */
export function searchText(parts: (string | null | undefined)[]): string {
  const raw = parts.filter(Boolean).join(" ");
  return `${plainKey(raw)} | ${soundKey(raw)}`;
}

/**
 * Does `text` (from searchText) match the query? Every query word must match,
 * either as typed or by sound (sound match needs 2+ letters of key).
 */
export function matches(text: string, query: string): boolean {
  const words = plainKey(query).split(" ").filter(Boolean);
  if (!words.length) return true;
  const [plain, sound] = text.split(" | ");
  return words.every((w) => {
    if (plain.includes(w)) return true;
    const k = soundWord(w);
    return k.length >= 2 && (sound ?? "").split(" ").some((t) => t.startsWith(k));
  });
}
