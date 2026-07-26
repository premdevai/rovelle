import { z } from "zod";

/**
 * Rovelle Recipe Format v1
 *
 * This is the storage format, the export format, and the LLM output format.
 * They are deliberately the same object. If they ever diverge, "your cookbook
 * is yours forever" stops being true.
 *
 * Invariants enforced here:
 *   - qty may be null. Fabricating a number is worse than admitting we don't know.
 *   - step.text must be rewritten prose, never the creator's verbatim caption.
 *   - once meta.user_edited is true, no automated writer may touch the document.
 */

export const RRF_VERSION = "1.0" as const;

export const Unit = z.enum([
  "g", "kg", "ml", "l",
  "tsp", "tbsp", "cup",
  "oz", "lb",
  "piece", "clove", "head", "bunch", "handful", "pinch",
  "to_taste", "as_needed",
]);
export type Unit = z.infer<typeof Unit>;

export const Platform = z.enum(["instagram", "tiktok", "youtube", "manual", "pasted"]);
export type Platform = z.infer<typeof Platform>;

export const Ingredient = z.object({
  id: z.string(),
  name: z.string().min(1),
  /** null when the source never states an amount. Do not guess. */
  qty: z.number().positive().nullable(),
  unit: Unit.nullable(),
  note: z.string().nullable().default(null),
  /** "main" | "marinade" | "tadka" | "garnish" | "sauce" ... free-form component grouping */
  group: z.string().default("main"),
  optional: z.boolean().default(false),
  confidence: z.number().min(0).max(1).default(1),
});
export type Ingredient = z.infer<typeof Ingredient>;

export const Heat = z.enum(["low", "medium-low", "medium", "medium-high", "high"]);
export type Heat = z.infer<typeof Heat>;

export const Step = z.object({
  id: z.string(),
  /** Rewritten imperative instruction. Verbatim source text is a legal defect. */
  text: z.string().min(1),
  /** Drives the Cook Mode timer. null = no timer for this step. */
  duration_s: z.number().int().positive().nullable().default(null),
  temperature_c: z.number().nullable().default(null),
  ingredient_ids: z.array(z.string()).default([]),
  /** Offset into the source video, for "show me this bit" without re-hosting. */
  source_ts_s: z.number().nonnegative().nullable().default(null),
  confidence: z.number().min(0).max(1).default(1),

  // ——— added for voice guidance ————————————————————————————
  // These four exist because of what a cook actually asks mid-step, hands
  // full, phone across the counter: "what pan?", "how high?", "how do I know
  // it's ready?", "can I walk away?". A timer alone answers none of that.
  // All optional and defaulted, so v1.0 documents written before they existed
  // still parse unchanged.

  /** "heavy-bottomed pan", "kadai", "oven" — what it happens in. */
  vessel: z.string().nullable().default(null),
  /** Hob setting, when the source states one. Never inferred. */
  heat: Heat.nullable().default(null),
  /** The sensory test: "cumin stops sputtering", "edges pull from the pan". */
  doneness_cue: z.string().nullable().default(null),
  /** false = the pan is working and the cook is free. Drives "can I walk away?" */
  hands_on: z.boolean().default(true),
  /**
   * A real frame from the source video at `source_ts_s`, stored locally and
   * served from /api/media. Not a stock photo and not a generated image — the
   * actual pan at the actual moment this step describes. null when the video
   * gave us no frame to take.
   */
  image: z.string().nullable().default(null),
});
export type Step = z.infer<typeof Step>;

export const Phase = z.object({
  id: z.string(),
  /** "Prep" | "Cook" | "Tadka" | "Finish" | "Rest" — technique-accurate, not generic. */
  name: z.string().min(1),
  steps: z.array(Step).min(1),
});
export type Phase = z.infer<typeof Phase>;

export const Source = z.object({
  platform: Platform,
  url: z.string().url().nullable(),
  handle: z.string().nullable(),
  creator_name: z.string().nullable(),
  captured_at: z.string().datetime(),
  media_duration_s: z.number().nonnegative().nullable().default(null),
});

export const Note = z.object({
  id: z.string(),
  body: z.string().min(1),
  author: z.string().nullable().default(null),
  created_at: z.string().datetime(),
});
export type Note = z.infer<typeof Note>;

export const Recipe = z.object({
  rrf: z.literal(RRF_VERSION),
  id: z.string(),
  title: z.string().min(1),
  summary: z.string().default(""),
  cuisine: z.string().nullable().default(null),
  servings: z.object({
    amount: z.number().positive(),
    unit: z.string().default("portions"),
    scalable: z.boolean().default(true),
  }),
  time: z.object({
    prep_min: z.number().int().nonnegative().nullable().default(null),
    cook_min: z.number().int().nonnegative().nullable().default(null),
    total_min: z.number().int().nonnegative().nullable().default(null),
  }),
  difficulty: z.enum(["easy", "medium", "involved"]).default("easy"),
  source: Source,
  ingredients: z.array(Ingredient),
  tools: z.array(z.string()).default([]),
  phases: z.array(Phase).min(1),
  storage: z.string().nullable().default(null),
  /** The creator's own thumbnail URL. Hotlinked, never re-hosted (PRD §9). */
  image: z.string().nullable().default(null),
  notes: z.array(Note).default([]),
  meta: z.object({
    cooked_count: z.number().int().nonnegative().default(0),
    last_cooked_at: z.string().datetime().nullable().default(null),
    user_edited: z.boolean().default(false),
    extraction_model: z.string().nullable().default(null),
    extraction_version: z.string().nullable().default(null),
  }),
});
export type Recipe = z.infer<typeof Recipe>;

