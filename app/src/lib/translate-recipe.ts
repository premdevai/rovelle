import { db, nowISO } from "./db";
import { translate, mode } from "./sarvam";
import type { Recipe } from "./rrf";

/**
 * Render a recipe in the cook's language.
 *
 * This is the point of using Sarvam at all: the creator filmed the reel in
 * Tamil or Bhojpuri, and the cook reading it lives somewhere else. Extraction
 * gives us structure; this gives everyone else access to it.
 *
 * Only human-readable strings move. Quantities, units, ids, and timings are
 * data and stay exactly as they are — translating "250" would be absurd, and
 * translating "tbsp" would break the unit enum.
 */

// The recipe's language is a Sarvam BCP-47 code, and the list lives with the
// UI locales so there is exactly one table of languages in the codebase.
export { LOCALES, sarvamCodeFor } from "./i18n/locales";

const SARVAM_CODES = new Set([
  "en-IN", "hi-IN", "bn-IN", "ta-IN", "te-IN", "mr-IN",
  "gu-IN", "kn-IN", "ml-IN", "pa-IN", "od-IN", "ur-IN", "as-IN",
]);

export function isLanguage(code: string): boolean {
  return SARVAM_CODES.has(code);
}

export async function translateRecipe(recipe: Recipe, target: string): Promise<Recipe> {
  if (target === "en-IN" || mode("translate") === "mock") return recipe;

  const cached = db()
    .prepare("SELECT rrf FROM translations WHERE recipe_id = ? AND language = ?")
    .get(recipe.id, target) as { rrf: string } | undefined;
  if (cached) return JSON.parse(cached.rrf) as Recipe;

  // Collect every translatable string in one ordered list, translate in
  // batches, then put them back where they came from. One pass, no per-field
  // round trips.
  const strings: string[] = [
    recipe.title,
    recipe.summary,
    ...recipe.ingredients.flatMap((i) => [i.name, i.note ?? ""]),
    ...recipe.phases.flatMap((p) => [p.name, ...p.steps.map((s) => s.text)]),
    recipe.storage ?? "",
  ];

  const out = await translateBatch(strings, target);
  let n = 0;
  const take = () => out[n++] ?? strings[n - 1];

  const translated: Recipe = {
    ...recipe,
    title: take(),
    summary: take(),
    ingredients: recipe.ingredients.map((i) => {
      const name = take();
      const note = take();
      return { ...i, name, note: i.note === null ? null : note };
    }),
    phases: recipe.phases.map((p) => ({
      ...p,
      name: take(),
      steps: p.steps.map((s) => ({ ...s, text: take() })),
    })),
    storage: recipe.storage === null ? null : take(),
  };

  db()
    .prepare(
      `INSERT INTO translations (recipe_id, language, rrf, created_at) VALUES (?, ?, ?, ?)
       ON CONFLICT(recipe_id, language) DO UPDATE SET rrf = excluded.rrf`,
    )
    .run(recipe.id, target, JSON.stringify(translated), nowISO());

  return translated;
}

/**
 * Batches strings into numbered blocks so one API call covers many fields.
 *
 * ponytail: numbered lines rather than a delimiter, because a translation
 * model will happily eat a "@@" and never touch a "3.". If the line count
 * still comes back wrong the batch falls back to one call per string — slower
 * and pricier, but it cannot silently shift every ingredient by one, which is
 * the failure mode that would put turmeric in the note field.
 */
async function translateBatch(strings: string[], target: string): Promise<string[]> {
  const result: string[] = new Array(strings.length).fill("");
  const CHUNK_CHARS = 1200;

  let batch: number[] = [];
  let size = 0;

  const flush = async () => {
    if (!batch.length) return;
    const payload = batch.map((i, n) => `${n + 1}. ${strings[i]}`).join("\n");
    let lines: string[] = [];
    try {
      const translated = await translate(payload, target);
      lines = translated
        .split("\n")
        .map((l) => l.replace(/^\s*\d+[.)]\s*/, "").trim())
        .filter((l) => l.length > 0);
    } catch {
      lines = [];
    }

    if (lines.length === batch.length) {
      batch.forEach((i, n) => (result[i] = lines[n]));
    } else {
      for (const i of batch) {
        try {
          result[i] = strings[i] ? await translate(strings[i], target) : "";
        } catch {
          result[i] = strings[i];
        }
      }
    }
    batch = [];
    size = 0;
  };

  for (let i = 0; i < strings.length; i++) {
    if (!strings[i]) {
      result[i] = "";
      continue;
    }
    if (size + strings[i].length > CHUNK_CHARS) await flush();
    batch.push(i);
    size += strings[i].length + 4;
  }
  await flush();

  return result.map((r, i) => r || strings[i]);
}
