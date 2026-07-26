/**
 * The languages Rovelle speaks.
 *
 * Indian languages plus English, matching Sarvam's coverage. `native` is what
 * shows in the picker — a Tamil speaker looks for "தமிழ்", not "Tamil".
 *
 * No server imports in this file: client components need the list to render
 * a picker, and pulling in the database or the Sarvam client would drag
 * node:sqlite into the browser bundle.
 */

export const LOCALES = [
  { code: "en", sarvam: "en-IN", native: "English", english: "English" },
  { code: "hi", sarvam: "hi-IN", native: "हिन्दी", english: "Hindi" },
  { code: "bn", sarvam: "bn-IN", native: "বাংলা", english: "Bengali" },
  { code: "ta", sarvam: "ta-IN", native: "தமிழ்", english: "Tamil" },
  { code: "te", sarvam: "te-IN", native: "తెలుగు", english: "Telugu" },
  { code: "mr", sarvam: "mr-IN", native: "मराठी", english: "Marathi" },
  { code: "gu", sarvam: "gu-IN", native: "ગુજરાતી", english: "Gujarati" },
  { code: "kn", sarvam: "kn-IN", native: "ಕನ್ನಡ", english: "Kannada" },
  { code: "ml", sarvam: "ml-IN", native: "മലയാളം", english: "Malayalam" },
  { code: "pa", sarvam: "pa-IN", native: "ਪੰਜਾਬੀ", english: "Punjabi" },
  { code: "od", sarvam: "od-IN", native: "ଓଡ଼ିଆ", english: "Odia" },
  { code: "ur", sarvam: "ur-IN", native: "اردو", english: "Urdu" },
  { code: "as", sarvam: "as-IN", native: "অসমীয়া", english: "Assamese" },
] as const;

export type Locale = (typeof LOCALES)[number]["code"];
export type SarvamLanguage = (typeof LOCALES)[number]["sarvam"];

export const DEFAULT_LOCALE: Locale = "en";

export function isLocale(code: string): code is Locale {
  return LOCALES.some((l) => l.code === code);
}

/** Urdu is the one right-to-left script in the set. */
export const RTL_LOCALES: Locale[] = ["ur"];
export const isRtl = (locale: Locale) => RTL_LOCALES.includes(locale);

export function sarvamCodeFor(locale: Locale): string {
  return LOCALES.find((l) => l.code === locale)?.sarvam ?? "en-IN";
}

export function localeForSarvam(code: string): Locale {
  return LOCALES.find((l) => l.sarvam === code)?.code ?? DEFAULT_LOCALE;
}
