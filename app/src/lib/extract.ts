import { ExtractionDraft, RRF_VERSION, Unit, newStep, type Recipe } from "./rrf";
import { isBoilerplate, parseRecipeText, readDuration, readTemperature } from "./parse";
import { chat, extractJson, extractJsonArray, mode } from "./sarvam";
import type { Fetched } from "./fetchers";

export const EXTRACTION_VERSION = "2026.07.1";

/**
 * Text in, RRF draft out. Two implementations behind one function:
 *
 *   live → Sarvam-105B under the §6 prompt contract
 *   mock → the deterministic parser in parse.ts
 *
 * Both obey the same invariants, and the draft is validated against the same
 * zod schema either way, so switching modes cannot change the shape of what
 * lands in the database.
 */

/**
 * The extraction contract (TECH-SPEC §6), deliberately terse.
 *
 * Sarvam-105B reasons before answering, and the reasoning counts against a
 * 4096-token ceiling on the starter tier. A long, chatty system prompt makes
 * it deliberate longer and truncate before it emits any JSON. Measured on the
 * same caption: the earlier prose-heavy version of this prompt burned the
 * full 4096 and returned `content: null`; this one finishes in ~3,900 with
 * valid JSON. Every rule below is load-bearing — none of the prose was.
 */
/**
 * The extraction contract.
 *
 * Written against one test: a cook is standing at the hob with oily hands,
 * the phone is propped across the counter, and they ask a question out loud.
 * If the answer isn't in the JSON, the extraction failed — however tidy it
 * looks. That is why steps carry vessel, heat, doneness_cue and hands_on
 * rather than just text and a timer.
 *
 * The input is a machine transcript of someone talking over a hot pan. It is
 * disfluent, code-switched, and often has no numbers in it at all. The rules
 * below are ordered so the model resolves that mess without inventing.
 */
const RULES = `HARD RULES, in priority order:
1. NEVER invent a number. No quantity, time, or temperature that the source did not state. Unstated amount => "qty": null. Use to_taste / as_needed only when the source actually says "to taste", "swad anusar", "as needed". A confident wrong number ruins a dinner; a blank does not.
2. This is a speech transcript, so it is misheard sometimes. If a number sounds wrong for the dish (200 g of chilli powder, 3 hours for scrambled eggs), keep what was said but drop confidence below 0.6 so the cook is asked to check it.
3. Rewrite everything in your own plain imperative English. Never reproduce the creator's phrasing.
4. confidence is honest, 0-1. Written text => up to 0.95. Heard in speech => max 0.8. Inferred from context => max 0.5.
5. Keep technique words in their own language where that IS the name of the action - tadka, chhonk, bhuna, dum, soffritto, deglaze, emulsify - and gloss them in the step text.
6. Whole and ground spices are different ingredients. "cumin seeds" is never "ground cumin".
7. Celsius only. Convert Fahrenheit yourself.
8. Ignore everything that is not the recipe: greetings, subscribe requests, sponsorships, anecdotes.`;

/**
 * Both prompts ask for POSITIONAL ARRAYS rather than keyed objects.
 *
 * Sarvam-105B reasons before it answers and the reasoning shares a 4096-token
 * ceiling with the output. Keyed JSON spends most of the output budget
 * reprinting `"doneness_cue":` twenty times: measured on a real 98-second
 * video, the keyed form truncated mid-array on both calls. The positional
 * form carries the same information in roughly half the tokens and completes.
 *
 * The cost is that the shape is now implicit, so `decodePantry` and
 * `decodeMethod` below are the schema — keep them next to the prompt.
 */
/**
 * Source-specific guidance.
 *
 * A creator's written description, a human's deliberate paste, and OCR off a
 * handwritten card are three different kinds of evidence that fail in three
 * different ways. One prompt for all of them means the model treats a misheard
 * "two tablespoons" exactly like a typed one — and the whole product rests on
 * not doing that.
 */
