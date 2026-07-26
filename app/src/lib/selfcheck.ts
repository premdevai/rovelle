/**
 * One runnable check for the logic that would ruin someone's dinner if it
 * broke: quantity parsing, the fabrication rule, phase segmentation, the RRF
 * round-trip, and the grounded answerer.
 *
 *   npm run check
 *
 * No framework, no fixtures. Every assertion here failed at least once while
 * this was being written, which is the only justification a test needs.
 */

import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

process.env.SARVAM_MODE = "mock";
process.env.ROVELLE_DB = join(mkdtempSync(join(tmpdir(), "rovelle-")), "check.db");
process.env.ROVELLE_SECRET = "selfcheck";

async function main() {
  const { readQty, parseIngredientLine, parseRecipeText, readDuration, readTemperature, isBoilerplate } =
    await import("./parse");
  const { extract, isEchoed } = await import("./extract");
  const { Recipe, formatQty, formatDuration, formatNumber, scale, toExportJSON } = await import("./rrf");
  const { answerLocally } = await import("./ask");
  const { normaliseSourceUrl, detectPlatform, youtubeId } = await import("./fetchers");
  const { slugify } = await import("./slug");

  let checks = 0;
  const ok = (label: string, fn: () => void) => {
    fn();
    checks++;
    console.log(`  ✓ ${label}`);
  };

  // ——— quantities ————————————————————————————————————————————

  console.log("\nquantities");

  ok("plain, decimal, and unit-attached amounts", () => {
    assert.equal(readQty("2 tbsp ghee").qty, 2);
    assert.equal(readQty("2.5 kg lamb").qty, 2.5);
    assert.equal(readQty("250g paneer").qty, 250);
  });

  ok("fractions, vulgar fractions, and mixed numbers", () => {
    assert.equal(readQty("1/2 cup rice").qty, 0.5);
    assert.equal(readQty("½ tsp haldi").qty, 0.5);
    assert.equal(readQty("1 ½ cups milk").qty, 1.5);
    assert.equal(readQty("1 1/2 cups milk").qty, 1.5);
  });

  ok("a range takes the low end and drops confidence", () => {
    const r = readQty("2-3 green chillies");
    assert.equal(r.qty, 2);
    assert.ok(r.confidence < 0.75, "a range must fall below the review threshold");
  });

  ok("word numbers", () => {
    assert.equal(readQty("two onions").qty, 2);
    assert.equal(readQty("a pinch of hing").qty, 1);
  });

  ok("no stated amount stays null — never guessed", () => {
    assert.equal(readQty("fresh coriander").qty, null);
  });

  // ——— the fabrication rule (PRD R5) ————————————————————————

  console.log("\nthe fabrication rule");

  ok("'salt to taste' is a real answer, not a gap", () => {
    const i = parseIngredientLine("Salt to taste", "main");
    assert.ok(i);
    assert.equal(i.qty, null);
    assert.equal(i.unit, "to_taste");
    assert.equal(formatQty({ ...i, id: "x" }), "to taste");
  });

  ok("'oil as needed' maps to as_needed", () => {
    const i = parseIngredientLine("Oil as needed", "main");
    assert.equal(i?.unit, "as_needed");
  });

  ok("a bare ingredient gets qty null, not an invented number", () => {
    const i = parseIngredientLine("Fresh coriander", "main");
    assert.ok(i);
    assert.equal(i.qty, null);
    assert.equal(i.unit, null);
    assert.equal(formatQty({ ...i, id: "x" }), "—");
  });

  ok("no ingredient anywhere in a parse acquires a quantity the text never gave", () => {
    const text = ["Ingredients:", "Paneer", "Kasuri methi", "Salt to taste", "", "Method:", "Crumble the paneer and fry it."].join("\n");
    const parsed = parseRecipeText(text);
    for (const i of parsed.ingredients) {
      assert.equal(i.qty, null, `${i.name} was given a quantity out of nowhere`);
    }
  });

  // ——— notes, optionality, prose rejection ————————————————————

  console.log("\nline parsing");

  ok("a parenthetical becomes a note, not part of the name", () => {
    const i = parseIngredientLine("2 tbsp ghee (or butter)", "main");
    assert.equal(i?.name, "Ghee");
    assert.equal(i?.note, "or butter");
  });

  ok("a preparation clause after a comma becomes a note", () => {
    const i = parseIngredientLine("600 g chicken thighs, patted dry", "main");
    assert.equal(i?.name, "Chicken thighs");
    assert.equal(i?.note, "patted dry");
    assert.equal(i?.qty, 600);
    assert.equal(i?.unit, "g");
  });

  ok("optional is detected and stripped from the name", () => {
    const i = parseIngredientLine("1 tsp sugar (optional)", "main");
    assert.equal(i?.optional, true);
    assert.equal(i?.name, "Sugar");
  });

  ok("name-then-amount lines are read (the Indian description format)", () => {
    const i = parseIngredientLine("Masoor dal - 30gms/2.5tbsp", "main");
    assert.ok(i, "no ingredient parsed");
    assert.equal(i.name, "Masoor dal");
    assert.equal(i.qty, 30);
    assert.equal(i.unit, "g");
    const j = parseIngredientLine("Turmeric - 1/2tsp", "main");
    assert.equal(j?.qty, 0.5);
    assert.equal(j?.unit, "tsp");
  });

  ok("channel promo never becomes an ingredient", () => {
    for (const junk of [
      "Click here to Subscribe: http://bit.ly/chefkunal",
      "Website: http://www.chefkunalkapur.com/",
      "Instagram: https://www.instagram.com/chefkunal",
      "#dal #tadka",
      "Thanks for watching!",
    ]) {
      assert.equal(isBoilerplate(junk), true, `should be dropped: ${junk}`);
    }
    assert.equal(isBoilerplate("2 tbsp ghee"), false);
    assert.equal(isBoilerplate("Masoor dal - 30gms"), false);
  });

  ok("prose that happens to start with a number is not an ingredient", () => {
    assert.equal(parseIngredientLine("10 minutes later add the tomatoes and stir well", "main"), null);
  });

  // ——— times and temperatures ————————————————————————————————

  console.log("\ntimes and temperatures");

  ok("durations in seconds, minutes, hours", () => {
    assert.equal(readDuration("crackle for 30 seconds"), 30);
    assert.equal(readDuration("simmer for 12 minutes"), 720);
    assert.equal(readDuration("rest for 2 hours"), 7200);
    assert.equal(readDuration("stir well"), null);
  });

  ok("Fahrenheit is converted to Celsius", () => {
    assert.equal(readTemperature("bake at 180°C"), 180);
    assert.equal(readTemperature("bake at 350 F"), 177);
  });

  // ——— phase segmentation, the Indian-cuisine moat —————————————

  console.log("\nphase segmentation");

  const DAL = [
    "Dal Tadka",
    "",
    "Ingredients:",
    "1/2 cup toor dal",
    "2 cups water",
    "1 tsp turmeric",
    "Salt to taste",
    "",
    "For the tadka:",
    "2 tbsp ghee",
    "1 tsp cumin seeds",
    "2 dried red chillies",
    "1/4 tsp hing",
    "",
    "Method:",
    "Rinse the dal and pressure cook it with the turmeric for 12 minutes.",
    "Mash it lightly and season.",
    "Heat the ghee and crackle the cumin seeds for 30 seconds.",
    "Add the chillies and hing, then pour it over the dal.",
  ].join("\n");

  ok("a tadka is its own ingredient group, not one line", () => {
    const parsed = parseRecipeText(DAL);
    const tadka = parsed.ingredients.filter((i) => i.group === "tadka");
    assert.ok(tadka.length >= 3, `expected the tadka group to hold its own ingredients, got ${tadka.length}`);
    assert.ok(
      tadka.some((i) => /cumin/i.test(i.name)),
      "cumin seeds belong to the tadka",
    );
  });

  ok("a 'For Dal -' header names the group 'dal', not 'dal-'", () => {
    const parsed = parseRecipeText(
      ["For Dal -", "1 cup toor dal", "For Tadka -", "1 tbsp ghee"].join("\n"),
    );
    const groups = [...new Set(parsed.ingredients.map((i) => i.group))];
    assert.ok(groups.includes("dal"), `expected a "dal" group, got ${groups.join(", ")}`);
    assert.ok(groups.includes("tadka"), `expected a "tadka" group, got ${groups.join(", ")}`);
  });

  ok("whole spices keep their whole-spice name", () => {
    const parsed = parseRecipeText(DAL);
    const cumin = parsed.ingredients.find((i) => /cumin/i.test(i.name));
    assert.match(cumin!.name, /seeds/i, "'cumin seeds' must not collapse to 'cumin'");
  });

  ok("the method becomes steps with the timer attached", () => {
    const parsed = parseRecipeText(DAL);
    const steps = parsed.phases.flatMap((p) => p.steps);
    assert.ok(steps.length >= 4, `expected at least 4 steps, got ${steps.length}`);
    assert.ok(
      steps.some((s) => s.duration_s === 720),
      "the 12-minute pressure cook must become a timer",
    );
    assert.ok(
      steps.some((s) => s.duration_s === 30),
      "the 30-second crackle must become a timer",
    );
  });

  ok("presenter chatter never becomes a cooking step", () => {
    const parsed = parseRecipeText(
      [
        "Method:",
        "Hello guys, this is Kunal Kapoor.",
        "Today I will show you my favourite dal tadka.",
        "Wash the dal and pressure cook it for 12 minutes.",
        "Thanks for watching, please subscribe.",
      ].join("\n"),
    );
    const steps = parsed.phases.flatMap((p) => p.steps).map((s) => s.text);
    assert.equal(steps.length, 1, `expected only the real instruction, got: ${steps.join(" | ")}`);
    assert.match(steps[0], /wash the dal/i);
  });

  // ——— extraction → RRF ————————————————————————————————————

  console.log("\nextraction");

  const draft = await extract({
    text: DAL,
    source: {
      platform: "pasted",
      url: null,
      handle: null,
      creator_name: null,
      media_duration_s: null,
    },
  });

  const recipe = Recipe.parse({
    ...draft,
    id: "rcp_selfcheck",
    meta: {
      cooked_count: 0,
      last_cooked_at: null,
      user_edited: false,
      extraction_model: "rovelle-parser",
      extraction_version: "test",
    },
  });

  ok("the draft validates against RRF v1", () => {
    assert.equal(recipe.rrf, "1.0");
    assert.ok(recipe.phases.length >= 1);
    assert.ok(recipe.ingredients.length >= 6);
  });

  ok("the echo guard never eats a step the model didn't write", () => {
    const line = "Bring a large pot of salted water to a boil and cook the spaghetti.";
    const src = `Garlic Butter Shrimp Pasta\n${line}\nToss everything together.`;

    // A reel's caption, handed straight back: still dropped.
    assert.equal(isEchoed(line, src, { rewritten: true, platform: "instagram" }), true);

    // The same line, kept after a failed enrich batch. Dropping these is what
    // turned a twelve-step recipe into a one-step recipe.
    assert.equal(isEchoed(line, src, { rewritten: false, platform: "instagram" }), false);

    // Text the cook pasted in themselves — nobody's phrasing to launder.
    assert.equal(isEchoed(line, src, { rewritten: true, platform: "pasted" }), false);

    // A genuine rewrite survives either way.
    assert.equal(
      isEchoed("Boil salted water, then cook the pasta to al dente.", src, {
        rewritten: true,
        platform: "instagram",
      }),
      false,
    );
  });

  const jobsDb = await import("./db");
  const { appendEvent, getJob, readEvents } = await import("./jobs");

  ok("event timestamps are elapsed milliseconds, not zero", () => {
    const { db, id, nowISO } = jobsDb;
    const uid = id("usr");
    db()
      .prepare(
        "INSERT INTO users (id, email, is_guest, period_resets_at, created_at) VALUES (?,?,1,?,?)",
      )
      .run(uid, uid, nowISO(), nowISO());
    const jid = id("job");
    db()
      .prepare(
        `INSERT INTO jobs (id, user_id, kind, input, status, phase, timings, created_at)
         VALUES (?, ?, 'import_text', '{}', 'queued', 'fetch', '{}', ?)`,
      )
      // Five seconds ago, in the ISO form enqueue() actually writes.
      .run(jid, uid, new Date(Date.now() - 5000).toISOString());

    appendEvent(jid, { phase: "extract", note: "Reading it into a recipe" });
    const [e] = readEvents(getJob(jid)!);
    // A NaN parse silently collapsed to 0 and pinned every feed line to "0.0s".
    assert.ok(e.at >= 4000, `expected ~5000ms elapsed, got ${e.at}`);
  });

  ok("every step id is unique across phases", () => {
    const ids = recipe.phases.flatMap((p) => p.steps.map((s) => s.id));
    assert.equal(new Set(ids).size, ids.length, "duplicate step ids would break Cook Mode's keys");
  });

  ok("steps link to the ingredients they name", () => {
    const linked = recipe.phases.flatMap((p) => p.steps).filter((s) => s.ingredient_ids.length > 0);
    assert.ok(linked.length > 0, "no step linked to any ingredient");
  });

  ok("tadka steps become their own phase, not a line inside Cook", () => {
    const names = recipe.phases.map((p) => p.name);
    assert.ok(
      names.some((n) => /tadka/i.test(n)),
      `tempering must be its own phase, got phases: ${names.join(", ")}`,
    );
    const tadka = recipe.phases.find((p) => /tadka/i.test(p.name))!;
    assert.ok(
      tadka.steps.some((s) => /crackle|cumin/i.test(s.text)),
      "the crackling step belongs to the tadka phase",
    );
    assert.equal(
      names.filter((n) => n === "Cook").length,
      1,
      `Cook should not be split in two by the tadka, got: ${names.join(", ")}`,
    );
  });

  ok("a duration under a minute reads as seconds, not '1 min'", () => {
    assert.equal(formatDuration(30), "30 sec");
    assert.equal(formatDuration(720), "12 min");
    assert.equal(formatDuration(5400), "1 hr 30 min");
    assert.equal(formatDuration(null), null);
  });

  ok("quantities read as kitchen fractions, not decimals", () => {
    assert.equal(formatNumber(0.5), "½");
    assert.equal(formatNumber(1.5), "1½");
    assert.equal(formatNumber(1 / 3), "⅓");
    assert.equal(formatNumber(3), "3");
    assert.equal(formatNumber(2.37), "2.37", "a stated 2.37 must not be nudged to 2⅜");
    assert.equal(formatNumber(0.33), "⅓", "a scaled third should still read as a third");
  });

  ok("export round-trips byte-identically", () => {
    const json = toExportJSON(recipe);
    const back = Recipe.parse(JSON.parse(json));
    assert.equal(toExportJSON(back), json);
  });

  ok("scaling doubles real amounts and leaves 'to taste' alone", () => {
    const doubled = scale(recipe, recipe.servings.amount * 2);
    for (const [before, after] of recipe.ingredients.map(
      (i, n) => [i, doubled.ingredients[n]] as const,
    )) {
      if (before.unit === "to_taste" || before.unit === "as_needed" || before.qty === null) {
        assert.equal(after.qty, before.qty, `${before.name} must not be scaled`);
      } else {
        assert.equal(after.qty, before.qty * 2, `${before.name} should have doubled`);
      }
    }
  });

  // ——— grounded answers ————————————————————————————————————

  console.log("\ncook-talk-live");

  ok("'how much turmeric' answers from the document", () => {
    const a = answerLocally(recipe, "how much turmeric?", 0);
    assert.ok(a, "no answer at all");
    assert.match(a.text, /tsp|1/, `unexpected answer: ${a.text}`);
  });

  ok("an unstated amount is admitted, not invented", () => {
    const noQty = {
      ...recipe,
      ingredients: [
        { id: "ing_x", name: "Coriander", qty: null, unit: null, note: null, group: "main", optional: false, confidence: 1 },
      ],
    };
    const a = answerLocally(noQty, "how much coriander?", 0);
    assert.ok(a);
    assert.match(a.text, /never said|to taste/i, `it should admit the gap, said: ${a.text}`);
  });

  ok("'next' moves forward and 'back' moves back", () => {
    assert.equal(answerLocally(recipe, "what's next?", 0)?.jumpToStep, 1);
    assert.equal(answerLocally(recipe, "go back", 2)?.jumpToStep, 1);
  });

  ok("a question the recipe can't answer returns null rather than a guess", () => {
    assert.equal(answerLocally(recipe, "is this vegan for my cousin", 0), null);
  });

  // ——— urls and slugs ————————————————————————————————————————

  console.log("\nurls");

  ok("platforms are detected", () => {
    assert.equal(detectPlatform("https://www.youtube.com/watch?v=abc123"), "youtube");
    assert.equal(detectPlatform("https://youtu.be/abc123"), "youtube");
    assert.equal(detectPlatform("https://www.tiktok.com/@cook/video/123"), "tiktok");
    assert.equal(detectPlatform("https://www.instagram.com/reel/abc/"), "instagram");
    assert.equal(detectPlatform("https://example.com/recipe"), null);
  });

  ok("youtube ids come out of every url shape", () => {
    assert.equal(youtubeId("https://www.youtube.com/watch?v=dQw4w9WgXcQ"), "dQw4w9WgXcQ");
    assert.equal(youtubeId("https://youtu.be/dQw4w9WgXcQ"), "dQw4w9WgXcQ");
    assert.equal(youtubeId("https://www.youtube.com/shorts/dQw4w9WgXcQ"), "dQw4w9WgXcQ");
  });

  ok("tracking params don't defeat the cross-user cache", () => {
    assert.equal(
      normaliseSourceUrl("https://www.instagram.com/reel/ABC123/?igshid=xyz&utm_source=ig"),
      normaliseSourceUrl("https://instagram.com/reel/ABC123"),
    );
    assert.equal(
      normaliseSourceUrl("https://www.youtube.com/watch?v=abc&t=42s"),
      "https://youtube.com/watch?v=abc",
    );
  });

  ok("slugs survive Devanagari and emoji", () => {
    assert.equal(slugify("Dal Tadka 🔥"), "dal-tadka");
    assert.ok(slugify("दाल तड़का").length > 0, "a Hindi title must not slug to nothing");
  });

  // ——— store ————————————————————————————————————————————————

  console.log("\nstore");

  const { db, nowISO } = await import("./db");
  const { saveRecipe, getById, completeCook, addNote, exportAll, toMarkdown } =
    await import("./recipes");

  db()
    .prepare(
      "INSERT INTO users (id, email, plan, imports_this_period, period_resets_at) VALUES ('usr_1','a@b.c','free',0,?)",
    )
    .run(new Date(Date.now() + 86400_000).toISOString());
  db()
    .prepare(
      "INSERT INTO recipes (id, user_id, slug, rrf, status, created_at, updated_at) VALUES (?,?,?,?,'draft',?,?)",
    )
    .run("rcp_selfcheck", "usr_1", "dal-tadka", JSON.stringify(recipe), nowISO(), nowISO());

  ok("a saved recipe survives a round trip through sqlite", () => {
    const loaded = getById("usr_1", "rcp_selfcheck");
    assert.ok(loaded);
    assert.equal(loaded.rrf.title, recipe.title);
  });

  ok("user_edited latches on and never unlatches", () => {
    saveRecipe("usr_1", "rcp_selfcheck", { ...recipe, title: "My dal" }, { userEdited: true });
    assert.equal(getById("usr_1", "rcp_selfcheck")!.rrf.meta.user_edited, true);
    // A later save that doesn't claim an edit must not clear the latch.
    saveRecipe("usr_1", "rcp_selfcheck", { ...recipe, title: "My dal" }, { userEdited: false });
    assert.equal(getById("usr_1", "rcp_selfcheck")!.rrf.meta.user_edited, true);
  });

  ok("completing a cook increments the north-star counter in both places", () => {
    completeCook("usr_1", "rcp_selfcheck", null);
    const after = getById("usr_1", "rcp_selfcheck")!;
    assert.equal(after.row.cooked_count, 1);
    assert.equal(after.rrf.meta.cooked_count, 1, "the RRF document must agree with the column");
    assert.ok(after.row.last_cooked_at);
  });

  ok("notes attach and export", () => {
    addNote("usr_1", "rcp_selfcheck", "Mum uses jaggery.", "Mum");
    const md = toMarkdown(getById("usr_1", "rcp_selfcheck")!.rrf);
    assert.match(md, /jaggery/);
    assert.match(md, /— Mum/);
  });

  ok("markdown reads as English, not as field order", () => {
    const md = toMarkdown(getById("usr_1", "rcp_selfcheck")!.rrf);
    assert.match(md, /- Salt, to taste/, "'to taste Salt' is not a sentence");
    assert.match(md, /½ cup Toor dal/, "half a cup is ½, not 0.5");
  });

  ok("whole-cookbook export parses back as RRF", () => {
    const dump = JSON.parse(exportAll("usr_1")) as { recipes: unknown[] };
    assert.equal(dump.recipes.length, 1);
    Recipe.parse(dump.recipes[0]);
  });

  console.log(`\n${checks} checks passed.\n`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
