import { allSteps, formatDuration, formatNumber, formatQty, scale, type Recipe } from "./rrf";
import { chat, chatStream, mode } from "./sarvam";

/**
 * "Talk live to the recipe."
 *
 * Hands are covered in dough and the phone is across the counter, so the cook
 * asks out loud: "how much turmeric?" Whatever language they ask in, Saaras
 * turns it into English text upstream; this turns it into an answer; Bulbul
 * says it back.
 *
 * The answer must be grounded in the recipe. A cooking assistant that
 * improvises a quantity is the same PRD R5 failure as an extractor that
 * fabricates one — so the deterministic path answers only from the document,
 * and the model path is told the same thing in the strongest terms available.
 */

export type Answer = { text: string; grounded: boolean; jumpToStep?: number };

export async function answer(
  recipe: Recipe,
  question: string,
  stepIndex: number,
  onDelta?: (chunk: string) => void,
): Promise<Answer> {
  const local = answerLocally(recipe, question, stepIndex);
  // A direct hit from the document beats a model paraphrase of the document,
  // and costs nothing. Only fall through when the lookup genuinely missed.
  if (local) return local;
  if (mode("extract") === "mock") return { text: lastResort(recipe, question), grounded: true };
  return answerWithSarvam(recipe, question, stepIndex, onDelta);
}

// ——— deterministic ————————————————————————————————————————

