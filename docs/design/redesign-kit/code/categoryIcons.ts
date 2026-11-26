import type { Icon3DName } from "@/lib/ui/icons3d";

// Ordered: more specific phrases first ("cream biscuit" before "biscuit", "liquid detergent" before "detergent").
const RULES: [Icon3DName, string[]][] = [
  ["detergent", ["detergent powder","washing powder","detergent bar","डिटर्जेंट","सर्फ"]],
  ["detergent-liquid", ["liquid detergent","fabric","laundry","लिक्विड"]],
  ["cream-biscuits", ["cream biscuit","sandwich biscuit","क्रीम बिस्कुट"]],
  ["ice-cream", ["ice cream","icecream","frozen dessert","kulfi","आइसक्रीम"]],
  ["jam", ["jam","spread","honey","peanut butter","जैम","शहद"]],
  ["frozen-snacks", ["frozen","ready to cook","ready-to-cook","फ्रोज़न"]],
  ["health-drink", ["health drink","malt","nutrition","हेल्थ"]],
  ["conditioner", ["conditioner","कंडीशनर"]],
  // Bare "तेल" / "oil" is ambiguous, so hair oil needs its own words; cooking oil and ghee are staples.
  ["hair-oil", ["hair oil","coconut oil","बालों का तेल","केश"]],
  // No cooking-oil render yet: the staples icon stands in (switch to "cooking-oil" once that icon exists).
  ["atta", ["cooking oil","edible oil","mustard oil","sunflower oil","refined oil","groundnut oil","ghee","सरसों","घी","खाद्य तेल"]],
  ["soap", ["soap","साबुन","bath bar","beauty bar"]],
  ["body-wash", ["body wash","shower gel","बॉडी वॉश"]],
  ["deo", ["deo","deodorant","perfume","body spray","डियो"]],
  ["toothpaste", ["toothpaste","oral","toothbrush","tooth","टूथपेस्ट","दंत","मंजन"]],
  ["chocolate", ["chocolate","confection","candy","toffee","चॉकलेट","टॉफ़ी"]],
  ["noodles", ["noodle","pasta","vermicelli","नूडल"]],
  ["ketchup", ["ketchup","sauce","mayonnaise","dip","सॉस","केचप"]],
  ["juice", ["juice","beverage","drink","soft drink","cold drink","जूस","पेय"]],
  ["notebooks", ["notebook","stationery","pen","school","कॉपी","स्टेशनरी"]],
  ["shampoo", ["shampoo","शैम्पू","hair wash"]],
  ["face-wash", ["face wash","facewash","फेस वॉश"]],
  ["dishwash", ["dishwash","dish wash","utensil","बर्तन"]],
  ["floor-cleaner", ["floor","toilet","surface","household","cleaner","फ़र्श","फर्श","सफ़ाई","सफाई"]],
  ["handwash", ["handwash","hand wash","sanitiser","sanitizer","हैंडवॉश"]],
  ["agarbatti", ["agarbatti","incense","pooja","puja","dhoop","अगरबत्ती","पूजा"]],
  ["skin-cream", ["cream","lotion","skin","moisturi","talc","क्रीम","त्वचा"]],
  ["biscuits", ["biscuit","cookie","rusk","बिस्कुट"]],
  ["atta", ["atta","flour","rice","dal","pulse","staple","grocery","आटा","चावल","दाल"]],
  ["chips", ["chips","snack","namkeen","wafer","नमकीन","चिप्स"]],
  ["spices", ["spice","masala","chilli","salt","मसाला","मसाले","नमक"]],
  ["coffee", ["coffee","कॉफ़ी","कॉफी"]],
  ["baby-care", ["baby","diaper","infant","बेबी","शिशु"]],
  ["matches", ["match","माचिस"]],
  ["tea", ["tea","chai","चाय"]],
];

const cache = new Map<string, Icon3DName>();

/** Maps any distributor's category name (English, Hindi or mixed) to a 3D icon. Falls back to "box-sealed". */
export function categoryIcon(name: string | null | undefined): Icon3DName {
  const key = (name ?? "").toLowerCase().normalize("NFC").trim();
  if (!key) return "box-sealed";
  const hit = cache.get(key);
  if (hit) return hit;
  let best: Icon3DName = "box-sealed";
  let bestLen = 0;
  for (const [icon, words] of RULES) {
    for (const w of words) {
      if (w.length > bestLen && key.includes(w)) { best = icon; bestLen = w.length; }
    }
  }
  cache.set(key, best);
  return best;
}
