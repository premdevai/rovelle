import { cookies } from "next/headers";
import { en, type Dictionary, type StringKey } from "./strings";
import { makeT, type T } from "./client";
import { LOCALES, DEFAULT_LOCALE, isLocale, type Locale } from "./locales";

/**
 * UI internationalisation, Indian languages first.
 *
 * Two separate things share the word "language" in this product and they are
 * deliberately not the same setting:
 *
 *   - THIS: the app's own words — buttons, labels, errors. One per user,
 *     stored in a cookie. Loaded on the server, passed down as a dictionary.
 *   - lib/i18n.ts translateRecipe: the recipe's words. One per recipe per
 *     language, cached in the database.
 *
 * A Tamil speaker cooking an Italian recipe wants the buttons in Tamil and
 * may well want the recipe in English. Conflating them would make that
 * impossible.
 *
 * ponytail: no i18n library. A flat key→string record and a `t()` closure is
 * the whole feature. Plurals are handled by writing both forms as separate
 * keys where it matters, which for ~150 strings is less code than a plural
 * engine and reads better in Tamil and Hindi anyway.
 */

const dictionaries: Partial<Record<Locale, Dictionary>> = { en };

async function load(locale: Locale): Promise<Dictionary> {
  if (dictionaries[locale]) return dictionaries[locale]!;
  try {
    const mod = (await import(`./generated/${locale}.json`)) as { default: Partial<Dictionary> };
    // Fall back key-by-key, so a locale that's missing a newly-added string
    // shows English for that one line rather than crashing the page.
    const merged = { ...en, ...mod.default } as Dictionary;
    dictionaries[locale] = merged;
    return merged;
  } catch {
    return en;
  }
}

export async function getLocale(): Promise<Locale> {
  const raw = (await cookies()).get("rovelle_locale")?.value;
  return raw && isLocale(raw) ? raw : DEFAULT_LOCALE;
}

/** Server-side. Returns the dictionary and a `t` for the current user. */
export async function getT(): Promise<{ t: T; locale: Locale; dict: Dictionary }> {
  const locale = await getLocale();
  const dict = await load(locale);
  return { t: makeT(dict), locale, dict };
}

// makeT lives in ./client so that importing it from a client component does
// not pull `next/headers` along with it.
export { makeT };
export type { T };
export { LOCALES, DEFAULT_LOCALE, isLocale };
export type { Locale, Dictionary, StringKey };
