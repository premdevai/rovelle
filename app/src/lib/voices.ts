/**
 * Bulbul v3 speakers.
 *
 * Ordered by Sarvam's published Critical Error Rate — the share of words with
 * a critical pronunciation error. A voice that mispronounces "haldi" or turns
 * "tsp" into something else is worse than useless in a kitchen, where the cook
 * is listening rather than reading, so the reliable ones come first and the
 * default is the most reliable rather than the most familiar.
 *
 * Every speaker works in every language Bulbul supports — the voice and the
 * language are independent choices. A Tamil speaker can pick a male voice; a
 * Hindi speaker can pick Priya. Coupling them, which the first pass did by
 * hardcoding `shubh`, made the voice a hidden consequence of the language.
 */

export type Voice = {
  id: string;
  label: string;
  gender: "male" | "female";
  /** Sarvam's measured critical error rate, as a percentage. Lower is better. */
  cer: number;
  tier: 1 | 2 | 3;
};

export const VOICES: Voice[] = [
  // Tier 1 — Sarvam's production recommendations.
  { id: "mani", label: "Mani", gender: "male", cer: 0.0, tier: 1 },
  { id: "varun", label: "Varun", gender: "male", cer: 0.06, tier: 1 },
  { id: "priya", label: "Priya", gender: "female", cer: 0.13, tier: 1 },
  { id: "ishita", label: "Ishita", gender: "female", cer: 0.13, tier: 1 },

  // Tier 2 — good, and `shubh` is Bulbul's own default.
  { id: "roopa", label: "Roopa", gender: "female", cer: 0.26, tier: 2 },
  { id: "shubh", label: "Shubh", gender: "male", cer: 0.3, tier: 2 },
  { id: "pooja", label: "Pooja", gender: "female", cer: 0.3, tier: 2 },
  { id: "sunny", label: "Sunny", gender: "male", cer: 0.33, tier: 2 },

  // Tier 3 — unmeasured, offered for range.
  { id: "aditya", label: "Aditya", gender: "male", cer: 1, tier: 3 },
  { id: "rahul", label: "Rahul", gender: "male", cer: 1, tier: 3 },
  { id: "rohan", label: "Rohan", gender: "male", cer: 1, tier: 3 },
  { id: "kabir", label: "Kabir", gender: "male", cer: 1, tier: 3 },
  { id: "dev", label: "Dev", gender: "male", cer: 1, tier: 3 },
  { id: "anand", label: "Anand", gender: "male", cer: 1, tier: 3 },
  { id: "gokul", label: "Gokul", gender: "male", cer: 1, tier: 3 },
  { id: "neha", label: "Neha", gender: "female", cer: 1, tier: 3 },
  { id: "kavya", label: "Kavya", gender: "female", cer: 1, tier: 3 },
  { id: "shreya", label: "Shreya", gender: "female", cer: 1, tier: 3 },
  { id: "ritu", label: "Ritu", gender: "female", cer: 1, tier: 3 },
  { id: "simran", label: "Simran", gender: "female", cer: 1, tier: 3 },
  { id: "tanya", label: "Tanya", gender: "female", cer: 1, tier: 3 },
  { id: "suhani", label: "Suhani", gender: "female", cer: 1, tier: 3 },
  { id: "kavitha", label: "Kavitha", gender: "female", cer: 1, tier: 3 },
  { id: "rupali", label: "Rupali", gender: "female", cer: 1, tier: 3 },
];

/**
 * The lowest measured error rate of any voice. Not `shubh`, which is Bulbul's
 * default but only Tier 2 — in a kitchen, accuracy beats familiarity.
 */
export const DEFAULT_VOICE = "mani";

/** Speaker names are case-sensitive and must be lowercase. */
export function isVoice(id: string): boolean {
  return VOICES.some((v) => v.id === id);
}

export function voiceOr(id: string | null | undefined): string {
  return id && isVoice(id) ? id : DEFAULT_VOICE;
}

/** Grouped for a picker: the reliable ones first, clearly marked. */
export const VOICE_GROUPS = [
  { label: "Recommended", voices: VOICES.filter((v) => v.tier === 1) },
  { label: "Good", voices: VOICES.filter((v) => v.tier === 2) },
  { label: "More voices", voices: VOICES.filter((v) => v.tier === 3) },
];