const SOURCE_GUIDANCE: Record<SourceKind, string> = {
  video: `THIS SOURCE IS A VIDEO. You may be given two things and they are NOT equally reliable:
- "Written description" / "Recipe posted in a comment" — the creator TYPED this. Quantities here are deliberate. Trust them. Confidence up to 0.95.
- "Spoken transcript" — a machine heard this over a hot pan. It mishears numbers and units constantly: "two tablespoons" and "two teaspoons" sound alike, "fifteen" and "fifty" sound alike. Confidence caps at 0.8, and below 0.6 for any number that only appears in speech.
Where the two disagree about an amount, THE WRITTEN ONE WINS.
The description usually holds the ingredient list; the narration usually holds the method and the sensory cues. Use each for what it is good at.
Ignore hashtags, handles, and anything after a "#" run.`,

  pasted: `THIS SOURCE WAS PASTED BY A PERSON. They chose this text deliberately, so it is usually already a recipe with real structure.
- Trust the quantities as written. Confidence up to 0.95.
- Preserve the groups the author made ("For the tadka:", "For the marinade:") — they know their own recipe.
- Do not invent structure they did not write. If they gave four steps, do not manufacture nine.
- If the text is a caption rather than a recipe, extract what is there and leave the rest null. Do not fill gaps with typical values for the dish.`,

  photo: `THIS SOURCE IS OCR OFF AN IMAGE — a handwritten card, a cookbook page, a screenshot.
- OCR confuses digits: 1/7, 0/O, 5/S, 6/b, and it loses decimal points. Any quantity that looks implausible for the dish is probably misread — keep what it says but drop confidence below 0.6 so the cook checks it.
- Expect abbreviations: tsp, tbs, T, t, c, oz, "dsp". Resolve them to the unit list.
- Fractions are often mangled ("l/2" for "1/2"). Read them as fractions.
- Line order may be scrambled by columns. Group by meaning, not by position.
- A word you cannot read is better omitted than guessed at.`,
};

/**
 * The one-line version, for the enrich stage.
 *
 * Enrich is a mechanical rewrite of eight lines at a time — it does not weigh
 * evidence, so it does not need the full guidance. Handing it the long block
 * cost real output: the model reasoned further, blew the 4096-token ceiling,
 * and every batch came back empty, which silently dropped the doneness cues
 * that make Cook Mode worth using. Measured: cues 7 → 0.
 */
const ENRICH_HINT: Record<SourceKind, string> = {
  video: "These lines came from a video. Numbers heard in speech are unreliable — keep them but lower confidence.",
  pasted: "A person pasted these lines deliberately. Trust the wording and the amounts.",
  photo: "These lines came from OCR. Digits may be misread; lower confidence on anything implausible.",
};

const PANTRY_PROMPT = `You read cooking videos and pull out what goes in. Output ONLY a JSON object. No prose, no fences.

{"t":title,"s":one-sentence summary,"c":cuisine|null,"sv":servings number,"tm":[prep_min,cook_min,total_min],"d":"easy"|"medium"|"involved","tl":[tools],"st":storage|null,"ing":[[name,qty,unit,note,group,optional,confidence]]}

Each ingredient is an array of exactly 7 values in that order:
  name       string
  qty        number or null
  unit       one of: g kg ml l tsp tbsp cup oz lb piece clove head bunch handful pinch to_taste as_needed - or null
  note       prep state only ("finely chopped", "at room temperature") or null
  group      "main", or the component: "tadka" "marinade" "garnish" "sauce" "dough"
  optional   true or false
  confidence 0-1

tm entries are numbers or null. tl is every vessel and implement needed before starting.
s is one sentence on what it tastes like and why it is worth cooking - not a list of steps.

${RULES}`;

/**
 * The method prompt is a REWRITE task, not an analysis task.
 *
 * Asking the model to read a transcript and work out the method made it
 * deliberate — about ordering, about which timestamp came first — and that
 * deliberation shares the 4096-token budget with the answer. Measured on a
 * 98-second video it spent all 4096 tokens thinking and returned nothing, and
 * it did so again when the transcript was cut into one-minute windows.
 *
 * So the parser segments the transcript into candidate steps first, and the
 * model is handed a numbered list with one job: rewrite each line as a clean
 * imperative and fill in the sensory fields. Same output, a fraction of the
 * thinking, and the step count is fixed in advance so the response size is
 * predictable rather than open-ended.
 */
