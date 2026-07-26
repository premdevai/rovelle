import assert from "node:assert/strict";
import { Client, importCaption, query, signIn, type Flow } from "./harness";

/** Import, save, cook, finish — with the counter that is the north-star metric. */
export const cookFlow: Flow = {
  name: "cook — from saved recipe to a completed cook",
  run: async (ok) => {
    const c = new Client();
    await signIn(c, "cook@example.com");
    const { recipeId } = await importCaption(c);
    const rrf = (await c.get<{ rrf: Record<string, unknown> }>(`/api/recipes/${recipeId}`)).body.rrf;
    const saved = await c.patch<{ slug: string }>(`/api/recipes/${recipeId}`, {
      rrf,
      status: "saved",
    });
    assert.equal(saved.status, 200, `save answered ${saved.status}: ${saved.text}`);
    const slug = saved.body.slug;

    await ok("the recipe page renders", async () => {
      const page = await c.page(`/r/${slug}`);
      assert.equal(page.status, 200, `recipe page answered ${page.status} → ${page.location}`);
      assert.match(page.text, /Shrimp|shrimp/);
    });

    await ok("Cook Mode renders", async () => {
      const page = await c.page(`/r/${slug}/cook`);
      assert.equal(page.status, 200, `cook page answered ${page.status} → ${page.location}`);
    });

    let sessionId = "";
    await ok("a cook session starts", async () => {
      const res = await c.post<{ sessionId: string }>(`/api/recipes/${recipeId}/cook`, {
        action: "start",
        step: 0,
      });
      assert.equal(res.status, 200, `start answered ${res.status}: ${res.text}`);
      assert.ok(res.body.sessionId);
      sessionId = res.body.sessionId;
    });

    await ok("stepping through is recorded", async () => {
      for (const step of [1, 2, 3]) {
        const res = await c.post(`/api/recipes/${recipeId}/cook`, { action: "step", sessionId, step });
        assert.equal(res.status, 200, `step ${step} answered ${res.status}: ${res.text}`);
      }
    });

    await ok("completing a cook increments the counter — the north-star event", async () => {
      const res = await c.post<{ cookedCount: number }>(`/api/recipes/${recipeId}/cook`, {
        action: "complete",
        sessionId,
      });
      assert.equal(res.status, 200, `complete answered ${res.status}: ${res.text}`);
      assert.equal(res.body.cookedCount, 1);
    });

    await ok("the RRF document agrees with the column", async () => {
      const res = await c.get<{ rrf: { meta: { cooked_count: number } } }>(
        `/api/recipes/${recipeId}`,
      );
      assert.equal(res.body.rrf.meta.cooked_count, 1);
    });

    await ok("the finish screen renders", async () => {
      const page = await c.page(`/r/${slug}/cook/done`);
      assert.equal(page.status, 200, `done answered ${page.status} → ${page.location}`);
    });

    await ok("cooking somebody else's recipe is refused", async () => {
      const other = new Client();
      await signIn(other, "notyours@example.com");
      const res = await other.post(`/api/recipes/${recipeId}/cook`, { action: "start", step: 0 });
      assert.equal(res.status, 400);
      assert.match(String((res.body as { error: string }).error), /No such recipe/);
    });

    await ok("a stranger cannot walk somebody else's cook session", async () => {
      // The session id comes off the client, so a leaked or guessed one must
      // not be enough to move another cook's place in their own recipe.
      const mine = await c.post<{ sessionId: string }>(`/api/recipes/${recipeId}/cook`, {
        action: "start",
        step: 0,
      });
      const thief = new Client();
      await signIn(thief, "sessionthief@example.com");
      const theirs = await importCaption(thief);
      const res = await thief.post(`/api/recipes/${theirs.recipeId}/cook`, {
        action: "step",
        sessionId: mine.body.sessionId,
        step: 7,
      });
      // The write is scoped to the caller, so it silently matches no row.
      assert.equal(res.status, 200);
      assert.equal(
        query<{ current_step: number }>("SELECT current_step FROM cook_sessions WHERE id = ?", mine.body.sessionId)[0]
          ?.current_step,
        0,
        "another user moved this session's step",
      );
    });
  },
};

