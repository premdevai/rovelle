import assert from "node:assert/strict";
import { Client, importCaption, signIn, type Flow } from "./harness";

/**
 * What a cook actually asks, mid-recipe, hands full.
 *
 * Every question here is one somebody says out loud at a hob, and every
 * assertion is the same two-part rule: answer from the document, or say the
 * document doesn't have it. Never a number the recipe never gave (PRD R5).
 *
 * These run against the mocked extractor on purpose. That is the path with no
 * model behind it, so anything that passes here is answered by the recipe
 * itself rather than by something willing to improvise.
 */
export const voiceCoverage: Flow = {
  name: "voice — the answerer covers what a cook actually asks",
  run: async (ok) => {
    const c = new Client();
    await signIn(c, "voice@example.com");
    const { recipeId } = await importCaption(c);

    const ask = async (question: string, step = 0) => {
      const res = await c.post<{ answer: string; jumpToStep: number | null }>("/api/ask", {
        recipeId,
        question,
        step,
      });
      assert.equal(res.status, 200, `"${question}" answered ${res.status}: ${res.text}`);
      return res.body;
    };

    /** The refusal we replaced. Seeing it again means coverage regressed. */
    const answered = (a: string, question: string) => {
      assert.doesNotMatch(
        a,
        /^I can only answer from this recipe/,
        `"${question}" fell through to the catch-all: ${a}`,
      );
      assert.ok(a.trim().length > 0, `"${question}" answered with nothing`);
    };

    await ok("what am I making", async () => {
      const { answer } = await ask("what am I making?");
      answered(answer, "what am I making");
      assert.match(answer, /shrimp|pasta/i);
    });

    await ok("quantities, stated and unstated", async () => {
      const butter = await ask("how much butter?");
      assert.match(butter.answer, /3|tbsp/i);
      const parsley = await ask("how much parsley?");
      assert.match(
        parsley.answer,
        /never said|handful|to taste/i,
        `parsley must not acquire a number: ${parsley.answer}`,
      );
    });

    await ok("the whole shopping list", async () => {
      const { answer } = await ask("what ingredients do I need?");
      assert.match(answer, /spaghetti/i);
      assert.match(answer, /garlic/i);
    });

    await ok("is there X in it — yes and no both answered", async () => {
      const yes = await ask("is there garlic in this?");
      assert.match(yes.answer, /^yes/i, `expected a yes: ${yes.answer}`);
      const no = await ask("is there coconut in this?");
      assert.match(no.answer, /\bno\b/i, `expected a no: ${no.answer}`);
      assert.doesNotMatch(no.answer, /\d/, "a no must not come with an amount");
    });

    await ok("servings, and scaling to a different table", async () => {
      const serves = await ask("how many people does this serve?");
      answered(serves.answer, "serves");
      const scaled = await ask("how much spaghetti for 8 people?");
      answered(scaled.answer, "scaling");
      assert.match(scaled.answer, /spaghetti/i);
      assert.match(scaled.answer, /\d/, "a scaled amount is arithmetic, not a refusal");
    });

    await ok("scaling never invents an amount that was never stated", async () => {
      const { answer } = await ask("how much parsley for 8 people?");
      assert.doesNotMatch(
        answer,
        /\d+\s*(g|kg|tbsp|tsp|cups?|ml)\b/i,
        `doubling nothing is still nothing: ${answer}`,
      );
    });

    await ok("timings — this step, and what's left", async () => {
      answered((await ask("how long for this step?")).answer, "how long");
      const left = await ask("how many steps left?");
      answered(left.answer, "steps left");
      assert.match(left.answer, /step/i);
    });

    await ok("total time", async () => {
      const { answer } = await ask("how long does the whole thing take?");
      answered(answer, "total time");
      assert.match(answer, /minute|hour|doesn't (say|give)/i);
    });

    await ok("temperature and heat", async () => {
      for (const q of ["what temperature?", "how hot?", "what heat should it be on?"]) {
        answered((await ask(q)).answer, q);
      }
    });

    await ok("what pan, and can I walk away", async () => {
      answered((await ask("what pan do I cook it in?")).answer, "what pan");
      answered((await ask("can I walk away?")).answer, "walk away");
    });

    await ok("how do I know it's done", async () => {
      const { answer } = await ask("how do I know it's ready?");
      answered(answer, "doneness");
    });

    await ok("substitutions are answered honestly, never invented", async () => {
      const { answer } = await ask("can I use oil instead of butter?");
      answered(answer, "substitution");
      assert.match(answer, /butter/i, "it should say what the recipe actually calls for");
      assert.match(
        answer,
        /doesn't give a substitute|doesn't cover/i,
        `a substitute must not be improvised: ${answer}`,
      );
    });

    await ok("storage, when the recipe is silent about it", async () => {
      const { answer } = await ask("how do I store the leftovers?");
      answered(answer, "storage");
      assert.match(answer, /says nothing|doesn't/i);
    });

    await ok("navigation — next, back, repeat, where am I", async () => {
      assert.equal((await ask("what's next?", 0)).jumpToStep, 1);
      assert.equal((await ask("go back", 2)).jumpToStep, 1);
      assert.equal((await ask("say that again", 3)).jumpToStep, 3);
      assert.equal((await ask("what am I doing now?", 2)).jumpToStep, 2);
    });

    await ok("my own notes come back when asked for", async () => {
      await c.post(`/api/recipes/${recipeId}/notes`, { body: "Less garlic next time.", author: "Me" });
      const { answer } = await ask("what did I write?");
      assert.match(answer, /less garlic/i);
    });

    await ok("something genuinely not in the recipe says so, and offers a way in", async () => {
      const { answer } = await ask("what wine goes with this?");
      assert.match(answer, /doesn't mention wine|only answer from this recipe/i);
      assert.doesNotMatch(answer, /\bI recommend\b|\btry a\b/i, "no improvising a pairing");
    });

    await ok("a question at the last step doesn't fall off the end", async () => {
      const last = await ask("what's next?", 99);
      assert.match(last.answer, /last step|done/i);
    });
  },
};