const NEXT = /\b(next|after this|then what|move on|carry on)\b/i;
const REPEAT = /\b(repeat|again|what did you say|current step|what now|what am i doing|where (?:am i|was i)|read (?:that|it))\b/i;
const BACK = /\b(back|previous|last step|before this)\b/i;
const HOW_LONG = /\b(how long|how many (?:minutes|seconds|hours)|timer|how much (?:longer|time))\b/i;
const HOW_HOT = /\b(how hot|what temperature|temp\b|degrees|how high|what heat|gas mark)\b/i;
const HOW_MUCH = /\bhow (?:much|many)\b/i;
const LIST = /\b(ingredients?|what do i need|shopping|what goes in)\b/i;
const SERVES = /\b(serves|servings?|how many people|portions|feed)\b/i;
const REMAINING = /\b(how many steps|steps? (?:left|to go|remaining)|how far|almost done|nearly there)\b/i;
const SUBSTITUTE = /\b(instead of|substitute|swap|replace|can i use|don'?t have|out of|alternative)\b/i;
const DONE_WHEN = /\b(how (?:do|will) i know|is it (?:done|ready|cooked)|when is it (?:done|ready)|what should it look like|doneness|ready yet)\b/i;
const VESSEL = /\b(what (?:pan|pot|vessel|dish)|what do i (?:cook|do) (?:it|this) in|which (?:pan|pot)|what tools?|equipment)\b/i;
const WALK_AWAY = /\b(walk away|leave it|can i go|hands? free|do i need to (?:watch|stir)|attention)\b/i;
const TOTAL_TIME = /\b(whole thing|total time|start to finish|altogether|how long (?:does|will) (?:this|it|the recipe))\b/i;
const STORAGE = /\b(store|storage|leftovers?|fridge|freeze|keep(?:s)? for|how long (?:does|will) it (?:keep|last))\b/i;
const MY_NOTES = /\b(my note|notes?\b|what did i write|did i write)\b/i;
const WHAT_IS_THIS = /\b(what (?:am i (?:making|cooking)|is this|are we making)|what recipe|which recipe)\b/i;
const HAS = /\b(is there|does it (?:have|contain)|any\b|do i need\b|does this (?:have|contain))\b/i;
const SCALE_FOR = /\bfor (\d+)\s*(?:people|persons?|portions?|servings?|of us)\b/i;
const DOUBLE = /\b(double|twice)\b/i;
const HALVE = /\b(half|halve)\b/i;

export function answerLocally(recipe: Recipe, question: string, stepIndex: number): Answer | null {
  const q = question.trim();
  if (!q) return null;
  const steps = allSteps(recipe);
  // A recipe with no steps cannot reach Cook Mode, but a malformed import
  // reaching this function must not take the whole answerer down with it.
  if (!steps.length) return null;
  const at = Math.min(Math.max(stepIndex, 0), steps.length - 1);
  const step = steps[at];

  if (WHAT_IS_THIS.test(q)) {
    const cuisine = recipe.cuisine ? `${recipe.cuisine}. ` : "";
    return { text: `${recipe.title}. ${cuisine}${recipe.summary}`.trim(), grounded: true };
  }

  if (SERVES.test(q) && !SCALE_FOR.test(q)) {
    return { text: `This makes ${recipe.servings.amount} ${recipe.servings.unit}.`, grounded: true };
  }

  // "for six people" / "double it" — scaling is arithmetic on stated amounts,
  // never an invention, so it stays on the deterministic path.
  const scaled = answerScaled(recipe, q);
  if (scaled) return scaled;

  if (REMAINING.test(q)) {
    const left = steps.length - at - 1;
    if (left === 0) return { text: "This is the last step.", grounded: true };
    const rest = steps.slice(at + 1).reduce((n, s) => n + (s.duration_s ?? 0), 0);
    const clock = rest ? ` About ${formatDuration(rest)} of timed cooking left.` : "";
    return { text: `${left} ${left === 1 ? "step" : "steps"} after this one.${clock}`, grounded: true };
  }

  if (TOTAL_TIME.test(q)) {
    const stated = recipe.time.total_min ?? recipe.time.cook_min;
    if (stated) return { text: `About ${stated} minutes in total.`, grounded: true };
    const timed = steps.reduce((n, s) => n + (s.duration_s ?? 0), 0);
    return timed
      ? { text: `The recipe doesn't give a total. The timed steps add up to ${formatDuration(timed)}.`, grounded: true }
      : { text: "The recipe doesn't say how long it takes altogether.", grounded: true };
  }

  if (STORAGE.test(q)) {
    return recipe.storage
      ? { text: recipe.storage, grounded: true }
      : { text: "The recipe says nothing about storing it.", grounded: true };
  }

  if (MY_NOTES.test(q) && !LIST.test(q)) {
    if (!recipe.notes.length) return { text: "You haven't written any notes on this one yet.", grounded: true };
    return {
      text: recipe.notes.map((n) => `${n.body}${n.author ? ` — ${n.author}` : ""}`).join(" "),
      grounded: true,
    };
  }

  // A substitution question names an ingredient but must never be answered
  // with one. Say what the recipe asks for and be plain that it stops there.
  if (SUBSTITUTE.test(q)) {
    const hit = findIngredient(recipe, q);
    return {
      text: hit
        ? `The recipe calls for ${describe(hit)}. It doesn't give a substitute, so that's your call.`
        : "The recipe doesn't cover substitutions.",
      grounded: true,
    };
  }

  if (DONE_WHEN.test(q)) {
    if (step.doneness_cue) return { text: step.doneness_cue, grounded: true };
    if (step.duration_s) {
      return { text: `No visual cue for this step — go by the timer, ${formatDuration(step.duration_s)}.`, grounded: true };
    }
    return { text: "The recipe gives no test for this step. Go by how it looks.", grounded: true };
  }

  if (VESSEL.test(q)) {
    if (step.vessel) return { text: `${step.vessel}.`, grounded: true };
    if (recipe.tools.length) return { text: `The recipe lists: ${recipe.tools.join(", ")}.`, grounded: true };
    return { text: "The recipe doesn't say what to cook it in.", grounded: true };
  }

  if (WALK_AWAY.test(q)) {
    if (!step.hands_on) {
      const t = step.duration_s ? ` You've got ${formatDuration(step.duration_s)}.` : "";
      return { text: `Yes — this one looks after itself.${t}`, grounded: true };
    }
    return { text: "Stay with it — this step needs you.", grounded: true };
  }

  if (REPEAT.test(q)) return { text: speakStep(step), grounded: true, jumpToStep: at };

  if (BACK.test(q) && at > 0) {
    return { text: speakStep(steps[at - 1]), grounded: true, jumpToStep: at - 1 };
  }

  if (NEXT.test(q)) {
    const nxt = steps[at + 1];
    return nxt
      ? { text: speakStep(nxt), grounded: true, jumpToStep: at + 1 }
      : { text: "That was the last step. You're done.", grounded: true };
  }

  if (HOW_LONG.test(q)) {
    if (step.duration_s) {
      return { text: `${formatDuration(step.duration_s)} for this step.`, grounded: true };
    }
    const nextTimed = steps.slice(at + 1).find((s) => s.duration_s);
    return nextTimed
      ? { text: `This step has no timer. The next timed step is step ${nextTimed.index + 1}, ${formatDuration(nextTimed.duration_s)}.`, grounded: true }
      : { text: "This step has no timer. Go by how it looks.", grounded: true };
  }

  if (HOW_HOT.test(q)) {
    if (step.temperature_c !== null) {
      return { text: `${step.temperature_c} degrees Celsius.`, grounded: true };
    }
    if (step.heat) return { text: `${step.heat.replace("-", " ")} heat.`, grounded: true };
    const anyTemp = steps.find((s) => s.temperature_c !== null);
    return anyTemp
      ? { text: `This step has no temperature. Step ${anyTemp.index + 1} is at ${anyTemp.temperature_c} degrees.`, grounded: true }
      : { text: "This recipe doesn't give a temperature.", grounded: true };
  }

  // "what goes in this step" — narrower than the shopping list, and the more
  // useful of the two once the cook is standing at the hob.
  if (LIST.test(q) && /\b(this|now|here|step)\b/i.test(q) && step.ingredient_ids.length) {
    const here = recipe.ingredients.filter((i) => step.ingredient_ids.includes(i.id));
    if (here.length) {
      return { text: `For this step: ${here.map(describe).join(", ")}.`, grounded: true };
    }
  }

  if (LIST.test(q) && !HOW_MUCH.test(q)) {
    return { text: `You need: ${recipe.ingredients.map(describe).join(". ")}.`, grounded: true };
  }

  // "is there garlic in this" wants yes or no, not a quantity.
  if (HAS.test(q) && !HOW_MUCH.test(q)) {
    const hit = findIngredient(recipe, q);
    if (hit) return { text: `Yes — ${describe(hit)}.`, grounded: true };
    const named = contentWords(q);
    if (named.length) {
      return { text: `No, there's no ${named[named.length - 1]} in this recipe.`, grounded: true };
    }
  }

  // "how much garlic" — the single most useful question in a kitchen.
  const hit = findIngredient(recipe, q);
  if (hit) {
    const amount = formatQty(hit);
    if (amount === "—") {
      return {
        text: `The source never said how much ${hit.name.toLowerCase()}. Add it to taste.`,
        grounded: true,
      };
    }
    return { text: `${describe(hit)}.`, grounded: true };
  }

  return null;
}

/** "2 tbsp ghee, or butter" — the amount and the caveat, in speaking order. */
function describe(i: Recipe["ingredients"][number]): string {
  const amount = formatQty(i);
  const name = i.name.toLowerCase();
  const body = amount === "—" ? name : amount === "to taste" || amount === "as needed" ? `${name}, ${amount}` : `${amount} ${name}`;
  return i.note ? `${body}, ${i.note}` : body;
}

/** The step, plus the two details a cook asks for a second later anyway. */
function speakStep(s: ReturnType<typeof allSteps>[number]): string {
  const extras = [
    s.vessel && `In the ${s.vessel.toLowerCase()}`,
    s.heat && `${s.heat.replace("-", " ")} heat`,
    s.duration_s && formatDuration(s.duration_s),
  ].filter(Boolean);
  return extras.length ? `${s.text} ${extras.join(", ")}.` : s.text;
}

/**
 * Scaling. Arithmetic on stated amounts is not invention — but a null stays
 * null, because two times nothing is still nothing (PRD R5).
 */
function answerScaled(recipe: Recipe, q: string): Answer | null {
  const forN = q.match(SCALE_FOR);
  const target = forN
    ? Number(forN[1])
    : DOUBLE.test(q)
      ? recipe.servings.amount * 2
      : HALVE.test(q)
        ? recipe.servings.amount / 2
        : null;
  if (!target || target <= 0) return null;
  if (!recipe.servings.scalable) {
    return { text: "This one doesn't scale cleanly, so I'd rather not guess the amounts.", grounded: true };
  }

  const scaledRecipe = scale(recipe, target);
  const named = findIngredient(recipe, q.replace(SCALE_FOR, " "));
  if (named) {
    const after = scaledRecipe.ingredients.find((i) => i.id === named.id)!;
    return {
      text:
        after.qty === null
          ? `${named.name} has no stated amount, so it stays as it is.`
          : `${describe(after)} for ${formatNumber(target)} ${recipe.servings.unit}.`,
      grounded: true,
    };
  }
  const withAmounts = scaledRecipe.ingredients.filter((i) => i.qty !== null);
  if (!withAmounts.length) return null;
  return {
    text: `For ${formatNumber(target)} ${recipe.servings.unit}: ${withAmounts.map(describe).join(", ")}.`,
    grounded: true,
  };
}

const STOPWORDS = new Set([
  "the", "and", "for", "how", "much", "many", "what", "this", "that", "with", "does",
  "have", "there", "any", "can", "use", "instead", "recipe", "need", "put", "add",
  "should", "would", "cook", "make", "you", "are", "was", "get", "got", "not", "but",
]);

function contentWords(question: string): string[] {
  return question
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .split(/\s+/)
    .filter((w) => w.length > 2 && !STOPWORDS.has(w));
}

/**
 * The honest last word when nothing matched and there is no model to ask.
 *
 * A bare "I can't find that" is a dead end at the exact moment the cook's
 * hands are full. Naming what this recipe *can* answer turns the same refusal
 * into a next move.
 */
function lastResort(recipe: Recipe, question: string): string {
  const named = contentWords(question);
  const unknown = named.length ? `The recipe doesn't mention ${named[named.length - 1]}. ` : "";
  return `${unknown}I can only answer from this recipe — amounts, timings, temperatures, what goes in a step, and where you are in it.`;
}

function findIngredient(recipe: Recipe, question: string) {
  // Stopwords stripped: "do I need any butter" once matched an ingredient
  // called "Nutmeg" on the shared "ne", which is a confident wrong answer.
  const words = contentWords(question);
  if (!words.length) return null;

  let best: { i: (typeof recipe.ingredients)[number]; score: number } | null = null;
  for (const i of recipe.ingredients) {
    const name = i.name.toLowerCase();
    const score = words.filter((w) => name.includes(w) || w.includes(name.split(/[\s,]/)[0])).length;
    if (score > 0 && (!best || score > best.score)) best = { i, score };
  }
  return best?.i ?? null;
}

// ——— model-backed ————————————————————————————————————————

async function answerWithSarvam(
  recipe: Recipe,
  question: string,
  stepIndex: number,
  onDelta?: (chunk: string) => void,
): Promise<Answer> {
  const steps = allSteps(recipe);
  const context = [
    `Recipe: ${recipe.title}`,
    `Serves ${recipe.servings.amount} ${recipe.servings.unit}`,
    "",
    "Ingredients:",
    ...recipe.ingredients.map((i) => `- ${i.name}: ${formatQty(i)}${i.note ? ` (${i.note})` : ""}`),
    "",
    "Steps:",
    ...steps.map(
      (s, n) =>
        `${n + 1}. [${s.phaseName}] ${s.text}` +
        (s.duration_s ? ` (${formatDuration(s.duration_s)})` : "") +
        (s.temperature_c !== null ? ` (${s.temperature_c} °C)` : "") +
        (s.vessel ? ` (in: ${s.vessel})` : "") +
        (s.heat ? ` (heat: ${s.heat})` : "") +
        (s.doneness_cue ? ` (ready when: ${s.doneness_cue})` : ""),
    ),
    recipe.tools.length ? `\nTools: ${recipe.tools.join(", ")}` : "",
    recipe.storage ? `Storage: ${recipe.storage}` : "",
    recipe.notes.length ? `The cook's own notes: ${recipe.notes.map((n) => n.body).join(" | ")}` : "",
    "",
    `The cook is currently on step ${stepIndex + 1}.`,
  ]
    .filter(Boolean)
    .join("\n");

  const messages = [
    {
      role: "system" as const,
      content:
        "You are answering a cook who is mid-recipe with their hands full. " +
        "Answer in one or two short spoken sentences. No lists, no markdown, no preamble.\n\n" +
        "Answer ONLY from the recipe below. If the recipe does not contain the answer, " +
        "say so plainly — never estimate a quantity, a time, or a temperature that is not written here. " +
        "A made-up number could ruin their dinner.\n\n" +
        context,
    },
    { role: "user" as const, content: question },
  ];
  const opts = { temperature: 0.1, maxTokens: 700 };

  // Streaming is not a nicety here: a reasoning model thinks for seconds
  // before its first word, and a silent kitchen speaker reads as a hang.
  const text = onDelta
    ? await chatStream(messages, opts, onDelta)
    : await chat(messages, opts);

  return { text: text.trim(), grounded: false };
}