/** Cook-talk-live, grounded: it answers from the document or admits it can't. */
export const askFlow: Flow = {
  name: "ask — answers come from the recipe, never from thin air",
  run: async (ok) => {
    const c = new Client();
    await signIn(c, "ask@example.com");
    const { recipeId } = await importCaption(c);

    await ok("a stated quantity is answered from the document", async () => {
      const res = await c.post<{ answer: string; jumpToStep: number | null }>("/api/ask", {
        recipeId,
        question: "how much butter?",
        step: 0,
      });
      assert.equal(res.status, 200, `ask answered ${res.status}: ${res.text}`);
      assert.match(res.body.answer, /3|tbsp|butter/i, `unexpected answer: ${res.body.answer}`);
    });

    await ok("an unstated quantity is admitted, not invented", async () => {
      const res = await c.post<{ answer: string }>("/api/ask", {
        recipeId,
        question: "how much parsley?",
        step: 0,
      });
      assert.equal(res.status, 200);
      assert.match(
        res.body.answer,
        /never said|didn't say|to taste|handful|as much/i,
        `it should admit the gap, said: ${res.body.answer}`,
      );
      assert.doesNotMatch(res.body.answer, /^\d+\s*(g|kg|tbsp|tsp|cups?)\b/i);
    });

    await ok("navigation is understood", async () => {
      const res = await c.post<{ jumpToStep: number | null }>("/api/ask", {
        recipeId,
        question: "what's next?",
        step: 0,
      });
      assert.equal(res.body.jumpToStep, 1);
    });

    await ok("an empty question is refused rather than answered", async () => {
      const res = await c.post<{ error: string }>("/api/ask", { recipeId, question: "  " });
      assert.equal(res.status, 400);
      assert.match(res.body.error, /didn't catch that/);
    });

    await ok("asking about a recipe you don't own is refused", async () => {
      const other = new Client();
      await signIn(other, "nosy@example.com");
      const res = await other.post<{ error: string }>("/api/ask", {
        recipeId,
        question: "how much butter?",
      });
      assert.equal(res.status, 400);
      assert.match(res.body.error, /No such recipe/);
    });
  },
};

/** Notes, translation and export — everything that leaves the recipe screen. */
export const recipeExtras: Flow = {
  name: "recipe extras — notes, translation, export",
  run: async (ok) => {
    const c = new Client();
    await signIn(c, "extras@example.com");
    const { recipeId } = await importCaption(c);
    const rrf = (await c.get<{ rrf: Record<string, unknown> }>(`/api/recipes/${recipeId}`)).body.rrf;
    const slug = (await c.patch<{ slug: string }>(`/api/recipes/${recipeId}`, { rrf, status: "saved" }))
      .body.slug;

    let noteId = "";
    await ok("a note attaches to the recipe", async () => {
      const res = await c.post<{ rrf: { notes: { id: string; body: string; author: string }[] } }>(
        `/api/recipes/${recipeId}/notes`,
        { body: "Ma uses less garlic.", author: "Ma" },
      );
      assert.equal(res.status, 200, `note answered ${res.status}: ${res.text}`);
      assert.equal(res.body.rrf.notes.length, 1);
      assert.equal(res.body.rrf.notes[0].body, "Ma uses less garlic.");
      noteId = res.body.rrf.notes[0].id;
    });

    await ok("an empty note is refused", async () => {
      const res = await c.post(`/api/recipes/${recipeId}/notes`, { body: "" });
      assert.equal(res.status, 400);
    });

    await ok("markdown export reads as English and carries the note", async () => {
      const res = await c.get(`/api/export?format=md&slug=${slug}`);
      assert.equal(res.status, 200, `md export answered ${res.status}`);
      assert.match(res.text, /garlic/i);
      assert.match(res.text, /— Ma/);
      assert.match(res.text, /- Salt, to taste|to taste/, "'to taste Salt' is not a sentence");
    });

    await ok("JSON export round-trips as RRF", async () => {
      const res = await c.get(`/api/export?slug=${slug}`);
      assert.equal(res.status, 200);
      const doc = JSON.parse(res.text) as { rrf: string; title: string };
      assert.equal(doc.rrf, "1.0");
      assert.ok(doc.title);
    });

    await ok("the whole cookbook exports", async () => {
      const res = await c.get(`/api/export`);
      assert.equal(res.status, 200);
      const dump = JSON.parse(res.text) as { recipes: unknown[] };
      assert.ok(dump.recipes.length >= 1);
    });

    await ok("markdown for the whole cookbook is refused with a reason", async () => {
      const res = await c.get<{ error: string }>(`/api/export?format=md`);
      assert.equal(res.status, 400);
      assert.match(res.body.error, /JSON only/);
    });

    await ok("exporting is not open to the signed-out", async () => {
      const res = await new Client().get<{ error: string }>(`/api/export?slug=${slug}`);
      assert.equal(res.status, 401);
    });

    await ok("a mocked translation refuses instead of shipping English as Hindi", async () => {
      const res = await c.post<{ error: string }>(`/api/recipes/${recipeId}/translate`, {
        language: "hi-IN",
      });
      assert.equal(res.status, 400);
      assert.match(res.body.error, /SARVAM_MODE_TRANSLATE=live/);
    });

    await ok("English is always available", async () => {
      const res = await c.post<{ language: string }>(`/api/recipes/${recipeId}/translate`, {
        language: "en-IN",
      });
      assert.equal(res.status, 200, `translate answered ${res.status}: ${res.text}`);
      assert.equal(res.body.language, "en-IN");
    });

    await ok("a language we don't have is refused", async () => {
      const res = await c.post<{ error: string }>(`/api/recipes/${recipeId}/translate`, {
        language: "fr-FR",
      });
      assert.equal(res.status, 400);
      assert.match(res.body.error, /don't have that language/);
    });

    await ok("a note can be removed", async () => {
      const res = await c.del(`/api/recipes/${recipeId}/notes?noteId=${noteId}`);
      assert.equal(res.status, 200);
      const after = await c.get<{ rrf: { notes: unknown[] } }>(`/api/recipes/${recipeId}`);
      assert.equal(after.body.rrf.notes.length, 0);
    });

    await ok("the edit screen renders", async () => {
      const page = await c.page(`/r/${slug}/edit`);
      assert.equal(page.status, 200, `edit answered ${page.status} → ${page.location}`);
    });
  },
};
