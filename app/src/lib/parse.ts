import { Unit } from "./rrf";

/**
 * The deterministic parser.
 *
 * TECH-SPEC §8 names this as the cost lever: a caption that already lists
 * "2 tbsp ghee" does not need a 105B model to notice. So this is not a stand-in
 * for extraction — it IS the caption-rich fast path, and it is what runs when
 * SARVAM_MODE=mock so you can develop the whole product without burning credits.
 *
 * The one rule it shares with the LLM path: if the text does not state an
 * amount, `qty` is null. It never guesses (PRD R5).
 */

const UNIT_WORDS: Record<string, Unit> = {
  g: "g", gm: "g", gms: "g", gram: "g", grams: "g",
  kg: "kg", kgs: "kg", kilo: "kg", kilos: "kg", kilogram: "kg", kilograms: "kg",
  ml: "ml", millilitre: "ml", milliliter: "ml", millilitres: "ml", milliliters: "ml",
  l: "l", ltr: "l", litre: "l", liter: "l", litres: "l", liters: "l",
  tsp: "tsp", teaspoon: "tsp", teaspoons: "tsp", tspn: "tsp",
  tbsp: "tbsp", tablespoon: "tbsp", tablespoons: "tbsp", tbs: "tbsp", tbspn: "tbsp",
  cup: "cup", cups: "cup",
  oz: "oz", ounce: "oz", ounces: "oz",
  lb: "lb", lbs: "lb", pound: "lb", pounds: "lb",
  piece: "piece", pieces: "piece", pc: "piece", pcs: "piece", nos: "piece", no: "piece",
  clove: "clove", cloves: "clove",
  head: "head", heads: "head",
  bunch: "bunch", bunches: "bunch", sprig: "bunch", sprigs: "bunch",
  handful: "handful", handfuls: "handful",
  pinch: "pinch", pinches: "pinch",
};

const VULGAR: Record<string, number> = {
  "½": 0.5, "⅓": 1 / 3, "⅔": 2 / 3, "¼": 0.25, "¾": 0.75,
  "⅕": 0.2, "⅖": 0.4, "⅗": 0.6, "⅘": 0.8, "⅙": 1 / 6, "⅛": 0.125, "⅜": 0.375, "⅝": 0.625, "⅞": 0.875,
};

const WORD_NUM: Record<string, number> = {
  a: 1, an: 1, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6,
  seven: 7, eight: 8, nine: 9, ten: 10, half: 0.5, quarter: 0.25, dozen: 12,
};

/** Technique words that name a phase rather than an ingredient (PRD §7 moat). */
const PHASE_WORDS = [
  "tadka", "chhonk", "tarka", "baghar", "tempering",
  "marinade", "marination", "masala", "gravy", "curry",
  "prep", "prepare", "preparation", "assembly", "assemble",
  "garnish", "serving", "serve", "dough", "batter", "filling",
  "sauce", "dressing", "soffritto", "mise en place", "finish", "rest",
];

/**
 * Header vocabulary, English and Hinglish.
 *
 * The Hinglish forms are not a nicety. Rovelle's wedge is Indian-cuisine
 * reels, and a huge share of them write the method as "Banane ka tarika:" or
 * "Vidhi:". Miss that header and every step in the caption is silently
 * dropped — which is exactly what happened on the first live test.
 */