const ENRICH_PROMPT = `You clean up cooking steps that were transcribed from a video. Output ONLY a JSON array. No prose, no fences.

You get a numbered list of raw transcript lines. Return an array with EXACTLY one entry per input line, in the same order:

[[text,duration_s,temperature_c,vessel,heat,doneness_cue,hands_on,phase],...]

  text          the line REWRITTEN as a clean imperative instruction, under 25 words, in your own words. Never echo the line back unchanged - reproducing the creator's phrasing is a legal problem, not a style one. Fix transcription noise.
                Return "" and the line is dropped. Do that for anything that is not an instruction: greetings, asides, and OBSERVATIONS about what already happened ("it has come to a good boil", "the garlic is browned now", "our dal is ready"). An observation belongs in doneness_cue of the step before it, not as a step of its own.
  duration_s    number or null - only if the line states a time
  temperature_c number or null - Celsius
  vessel        "kadai", "heavy-bottomed pan", "pressure cooker", "oven" - or null
  heat          "low" "medium-low" "medium" "medium-high" "high" or null
  doneness_cue  how you know it is ready, in the senses - "garlic turns light golden", "oil separates" - or null
  hands_on      true, or false when the pan works alone and the cook can walk away
  phase         "Prep" "Marinade" "Tadka" "Cook" "Finish" or "Rest"

A tempering / tadka / chhonk is ALWAYS phase "Tadka".
Never invent a number. If the line does not state a time or temperature, use null.
Work straight down the list. Do not deliberate. Start your reply with [ and end with ].`;

const METHOD_PROMPT = `You read cooking videos and pull out what to do. Output ONLY a JSON object. No prose, no fences.

{"ph":[[phase_name,[[text,duration_s,temperature_c,vessel,heat,doneness_cue,hands_on,[ingredient_ids],source_ts_s,confidence]]]]}

Each step is an array of exactly 10 values in that order:
  text          one action, imperative, under 25 words
  duration_s    number or null - only if stated
  temperature_c number or null - Celsius
  vessel        what it happens in ("kadai", "heavy-bottomed pan", "oven") or null
  heat          "low" "medium-low" "medium" "medium-high" "high" or null
  doneness_cue  how you KNOW it is ready, in the senses, or null
  hands_on      true, or false when the pan works alone and the cook can walk away
  ids           array of ingredient ids from the list you were given
  source_ts_s   transcript timestamp this came from, or null
  confidence    0-1

doneness_cue is the most valuable field here. Timers lie and pans vary; "cumin stops sputtering", "onions go translucent at the edges", "oil separates from the masala" is what an experienced cook actually goes by. Fill it whenever the source gives any sensory signal.

text: one step = one thing you do. Split "heat oil and add cumin then onions" into separate steps.
duration_s: a stated range => take the low end and set confidence below 0.7.

PHASES: technique-accurate names - Prep, Marinade, Tadka, Cook, Finish, Rest. A tempering / tadka / chhonk is ALWAYS its own phase, never buried inside another. Phases run in the order the cook does them.

Work straight through the transcript in order and emit the JSON. Do not deliberate about ordering, do not re-read, do not explain. Start your reply with { and end it with }.

${RULES}`;

export type ExtractionInput = {
  text: string;
  source: {
    platform: Recipe["source"]["platform"];
    url: string | null;
    handle: string | null;
    creator_name: string | null;
    media_duration_s: number | null;
  };
  /** Transcript cues, when we have them — they become source_ts_s. */
  cues?: Array<{ t: number; text: string }>;
  titleHint?: string | null;
  /** The creator's real thumbnail URL, when the source had one. */
  image?: string | null;
  /**
   * Where this text came from. Drives which guidance the model gets: the three
   * sources fail in completely different ways and telling the model which one
   * it is holding is the cheapest accuracy win available.
   */
  kind?: SourceKind;
};

export type SourceKind = "video" | "pasted" | "photo";

export type Draft = Omit<Recipe, "id" | "meta">;

/**
 * Drop channel promo before anything reads the text.
 *
 * A creator's description is half recipe, half "subscribe / my website /
 * affiliate links". Stripping it makes the parser correct and the model
 * cheaper — on a real video this cut the input by a third, which matters when
 * the whole budget is 4096 tokens.
 */