/** What the LLM is allowed to return — no meta, no ids we didn't ask for. */
export const ExtractionDraft = Recipe.omit({ id: true, meta: true }).extend({
  rrf: z.literal(RRF_VERSION),
});
export type ExtractionDraft = z.infer<typeof ExtractionDraft>;

// ——— helpers ———————————————————————————————————————————————

export const REVIEW_THRESHOLD = 0.75;

/** Fields the review screen must flag rather than silently accept. */
export function fieldsNeedingReview(r: Recipe) {
  return {
    ingredients: r.ingredients.filter((i) => i.confidence < REVIEW_THRESHOLD).map((i) => i.id),
    steps: r.phases
      .flatMap((p) => p.steps)
      .filter((s) => s.confidence < REVIEW_THRESHOLD || (s.temperature_c !== null && s.confidence < 0.9))
      .map((s) => s.id),
  };
}

export function allSteps(r: Recipe): Array<Step & { phaseName: string; index: number }> {
  let i = 0;
  return r.phases.flatMap((p) =>
    p.steps.map((s) => ({ ...s, phaseName: p.name, index: i++ })),
  );
}

/**
 * Kitchen fractions. Nobody measures 0.33 of a cup — they reach for the third.
 * Anything that isn't a common cooking fraction falls back to a decimal.
 */
const FRACTIONS: Array<[number, string]> = [
  [0.25, "¼"], [1 / 3, "⅓"], [0.5, "½"], [2 / 3, "⅔"], [0.75, "¾"],
  [0.125, "⅛"], [0.375, "⅜"], [0.625, "⅝"], [0.875, "⅞"],
];

export function formatNumber(n: number): string {
  if (Number.isInteger(n)) return String(n);
  const whole = Math.floor(n);
  const frac = n - whole;
  // Match on two decimal places exactly rather than within a tolerance. A
  // tolerance wide enough to catch 0.33 → ⅓ is also wide enough to nudge a
  // stated 2.37 into 2⅜, and displaying an amount the source never gave is
  // the same sin as fabricating one.
  const cents = Math.round(frac * 100);
  const match = FRACTIONS.find(([v]) => Math.round(v * 100) === cents);
  if (match) return whole ? `${whole}${match[1]}` : match[1];
  return String(Math.round(n * 100) / 100);
}

/** Display a quantity. Mono font, tabular numerals, honest about nulls. */
export function formatQty(i: Ingredient): string {
  if (i.unit === "to_taste") return "to taste";
  if (i.unit === "as_needed") return "as needed";
  if (i.qty === null) return "—";
  const n = formatNumber(i.qty);
  return i.unit ? `${n} ${i.unit}` : n;
}

/**
 * A blank step with every field present.
 *
 * Exists so that adding a field to Step is a one-line change here rather than
 * a hunt through every place that builds one — which is exactly what adding
 * vessel/heat/doneness_cue/hands_on would otherwise have been.
 */
export function newStep(partial: Partial<Step> & { id: string; text: string }): Step {
  return {
    duration_s: null,
    temperature_c: null,
    ingredient_ids: [],
    source_ts_s: null,
    confidence: 1,
    vessel: null,
    heat: null,
    doneness_cue: null,
    hands_on: true,
    image: null,
    ...partial,
  };
}

/** A 30-second tadka is not "1 min". Below a minute, say seconds. */
export function formatDuration(seconds: number | null): string | null {
  if (seconds === null) return null;
  if (seconds < 60) return `${seconds} sec`;
  if (seconds < 3600) return `${Math.round(seconds / 60)} min`;
  const h = Math.floor(seconds / 3600);
  const m = Math.round((seconds % 3600) / 60);
  return m ? `${h} hr ${m} min` : `${h} hr`;
}

/** Portion scaling. Never scales to_taste / as_needed. */
export function scale(r: Recipe, targetServings: number): Recipe {
  const factor = targetServings / r.servings.amount;
  return {
    ...r,
    servings: { ...r.servings, amount: targetServings },
    ingredients: r.ingredients.map((i) =>
      i.qty === null || i.unit === "to_taste" || i.unit === "as_needed"
        ? i
        : { ...i, qty: Math.round(i.qty * factor * 100) / 100 },
    ),
  };
}

/** Export is stringify. No transform, no lossy path. */
export function toExportJSON(r: Recipe): string {
  return JSON.stringify(Recipe.parse(r), null, 2);
}
