import assert from "node:assert/strict";
import { CAPTION, Client, awaitJob, exec, importCaption, signIn, type Flow } from "./harness";

/**
 * Every door into the app, and every wall.
 *
 * The URL door reaches the public internet, so the only URL cases asserted
 * here are the ones that never leave the process: rejection of a link we
 * can't read, and a cross-user cache hit. A live fetch belongs in
 * scripts/live-pipeline.mts, not in a suite that must pass on a plane.
 */
export const importDoors: Flow = {
  name: "import doors — link, caption, photo, and the refusals",
  run: async (ok) => {
    const c = new Client();

    await ok("an empty request names all three ways in", async () => {
      const res = await c.post<{ error: string }>("/api/import", {});
      assert.equal(res.status, 400);
      assert.match(res.body.error, /link, paste the caption, or upload a screenshot/);
    });

    await ok("a link that isn't a video is refused with the next move", async () => {
      const res = await c.post<{ error: string }>("/api/import", {
        url: "https://example.com/some-recipe",
      });
      assert.equal(res.status, 400);
      assert.match(res.body.error, /Reel, Short, TikTok, or YouTube/);
    });

    await ok("a scrap of text is refused before a job is spent on it", async () => {
      const res = await c.post<{ error: string }>("/api/import", { rawText: "dal" });
      assert.equal(res.status, 400);
      assert.match(res.body.error, /at least a caption/);
    });

    await ok("a pasted caption becomes a real recipe", async () => {
      const { recipeId } = await importCaption(c);
      const res = await c.get<{
        rrf: { title: string; ingredients: unknown[]; phases: { steps: unknown[] }[] };
      }>(`/api/recipes/${recipeId}`);
      assert.equal(res.status, 200);
      assert.match(res.body.rrf.title, /Shrimp|Pasta/i);
      assert.ok(res.body.rrf.ingredients.length >= 6, "ingredients were dropped");
      assert.ok(
        res.body.rrf.phases.flatMap((p) => p.steps).length >= 4,
        "the method did not become steps",
      );
    });

    await ok("the photo door refuses honestly when Vision is mocked", async () => {
      const signed = new Client();
      await signIn(signed, "photo@example.com");
      const started = await signed.post<{ jobId: string }>("/api/import", {
        imageBase64: Buffer.from("x".repeat(200)).toString("base64"),
        imageName: "page.png",
      });
      assert.equal(started.status, 200, `image import answered ${started.status}: ${started.text}`);
      const job = await awaitJob(signed, started.body.jobId);
      assert.equal(job.status, "failed", "a mocked OCR must fail the job, not invent a recipe");
      assert.ok(job.error, "a failed job owes the cook a sentence");
      assert.match(job.error!.message, /Vision|SARVAM_MODE_OCR|live/i);
      assert.match(job.error!.fallback, /[Pp]aste/, "failure is a door, not a fire exit");
    });
  },
};

/** The cross-user cache: a popular reel is extracted once, and is then free. */
export const importCache: Flow = {
  name: "import cache — a second cook pays nothing for the same link",
  run: async (ok) => {
    const url = "https://www.instagram.com/reel/E2ECACHED/";
    const c = new Client();
    await signIn(c, "cache@example.com");

    await ok("a seeded extraction is served without touching the network", async () => {
      // Standing in for "somebody already imported this reel" — the alternative
      // is a live Instagram fetch, which is exactly what this cache exists to
      // avoid doing twice.
      const seed = await importCaption(c);
      const { rrf } = (await c.get<{ rrf: Record<string, unknown> }>(`/api/recipes/${seed.recipeId}`))
        .body;
      // A cached draft is an RRF document without the two fields the worker
      // stamps on per import.
      const { id: _id, meta: _meta, ...draft } = rrf;
      exec(
        `INSERT INTO extraction_cache (source_url_normalised, draft, created_at, expires_at)
         VALUES (?, ?, ?, ?)
         ON CONFLICT(source_url_normalised) DO UPDATE SET draft = excluded.draft`,
        "https://instagram.com/reel/E2ECACHED",
        JSON.stringify(draft),
        new Date().toISOString(),
        new Date(Date.now() + 86400_000).toISOString(),
      );

      const before = (await c.get<{ importsLeft: number }>("/api/import")).body.importsLeft;
      const res = await c.post<{ jobId: string; cached: boolean; importsLeft: number }>(
        "/api/import",
        { url },
      );
      assert.equal(res.status, 200, `cached import answered ${res.status}: ${res.text}`);
      assert.equal(res.body.cached, true, "the cache was not consulted");
      assert.equal(res.body.importsLeft, before, "a cache hit must not cost an import");

      const job = await awaitJob(c, res.body.jobId);
      assert.equal(job.status, "done", `cached job failed: ${JSON.stringify(job.error)}`);
    });
  },
};

/** The two ceilings: one import for a guest, five a month on the free tier. */
export const importLimits: Flow = {
  name: "import limits — the guest ceiling and the free tier",
  run: async (ok) => {
    await ok("a guest gets one import, then contract C1 rather than a dead end", async () => {
      const guest = new Client();
      await importCaption(guest);
      const res = await guest.post<{ error: string; needsAccount: boolean }>("/api/import", {
        rawText: CAPTION,
      });
      assert.equal(res.status, 401);
      assert.equal(res.body.needsAccount, true, "without this the client shows an unactionable line");
      assert.match(res.body.error, /Sign in/);
    });

    await ok("signing in lifts the ceiling and the retried import goes through", async () => {
      const guest = new Client();
      await importCaption(guest);
      assert.equal(
        (await guest.post("/api/import", { rawText: CAPTION })).status,
        401,
        "precondition: the guest is out of allowance",
      );
      await signIn(guest, "lifted@example.com");
      const res = await guest.post<{ jobId: string }>("/api/import", { rawText: CAPTION });
      assert.equal(res.status, 200, `retry after sign-in answered ${res.status}: ${res.text}`);
      const job = await awaitJob(guest, res.body.jobId);
      assert.equal(job.status, "done");
    });

    await ok("the free tier stops at five, and says why", async () => {
      const c = new Client();
      await signIn(c, "fivetimes@example.com");
      for (let n = 1; n <= 5; n++) {
        const res = await c.post<{ importsLeft: number }>("/api/import", { rawText: CAPTION });
        assert.equal(res.status, 200, `import ${n} answered ${res.status}: ${res.text}`);
        assert.equal(res.body.importsLeft, 5 - n, `import ${n} left the wrong allowance`);
      }
      const sixth = await c.post<{ error: string }>("/api/import", { rawText: CAPTION });
      assert.equal(sixth.status, 400);
      assert.match(sixth.body.error, /used your 5 imports/);
      assert.match(sixth.body.error, /Cook Mode stays open/, "the cap is on importing only");
    });

    await ok("the allowance is readable without starting an import", async () => {
      const c = new Client();
      await signIn(c, "allowance@example.com");
      const res = await c.get<{ importsLeft: number; plan: string; guest: boolean }>("/api/import");
      assert.equal(res.status, 200);
      assert.equal(res.body.importsLeft, 5);
      assert.equal(res.body.plan, "free");
      assert.equal(res.body.guest, false);
    });
  },
};