function clean(text: string): string {
  return text
    .split(/\r?\n/)
    .filter((l) => !isBoilerplate(l) || /^---/.test(l.trim()))
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export async function extract(raw: ExtractionInput): Promise<Draft> {
  const input: ExtractionInput = { ...raw, text: clean(raw.text) };
  if (mode("extract") === "live") {
    try {
      return await extractWithSarvam(input);
    } catch (err) {
      // A model failure must not lose the import. Fall through to the parser
      // and let the review screen carry the lower confidence.
      console.warn("[rovelle] Sarvam extraction failed, falling back to parser:", err);
    }
  }
  return extractWithParser(input);
}

// ——— live ——————————————————————————————————————————————————

/**
 * Two calls, not one.
 *
 * Sarvam-105B thinks before it answers and the thinking counts against the
 * same 4096-token ceiling as the output. A whole RRF document — ingredients
 * AND every step — does not fit alongside the reasoning: measured against the
 * live API, a one-shot call on an ordinary caption returned JSON that was
 * truncated mid-array, which is worse than no answer because it looks
 * complete right up until it isn't.
 *
 * Splitting on the natural seam (what goes in / what you do) puts each half
 * comfortably inside the budget, and the method call gets to reference
 * ingredient ids that are already settled, so the links come out better too.
 * Collapse this back into one call the day the tier allows it.
 */
async function extractWithSarvam(input: ExtractionInput): Promise<Draft> {
  const cueBlock = input.cues?.length
    ? `\n\n--- Spoken transcript, machine-heard, [seconds] ---\n${input.cues
        .map((c) => `[${Math.round(c.t)}] ${c.text}`)
        .join("\n")
        .slice(0, 9000)}`
    : "";

  const caption =
    `Platform: ${input.source.platform}\n` +
    `Creator: ${input.source.creator_name ?? "unknown"} ${input.source.handle ?? ""}\n\n` +
    `${input.text.slice(0, 9000)}${cueBlock}`;

  const pantry = decodePantry(
    extractJson(
      await chat(
        [
          { role: "system", content: `${PANTRY_PROMPT}\n\n${SOURCE_GUIDANCE[input.kind ?? "video"]}` },
          { role: "user", content: caption },
        ],
        { temperature: 0.1 },
      ),
    ),
  );

  const roster = pantry.ingredients.map((i) => `${i.id}: ${i.name} [${i.group}]`).join("\n");

  const phases = await extractMethod(input, roster);
  if (!phases.length) throw new Error("Sarvam returned no method steps.");

  return ExtractionDraft.parse(
    withSource({ ...pantry, phases, notes: [] }, input),
  ) as Draft;
}

/**
 * Parser segments, model polishes.
 *
 * `parseRecipeText` already turns a transcript into ordered candidate steps
 * with timers — deterministically, for free, and without any reasoning. The
 * model is then asked only to rewrite each one and add the sensory fields it
 * is genuinely good at. Batched so no single response is open-ended.
 */
async function extractMethod(
  input: ExtractionInput,
  roster: string,
): Promise<Recipe["phases"]> {
  const spoken = input.cues?.map((c) => c.text).join(" ").trim() ?? "";
  const source = spoken ? `${input.text}\n\nMethod:\n${spoken}` : input.text;

  const candidates = parseRecipeText(source).phases.flatMap((p) =>
    p.steps.map((step) => ({
      ...step,
      phase: p.name,
      // Which transcript cue this line came from. Carried through enrichment
      // so a finished step can still point back into the video.
      source_ts_s: cueTimeFor(step.text, input.cues),
    })),
  );
  if (!candidates.length) return [];

  const BATCH = 8;
  const enriched: Array<{
    text: string;
    duration_s: number | null;
    temperature_c: number | null;
    vessel: string | null;
    heat: string | null;
    doneness_cue: string | null;
    hands_on: boolean;
    phase: string;
    source_ts_s: number | null;
    /** False when this is the parser's own text, kept after a failed batch. */
    rewritten: boolean;
  }> = [];

  for (let i = 0; i < candidates.length; i += BATCH) {
    const slice = candidates.slice(i, i + BATCH);
    const numbered = slice.map((c, n) => `${n + 1}. ${c.text}`).join("\n");

    let rows: unknown[] | null = null;
    try {
      const raw = extractJsonArray(
        await chat(
          [
            { role: "system", content: `${ENRICH_PROMPT}\n\n${ENRICH_HINT[input.kind ?? "video"]}` },
            { role: "user", content: `Ingredients available:\n${roster}\n\nLines:\n${numbered}` },
          ],
          { temperature: 0.1 },
        ),
      );
      rows = Array.isArray(raw) && raw.length === slice.length ? raw : null;
      if (!rows) console.warn(`[rovelle] enrich batch ${i / BATCH + 1} returned the wrong shape`);
    } catch (err) {
      console.warn(`[rovelle] enrich batch ${i / BATCH + 1} failed:`, err);
    }

    // A failed batch keeps the parser's own version of those steps. Plainer
    // English, no sensory fields, but correct — and the import survives.
    slice.forEach((c, n) => {
      const r = Array.isArray(rows?.[n]) ? (rows[n] as unknown[]) : null;
      const text = r ? asString(r[0]) : null;
      if (r && !text) return; // the model marked it as not-an-instruction
      enriched.push({
        text: text ?? c.text,
        duration_s: (r ? positiveInt(r[1]) : null) ?? c.duration_s,
        temperature_c: (r ? asNumber(r[2]) : null) ?? c.temperature_c,
        vessel: r ? asString(r[3]) : null,
        heat: r ? asString(r[4]) : null,
        doneness_cue: r ? asString(r[5]) : null,
        hands_on: r ? r[6] !== false : true,
        phase: (r ? asString(r[7]) : null) ?? c.phase,
        source_ts_s: c.source_ts_s,
        rewritten: !!text,
      });
    });
  }

  // The prompt asks for a rewrite, but a prompt is not an enforcement
  // mechanism and reproducing a creator's wording is a legal defect, not a
  // style lapse. Anything the MODEL hands back byte-identical to the source
  // line is dropped rather than shipped.
  //
  // Only the model's own output is judged. A step the model never rewrote —
  // because its batch failed — is the parser's verbatim segmentation by
  // construction, so judging it here deleted exactly the steps the fallback
  // above exists to save: one blown token budget turned a twelve-step recipe
  // into a one-step recipe, marked 'done'.
  //
  // And it only applies to somebody else's words. Text the cook pasted in
  // themselves has no creator to attribute and no phrasing to launder, so
  // dropping half of it — "bring a pot of water to the boil" is unrewritable
  // and was being deleted — costs them the recipe to solve a problem they
  // don't have.
  const echoed = enriched.filter((e) =>
    isEchoed(e.text, source, { rewritten: e.rewritten, platform: input.source.platform }),
  );
  if (echoed.length) {
    console.warn(`[rovelle] dropped ${echoed.length} step(s) returned verbatim from the source`);
    for (const e of echoed) enriched.splice(enriched.indexOf(e), 1);
  }

  // Each batch judges its phase independently, so a lone step occasionally
  // disagrees with the eight around it — "Add salt" lands in Prep halfway
  // through the tadka. Absorb single-step islands into their neighbours
  // before grouping, or Cook Mode shows a one-step phase heading mid-recipe.
  for (let i = 1; i < enriched.length - 1; i++) {
    const [before, here, after] = [enriched[i - 1], enriched[i], enriched[i + 1]];
    if (here.phase !== before.phase && before.phase === after.phase) here.phase = before.phase;
  }

  const grouped: Recipe["phases"] = [];
  let n = 0;
  for (const e of enriched) {
    const heat = e.heat && (HEATS as readonly string[]).includes(e.heat) ? e.heat : null;
    const step = newStep({
      id: `st_${++n}`,
      text: e.text,
      duration_s: e.duration_s,
      temperature_c: e.temperature_c,
      vessel: e.vessel,
      heat: heat as Recipe["phases"][number]["steps"][number]["heat"],
      doneness_cue: e.doneness_cue,
      hands_on: e.hands_on,
      source_ts_s: e.source_ts_s,
      confidence: 0.8,
    });
    const last = grouped[grouped.length - 1];
    if (last && last.name.toLowerCase() === e.phase.toLowerCase()) last.steps.push(step);
    else grouped.push({ id: `ph_${grouped.length + 1}`, name: e.phase, steps: [step] });
  }
  return grouped;
}

/**
 * Is this step the source's own wording handed back to us?
 *
 * Two things it deliberately does NOT catch, both learned the hard way:
 *
 *   - a step the model never rewrote (`rewritten: false`). Those are the
 *     parser's segmentation, kept when an enrich batch failed, and verbatim by
 *     construction. Dropping them deleted exactly what the fallback exists to
 *     save — one blown token budget turned a twelve-step recipe into a
 *     one-step recipe, saved as 'done'.
 *   - text the cook pasted in themselves. There is no creator to attribute,
 *     and "bring a large pot of salted water to a boil" cannot be reworded
 *     into something that isn't itself. Half the recipe was going in the bin
 *     to solve a problem that source doesn't have.
 */
export function isEchoed(
  text: string,
  source: string,
  ctx: { rewritten: boolean; platform: Recipe["source"]["platform"] },
): boolean {
  if (!ctx.rewritten || ctx.platform === "pasted") return false;
  const flat = (v: string) => v.toLowerCase().replace(/[^a-z0-9 ]/g, " ").replace(/\s+/g, " ").trim();
  const t = flat(text);
  return t.length > 25 && flat(source).includes(t);
}

// ——— decoders ————————————————————————————————————————————
// These ARE the schema for the compact array format the prompts ask for.
// Everything is read defensively: a model that drops a trailing null must
// degrade to a missing field, never to a thrown parse and a lost import.

const asString = (v: unknown): string | null =>
  typeof v === "string" && v.trim() ? v.trim() : null;
const asNumber = (v: unknown): number | null =>
  typeof v === "number" && Number.isFinite(v) ? v : null;
const asConfidence = (v: unknown): number => {
  const n = asNumber(v);
  return n === null ? 0.7 : Math.min(1, Math.max(0, n));
};

type PantryOut = {
  title: string;
  summary: string;
  cuisine: string | null;
  servings: { amount: number; unit: string; scalable: boolean };
  time: { prep_min: number | null; cook_min: number | null; total_min: number | null };
  difficulty: "easy" | "medium" | "involved";
  tools: string[];
  storage: string | null;
  ingredients: Array<{
    id: string;
    name: string;
    qty: number | null;
    unit: Unit | null;
    note: string | null;
    group: string;
    optional: boolean;
    confidence: number;
  }>;
};

function decodePantry(raw: unknown): PantryOut {
  const o = (raw ?? {}) as Record<string, unknown>;
  const tm = Array.isArray(o.tm) ? o.tm : [];
  const rows = Array.isArray(o.ing) ? o.ing : [];

  const ingredients = rows
    .map((row, n) => {
      const r = Array.isArray(row) ? row : [];
      const name = asString(r[0]);
      if (!name) return null;
      const unit = asString(r[2]);
      return {
        id: `ing_${n + 1}`,
        name,
        qty: asNumber(r[1]),
        // An unrecognised unit becomes null rather than failing the whole
        // document — zod would reject "grams" and we would lose everything.
        unit: unit && (Unit.options as readonly string[]).includes(unit) ? (unit as Unit) : null,
        note: asString(r[3]),
        group: asString(r[4]) ?? "main",
        optional: r[5] === true,
        confidence: asConfidence(r[6]),
      };
    })
    .filter((i): i is NonNullable<typeof i> => i !== null);

  const difficulty = asString(o.d);
  return {
    title: asString(o.t) ?? "Untitled recipe",
    summary: asString(o.s) ?? "",
    cuisine: asString(o.c),
    servings: { amount: Math.max(1, asNumber(o.sv) ?? 2), unit: "portions", scalable: true },
    time: { prep_min: asNumber(tm[0]), cook_min: asNumber(tm[1]), total_min: asNumber(tm[2]) },
    difficulty:
      difficulty === "medium" || difficulty === "involved" ? difficulty : "easy",
    tools: Array.isArray(o.tl) ? o.tl.map(asString).filter((x): x is string => !!x) : [],
    storage: asString(o.st),
    ingredients,
  };
}

const HEATS = ["low", "medium-low", "medium", "medium-high", "high"] as const;

function decodeMethod(raw: unknown): Recipe["phases"] {
  const o = (raw ?? {}) as Record<string, unknown>;
  const phases = Array.isArray(o.ph) ? o.ph : [];
  let stepN = 0;

  return phases
    .map((entry, p) => {
      const pair = Array.isArray(entry) ? entry : [];
      const name = asString(pair[0]) ?? "Cook";
      const rows = Array.isArray(pair[1]) ? pair[1] : [];

      const steps = rows
        .map((row) => {
          const r = Array.isArray(row) ? row : [];
          const text = asString(r[0]);
          if (!text) return null;
          const heat = asString(r[4]);
          stepN++;
          return newStep({
            id: `st_${stepN}`,
            text,
            duration_s: positiveInt(r[1]),
            temperature_c: asNumber(r[2]),
            vessel: asString(r[3]),
            heat: heat && (HEATS as readonly string[]).includes(heat) ? (heat as Recipe["phases"][number]["steps"][number]["heat"]) : null,
            doneness_cue: asString(r[5]),
            hands_on: r[6] !== false,
            ingredient_ids: Array.isArray(r[7])
              ? r[7].map(asString).filter((x): x is string => !!x)
              : [],
            source_ts_s: nonNegative(r[8]),
            confidence: asConfidence(r[9]),
          });
        })
        .filter((s): s is NonNullable<typeof s> => s !== null);

      return { id: `ph_${p + 1}`, name, steps };
    })
    .filter((p) => p.steps.length > 0);
}

function positiveInt(v: unknown): number | null {
  const n = asNumber(v);
  return n !== null && n > 0 ? Math.round(n) : null;
}
function nonNegative(v: unknown): number | null {
  const n = asNumber(v);
  return n !== null && n >= 0 ? Math.round(n * 100) / 100 : null;
}

/** The model doesn't get to decide attribution — we know the real source. */
function withSource(obj: Record<string, unknown>, input: ExtractionInput) {
  return {
    ...obj,
    rrf: RRF_VERSION,
    image: input.image ?? null,
    source: {
      platform: input.source.platform,
      url: input.source.url,
      handle: input.source.handle,
      creator_name: input.source.creator_name,
      captured_at: new Date().toISOString(),
      media_duration_s: input.source.media_duration_s,
    },
  };
}

// ——— deterministic ————————————————————————————————————————

function extractWithParser(input: ExtractionInput): Draft {
  // The written description carries the quantities; the transcript carries
  // the method. The parser needs both, and it only ever sees `text`.
  const spoken = input.cues?.map((c) => c.text).join(" ").trim() ?? "";
  const parsed = parseRecipeText(
    spoken ? `${input.text}\n\nMethod:\n${spoken}` : input.text,
  );

  const ingredients = parsed.ingredients.map((i, n) => ({
    id: `ing_${n + 1}`,
    name: i.name,
    qty: i.qty,
    unit: i.unit as Unit | null,
    note: i.note,
    group: i.group,
    optional: i.optional,
    // A parser reading written text is more trustworthy than one reading a
    // machine transcript. Say so, rather than pretending both are 0.95.
    confidence: round2(i.confidence * (input.cues?.length ? 0.85 : 1)),
  }));

  const byName = new Map(ingredients.map((i) => [i.name.toLowerCase(), i.id]));

  const groupOf = new Map(ingredients.map((i) => [i.id, i.group]));
  const knownGroups = [...new Set(ingredients.map((i) => i.group))].filter((g) => g !== "main");

  let stepN = 0;
  const phases = parsed.phases
    .filter((p) => p.steps.length > 0)
    .flatMap((p, pi) => {
      const built = p.steps.map((s) => {
        stepN++;
        const ingredient_ids = linkIngredients(s.text, byName);
        return {
          ...newStep({ id: `st_${stepN}`, text: s.text }),
          duration_s: s.duration_s,
          temperature_c: s.temperature_c,
          ingredient_ids,
          source_ts_s: cueTimeFor(s.text, input.cues),
          confidence: round2(s.confidence * (input.cues?.length ? 0.85 : 1)),
          // The parser reads written text; it cannot see a pan. Only the
          // model path fills vessel/heat/doneness_cue, and leaving them null
          // is the honest answer rather than a guess.
          // A step that touches only tadka ingredients is a tadka step, even
          // when the caption ran the whole method together under "Method:".
          // Tempering is its own phase, never a line in the middle of the
          // curry (TECH-SPEC §6).
          _group: componentGroup(ingredient_ids, groupOf, s.text, knownGroups),
        };
      });

      return splitByComponent(built, p.name, pi);
    });

  // Every recipe needs at least one phase to satisfy the schema. If the source
  // gave us nothing usable, say that in the step rather than shipping a stub
  // that looks like a real instruction.
  if (phases.length === 0) {
    phases.push({
      id: "ph_1",
      name: "Cook",
      steps: [
        newStep({
          id: "st_1",
          text: "No method was written out in this source. Add the steps as you cook.",
          confidence: 0,
        }),
      ],
    });
  }

  const totalStepSeconds = phases
    .flatMap((p) => p.steps)
    .reduce((a, s) => a + (s.duration_s ?? 0), 0);

  const title = clampTitle(input.titleHint ?? parsed.title ?? "Untitled recipe");

  return {
    rrf: RRF_VERSION,
    title,
    summary: "",
    cuisine: null,
    servings: { amount: parsed.servings ?? 2, unit: "portions", scalable: true },
    time: {
      prep_min: null,
      cook_min: totalStepSeconds ? Math.round(totalStepSeconds / 60) : null,
      total_min: totalStepSeconds ? Math.round(totalStepSeconds / 60) : null,
    },
    difficulty: phases.flatMap((p) => p.steps).length > 10 ? "involved" : "easy",
    source: {
      platform: input.source.platform,
      url: input.source.url,
      handle: input.source.handle,
      creator_name: input.source.creator_name,
      captured_at: new Date().toISOString(),
      media_duration_s: input.source.media_duration_s,
    },
    ingredients,
    tools: [],
    phases,
    storage: null,
    image: input.image ?? null,
    notes: [],
  };
}

type BuiltStep = Recipe["phases"][number]["steps"][number] & { _group: string | null };

/** The single non-main component a step draws on, or null if it's mixed. */
function componentGroup(
  ids: string[],
  groupOf: Map<string, string>,
  text: string,
  knownGroups: string[],
): string | null {
  // "Pour the tadka over the rasam" names the component outright, even though
  // it lists none of its ingredients. Take the step at its word.
  const named = knownGroups.find((g) => new RegExp(`\\b${escapeRe(g)}\\b`, "i").test(text));
  if (named) return named;

  if (!ids.length) return null;
  const groups = new Set(ids.map((id) => groupOf.get(id) ?? "main"));
  if (groups.size !== 1) return null;
  const [only] = [...groups];
  return only === "main" ? null : only;
}

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/**
 * Cuts a run of steps into phases wherever the component changes, so
 * "…crackle the mustard…" and "…pour the tadka over…" land under Tadka
 * instead of trailing off the end of Cook.
 */
function splitByComponent(steps: BuiltStep[], fallbackName: string, phaseIndex: number) {
  const out: Array<{ id: string; name: string; steps: Recipe["phases"][number]["steps"] }> = [];
  for (const s of steps) {
    const { _group, ...step } = s;
    const name = _group ? titleCase(_group) : fallbackName;
    const last = out[out.length - 1];
    if (last && last.name === name) last.steps.push(step);
    else out.push({ id: `ph_${phaseIndex + 1}_${out.length + 1}`, name, steps: [step] });
  }
  return out;
}

function titleCase(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

function linkIngredients(text: string, byName: Map<string, string>): string[] {
  const lower = text.toLowerCase();
  const hits: string[] = [];
  for (const [name, id] of byName) {
    // Match on the head noun so "Chicken thighs, bone-in" still links to
    // "brown the chicken".
    const head = name.split(/[,(]/)[0].trim();
    if (head.length >= 4 && lower.includes(head)) hits.push(id);
  }
  return hits.slice(0, 6);
}

function cueTimeFor(
  stepText: string,
  cues: Array<{ t: number; text: string }> | undefined,
): number | null {
  if (!cues?.length) return null;
  const words = stepText.toLowerCase().split(/\W+/).filter((w) => w.length > 4);
  if (!words.length) return null;
  let best: { t: number; score: number } | null = null;
  for (const c of cues) {
    const lower = c.text.toLowerCase();
    const score = words.filter((w) => lower.includes(w)).length;
    if (score > 0 && (!best || score > best.score)) best = { t: c.t, score };
  }
  return best ? round2(best.t) : null;
}

function clampTitle(s: string): string {
  const t = s.replace(/\s+/g, " ").trim();
  return (t.length > 90 ? `${t.slice(0, 87)}…` : t) || "Untitled recipe";
}

const round2 = (n: number) => Math.round(n * 100) / 100;

// ——— from a fetched source ——————————————————————————————————

export function inputFromFetched(f: Fetched): ExtractionInput {
  return {
    text: f.text,
    cues: f.cues,
    titleHint: f.title,
    source: {
      platform: f.platform,
      url: f.url,
      handle: f.handle,
      creator_name: f.creatorName,
      media_duration_s: f.durationS,
    },
  };
}

export { readDuration, readTemperature };
