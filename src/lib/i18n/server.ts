import { cookies } from "next/headers";
import { dictionary, type DictKey, type Lang } from "./dictionary";

export const LANG_COOKIE = "setu-lang";

export async function getServerLang(): Promise<Lang> {
  const store = await cookies();
  const v = store.get(LANG_COOKIE)?.value;
  return v === "hi" ? "hi" : "en";
}

export function tr(key: DictKey, lang: Lang): string {
  return dictionary[key]?.[lang] ?? key;
}