const INGREDIENT_HEADER =
  /^\s*(?:\*{0,2})(ingredients?|you(?:'| )?ll need|what you need|sam+agri|saaman|saman|cheezein|chahiye)\b/i;
const METHOD_HEADER =
  /^\s*(?:\*{0,2})(method|steps?|instructions?|directions?|how to (?:make|cook)|recipe|procedure|preparation|vidhi|banane (?:ka|ki) (?:tarika|tareeka|tarike|vidhi)|banane ka trika|banane ki vidhi|tarika|tareeka|banate hain)\b/i;
const GROUP_HEADER =
  /^\s*(?:\*{0,2})(?:for(?: the)?|to make)\s+(?:the\s+)?([a-z][\w\s/']{1,32}?)\s*[-–—:]*\s*\*{0,2}\s*$/i;
// A bullet with no space after it — "-Fry the onions" — is how Instagram
// captions are written, and requiring \s+ left the dash in the step text.
const BULLET = /^\s*(?:[-–—*•·▢◻︎☐▪️]\s*|o\s+|\d+[.)]\s*|\(\d+\)\s*)/;

/**
 * Creator boilerplate. A YouTube description is half recipe and half channel
 * promo, and without this the parser cheerfully files "Click here to
 * Subscribe" as an ingredient — which it did, on the first real video tested.
 */
const BOILERPLATE =
  /^\s*(?:-{2,}|={2,}|#\w|https?:\/\/|www\.)|(?:subscribe|click here|follow (?:us|me)|watch more|check out|my (?:website|channel)|shop |buy |affiliate|sponsor|discount code|link in bio|full recipe (?:here|at)|written recipe|for more recipes|do like|share and|comment below|thanks for watching|hit the bell)|(?:^\s*(?:website|facebook|instagram|twitter|x|pinterest|youtube|tiktok|threads|snapchat|telegram|whatsapp|email|contact|business)\s*[:：])/i;

/** True when a line is channel promo rather than any part of the recipe. */
export function isBoilerplate(line: string): boolean {
  const t = line.trim();
  if (!t) return true;
  if (BOILERPLATE.test(t)) return true;
  // A line that is mostly a URL or handles.
  if (/https?:\/\//.test(t) || (t.match(/@\w+/g) ?? []).length >= 2) return true;
  return false;
}

export type ParsedIngredient = {
  name: string;
  qty: number | null;
  unit: Unit | null;
  note: string | null;
  group: string;
  optional: boolean;
  confidence: number;
};

export type ParsedStep = {
  text: string;
  duration_s: number | null;
  temperature_c: number | null;
  confidence: number;
};

export type ParsedPhase = { name: string; steps: ParsedStep[] };

// ——— quantities ———————————————————————————————————————————

/**
 * Reads a leading amount off an ingredient line.
 * Handles "2", "1/2", "½", "1 ½", "2-3" (takes the low end, honestly flagged),
 * "250g" with no space, and the word forms. Returns null when the line simply
 * doesn't state one.
 */
export function readQty(s: string): { qty: number | null; rest: string; confidence: number } {
  const t = s.trim();

  // "2 - 3 cups" / "2 to 3 cups" — a range is a real answer, but not an exact
  // one. Take the lower bound and drop confidence so the review screen flags it.
  const range = t.match(/^(\d+(?:\.\d+)?)\s*(?:-|–|—|to)\s*(\d+(?:\.\d+)?)\s*(.*)$/i);
  if (range) return { qty: Number(range[1]), rest: range[3], confidence: 0.7 };

  // "1 ½ cups" / "1½ cups"
  const mixed = t.match(/^(\d+)\s*([½⅓⅔¼¾⅕⅖⅗⅘⅙⅛⅜⅝⅞])\s*(.*)$/);
  if (mixed) return { qty: Number(mixed[1]) + VULGAR[mixed[2]], rest: mixed[3], confidence: 0.95 };

  // "½ tsp"
  const vulgar = t.match(/^([½⅓⅔¼¾⅕⅖⅗⅘⅙⅛⅜⅝⅞])\s*(.*)$/);
  if (vulgar) return { qty: VULGAR[vulgar[1]], rest: vulgar[2], confidence: 0.95 };

  // "1/2 cup" / "1 1/2 cup"
  const frac = t.match(/^(?:(\d+)\s+)?(\d+)\s*\/\s*(\d+)\s*(.*)$/);
  if (frac) {
    const whole = frac[1] ? Number(frac[1]) : 0;
    const denom = Number(frac[3]);
    if (denom > 0) return { qty: whole + Number(frac[2]) / denom, rest: frac[4], confidence: 0.95 };
  }

  // "250g" / "2.5 kg" / "2 tbsp"
  const plain = t.match(/^(\d+(?:\.\d+)?)\s*(.*)$/);
  if (plain) return { qty: Number(plain[1]), rest: plain[2], confidence: 0.95 };

  // "two tbsp" / "a pinch of"
  const word = t.match(/^([a-z]+)\s+(.*)$/i);
  if (word && WORD_NUM[word[1].toLowerCase()] !== undefined) {
    // "a large onion" is a count; "a pinch" is a unit. Both start at 1.
    return { qty: WORD_NUM[word[1].toLowerCase()], rest: word[2], confidence: 0.8 };
  }

  return { qty: null, rest: t, confidence: 1 };
}

function readUnit(s: string): { unit: Unit | null; rest: string } {
  const m = s.trim().match(/^([a-z]+)\b\.?\s*(.*)$/i);
  if (!m) return { unit: null, rest: s.trim() };
  const unit = UNIT_WORDS[m[1].toLowerCase()];
  if (!unit) return { unit: null, rest: s.trim() };
  // "cups of flour" → drop the connective
  return { unit, rest: m[2].replace(/^of\s+/i, "").trim() };
}

/** One ingredient line → structured, or null if the line isn't one. */
export function parseIngredientLine(raw: string, group: string): ParsedIngredient | null {
  let line = raw.replace(BULLET, "").replace(/\*\*/g, "").trim();
  if (!line || line.length > 140) return null;

  const optional = /\boptional\b/i.test(line);
  line = line.replace(/\(\s*optional\s*\)/gi, "").replace(/,?\s*optional\b/gi, "").trim();

  // A trailing parenthetical or post-comma clause is a note, not the name.
  let note: string | null = null;
  const paren = line.match(/^(.*?)\s*\(([^)]{2,60})\)\s*$/);
  if (paren) {
    line = paren[1].trim();
    note = paren[2].trim();
  }

  // "salt to taste" / "oil as needed" — a legitimate quantity, not a gap.
  const toTaste = line.match(/^(.*?)[,\s]+(?:to taste|as (?:needed|required)|as per taste|swad anusar)\.?$/i);
  if (toTaste) {
    const name = clean(toTaste[1]);
    if (!name) return null;
    return {
      name,
      qty: null,
      unit: /as (?:needed|required)/i.test(line) ? "as_needed" : "to_taste",
      note,
      group,
      optional,
      confidence: 0.95,
    };
  }

  // "Masoor dal – 30gms/2.5tbsp" — name first, amount after a dash. This is
  // how most Indian YouTube descriptions are written, and reading it
  // left-to-right finds no quantity at all on any line.
  const trailing = line.match(/^(.{2,60}?)\s+[-–—:]\s*(.+)$/);
  if (trailing) {
    const head = trailing[1].trim();
    // "30gms/2.5tbsp" states the same amount twice — take the first. Split
    // only where a letter precedes the slash, or "1/2tsp" gets cut in half
    // and a half teaspoon becomes a whole one.
    const amount = trailing[2].split(/(?<=[a-z])\s*\/\s*/i)[0].trim();
    const read = readQty(amount);
    const withUnit = readUnit(read.rest);
    if (read.qty !== null && !/\d/.test(head)) {
      const name = clean(head);
      if (name) {
        return {
          name,
          qty: read.qty,
          unit: withUnit.unit,
          note: note ?? (withUnit.rest.trim() || null),
          group,
          optional,
          confidence: read.confidence,
        };
      }
    }
  }

  const { qty, rest, confidence } = readQty(line);
  const { unit, rest: afterUnit } = readUnit(rest);

  // A quantity-first line with a comma usually means "600g chicken, patted dry".
  let name = afterUnit;
  if (!note) {
    const comma = name.match(/^([^,]{2,60}),\s*(.{2,60})$/);
    if (comma && /\b(chopped|sliced|diced|minced|grated|crushed|beaten|melted|softened|room temperature|patted dry|finely|roughly|thinly|julienned|deseeded|peeled|washed|soaked|toasted)\b/i.test(comma[2])) {
      name = comma[1];
      note = comma[2].trim();
    }
  }
  name = clean(name);

  if (!name) return null;
  // Reject prose that happens to start with a number: "10 minutes later, add…"
  if (qty !== null && unit === null && name.split(/\s+/).length > 6) return null;
  if (qty === null && unit === null) {
    // Bare-name ingredient lines are only credible under an Ingredients header,
    // which the caller signals by passing a group. Two words or fewer, no verbs.
    if (name.split(/\s+/).length > 5 || /\b(add|heat|cook|stir|mix|pour|until|then|serve|garnish)\b/i.test(name)) {
      return null;
    }
  }

  return {
    name,
    qty,
    unit,
    note,
    group,
    optional,
    // Unit-less counts ("2 onions") are solid; bare names are a weaker claim.
    confidence: qty === null && unit === null ? 0.7 : confidence,
  };
}

function clean(s: string): string {
  const t = s
    // Trailing dashes come from "Salt – to taste" style lines, where the
    // amount was stripped and the separator was left behind.
    .replace(/^\W+|[\s,.;:\-–—]+$/g, "")
    .replace(/\s+/g, " ")
    .trim();
  if (t.length < 2 || t.length > 80) return "";
  return t.charAt(0).toUpperCase() + t.slice(1);
}

// ——— steps ————————————————————————————————————————————————

const TIME_RE = /\b(\d+(?:\.\d+)?)\s*(?:-|–|to)?\s*(\d+(?:\.\d+)?)?\s*(sec(?:ond)?s?|min(?:ute)?s?|hours?|hrs?)\b/i;
const TEMP_RE = /\b(\d{2,3})\s*(?:°|deg(?:rees)?)?\s*([cf])\b/i;

export function readDuration(text: string): number | null {
  const m = text.match(TIME_RE);
  if (!m) return null;
  // A range means "check at the low end" — the cook watches the pan, not us.
  const n = Number(m[1]);
  const unit = m[3].toLowerCase();
  const mult = unit.startsWith("sec") ? 1 : unit.startsWith("min") ? 60 : 3600;
  const seconds = Math.round(n * mult);
  return seconds > 0 && seconds <= 12 * 3600 ? seconds : null;
}

export function readTemperature(text: string): number | null {
  const m = text.match(TEMP_RE);
  if (!m) return null;
  const n = Number(m[1]);
  if (m[2].toLowerCase() === "f") return Math.round(((n - 32) * 5) / 9);
  return n;
}

/**
 * Chatter a presenter says that is not an instruction.
 *
 * A transcript opens with "Hello guys, this is Kunal Kapoor, today I'll show
 * you my favourite dal" — three sentences before anyone touches a pan. Left
 * in, they become steps 1-3 of Cook Mode and the cook taps through greetings
 * with wet hands.
 */
const NOT_A_STEP =
  /^(?:hello|hi|hey|namaste|welcome|so |okay|ok |alright|right,|today|in this video|friends|guys|dosto|as you can see|i am |i'm |this is |my name|let me tell|before we (?:begin|start)|don't forget|if you like|thank you|thanks)/i;

/**
 * Caption prose masquerading as a step.
 *
 * A creator's blurb — "chicken podi might just be the most genius invention to
 * ever exist" — is an opinion about the dish, not something you do to it. It
 * reached step 4 of Cook Mode on a real Instagram import.
 */
const IS_COMMENTARY =
  /\b(?:might just be|is the most|i love|my favou?rite|trust me|you have to try|so good|obsessed|genius|best ever|reminds me|growing up|my mum used to|comment below|save this|recipe below)\b/i;

function splitSentences(block: string): string[] {
  return block
    .split(/(?<=[.!?])\s+(?=[A-Z0-9])|\n+/)
    .map((s) => s.replace(BULLET, "").replace(/\*\*/g, "").trim())
    .filter((s) => s.length > 8 && !NOT_A_STEP.test(s) && !IS_COMMENTARY.test(s));
}

// ——— whole document ———————————————————————————————————————

export type ParsedRecipe = {
  title: string | null;
  ingredients: ParsedIngredient[];
  phases: ParsedPhase[];
  servings: number | null;
};

/**
 * Splits a caption / transcript / OCR dump into ingredients and phased steps.
 *
 * The structure it looks for, in order: explicit `Ingredients:` / `Method:`
 * headers, then `For the tadka:` group headers, then — failing all of that —
 * a heuristic pass where quantity-leading lines are ingredients and everything
 * imperative is a step.
 */
export function parseRecipeText(text: string): ParsedRecipe {
  const lines = text.split(/\r?\n/).map((l) => l.trim());

  let section: "unknown" | "ingredients" | "method" = "unknown";
  let group = "main";
  let phaseName = "Cook";
  const ingredients: ParsedIngredient[] = [];
  const phases = new Map<string, ParsedStep[]>();
  let title: string | null = null;
  let servings: number | null = null;

  const pushStep = (name: string, s: ParsedStep) => {
    if (!phases.has(name)) phases.set(name, []);
    phases.get(name)!.push(s);
  };

  for (const raw of lines) {
    const line = raw.trim();
    if (!line || isBoilerplate(line)) continue;

    if (!title && line.length > 3 && line.length < 90 && !BULLET.test(line) && !INGREDIENT_HEADER.test(line)) {
      title = line.replace(/^#+\s*/, "").replace(/\*\*/g, "").replace(/#\w+/g, "").trim() || null;
    }

    const serves = line.match(/\b(?:serves|servings?|yields?)\s*:?\s*(\d+)/i);
    if (serves) servings = Number(serves[1]);

    if (INGREDIENT_HEADER.test(line)) {
      section = "ingredients";
      group = "main";
      continue;
    }
    if (METHOD_HEADER.test(line)) {
      section = "method";
      phaseName = "Cook";
      continue;
    }

    const gh = line.match(GROUP_HEADER);
    if (gh) {
      const label = gh[1].trim().toLowerCase();
      group = label;
      // "For the tadka:" names a phase, not an ingredient bucket (TECH-SPEC §6).
      phaseName = PHASE_WORDS.includes(label) ? titleCase(label) : titleCase(label);
      continue;
    }

    if (section === "method") {
      for (const s of splitSentences(line)) {
        pushStep(phaseName, {
          text: s,
          duration_s: readDuration(s),
          temperature_c: readTemperature(s),
          confidence: 0.9,
        });
      }
      continue;
    }

    const ing = parseIngredientLine(line, group);
    if (ing && (section === "ingredients" || ing.qty !== null || ing.unit !== null)) {
      ingredients.push(ing);
      continue;
    }

    // Unheadered prose. An imperative sentence is a step — including the
    // Hinglish imperatives, which is how half these captions are written.
    if (
      section === "unknown" &&
      /\b(add|heat|cook|stir|mix|pour|fry|saute|sauté|bake|boil|simmer|roast|grind|knead|marinate|temper|garnish|serve|blend|whisk|chop|drain|cover|rest|flip|season|daalo|daal(?:ein|iye)?|garam|bhuno|bhunein|milao|mila|dhak(?:o|ein)?|pakao|paka(?:ein|iye)?|chatak|karo|kar(?:ein|iye)|kaat|sek|tal(?:ein|o))\b/i.test(
        line,
      )
    ) {
      for (const s of splitSentences(line)) {
        pushStep(phaseName, {
          text: s,
          duration_s: readDuration(s),
          temperature_c: readTemperature(s),
          confidence: 0.75,
        });
      }
    }
  }

  return {
    title,
    ingredients: dedupe(ingredients),
    phases: [...phases.entries()].map(([name, steps]) => ({ name, steps })),
    servings,
  };
}

function dedupe(list: ParsedIngredient[]): ParsedIngredient[] {
  const seen = new Map<string, ParsedIngredient>();
  for (const i of list) {
    const key = `${i.group}::${i.name.toLowerCase()}`;
    // Keep whichever mention actually carried a quantity.
    const prev = seen.get(key);
    if (!prev || (prev.qty === null && i.qty !== null)) seen.set(key, i);
  }
  return [...seen.values()];
}

function titleCase(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}
