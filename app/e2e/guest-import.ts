import assert from "node:assert/strict";
import { CAPTION, Client, awaitJob, importCaption, type Flow } from "./harness";

/**
 * The mission: a signed-out visitor pastes something on the home page and gets
 * a full recipe without ever meeting a login screen.
 *
 * Every assertion here is really the same assertion — that nothing in the
 * chain answered /enter — checked at each hop, because a single redirect
 * anywhere along it ends the product for a first-time visitor.
 */
export const guestImport: Flow = {
  name: "guest import — no login screen anywhere",
  run: async (ok) => {
    const guest = new Client();

    await ok("the home page renders for a stranger, with no cookie and no redirect", async () => {
      const home = await guest.page("/");
      assert.equal(home.status, 200, `home answered ${home.status} → ${home.location}`);
      assert.match(home.text, /From saved reel/);
      assert.match(home.text, /No account needed/);
      assert.equal(guest.cookie("rovelle_guest"), null, "a page view must not mint an identity");
    });

    await ok("/import is open too — it must not bounce to /enter", async () => {
      const page = await guest.page("/import");
      assert.equal(page.status, 200, `/import answered ${page.status} → ${page.location}`);
    });

    let jobId = "";
    await ok("submitting mints the guest and starts a job", async () => {
      const res = await guest.post<{ jobId: string; importsLeft: number }>("/api/import", {
        rawText: CAPTION,
      });
      assert.equal(res.status, 200, `import answered ${res.status}: ${res.text}`);
      assert.ok(res.body.jobId);
      assert.ok(guest.cookie("rovelle_guest"), "the guest cookie is the guest's whole identity");
      assert.equal(guest.cookie("rovelle_session"), null, "no account was created");
      jobId = res.body.jobId;
    });

    await ok("the guest can poll their own job — this answered 401 before", async () => {
      const res = await guest.get(`/api/import/${jobId}`);
      assert.equal(res.status, 200, `job status answered ${res.status}: ${res.text}`);
    });

    await ok("the live stream accepts the guest instead of forcing the poll fallback", async () => {
      const res = await guest.raw(`/api/import/${jobId}/stream`);
      assert.equal(res.status, 200, "SSE must not 401 a guest");
      await res.body?.cancel();
    });

    let recipeId = "";
    await ok("the job runs to done and produces a recipe", async () => {
      const job = await awaitJob(guest, jobId);
      assert.equal(job.status, "done", `import failed: ${JSON.stringify(job.error)}`);
      assert.ok(job.recipeId);
      recipeId = job.recipeId!;
    });

    await ok("the progress screen renders for the guest, or forwards to review", async () => {
      const page = await guest.page(`/import/${jobId}`);
      assert.doesNotMatch(String(page.location ?? ""), /\/enter/, "sent the guest to a login screen");
      assert.ok(
        page.status === 200 || String(page.location).includes("/review"),
        `progress answered ${page.status} → ${page.location}`,
      );
    });

    await ok("the review screen renders the parsed recipe for the guest", async () => {
      const page = await guest.page(`/import/${jobId}/review`);
      assert.equal(page.status, 200, `review answered ${page.status} → ${page.location}`);
      assert.match(page.text, /Shrimp|shrimp/, "the recipe the guest imported is not on the page");
      assert.match(page.text, /Check it over/);
    });

    await ok("the guest owns the draft and can read it back", async () => {
      const res = await guest.get<{ rrf: { title: string; ingredients: unknown[] }; status: string }>(
        `/api/recipes/${recipeId}`,
      );
      assert.equal(res.status, 200);
      assert.equal(res.body.status, "draft");
      assert.ok(res.body.rrf.ingredients.length >= 6);
    });

    await ok("a guest may edit their draft freely — only keeping it is gated", async () => {
      const current = await guest.get<{ rrf: Record<string, unknown> }>(`/api/recipes/${recipeId}`);
      const res = await guest.patch(`/api/recipes/${recipeId}`, {
        rrf: { ...current.body.rrf, title: "Prem's shrimp pasta" },
        userEdited: true,
      });
      assert.equal(res.status, 200, `editing answered ${res.status}: ${res.text}`);
      const after = await guest.get<{ rrf: { title: string } }>(`/api/recipes/${recipeId}`);
      assert.equal(after.body.rrf.title, "Prem's shrimp pasta");
    });

    await ok("no quantity was invented anywhere in the imported recipe", async () => {
      const res = await guest.get<{
        rrf: { ingredients: { name: string; qty: number | null; unit: string | null }[] };
      }>(`/api/recipes/${recipeId}`);
      const parsley = res.body.rrf.ingredients.find((i) => /parsley/i.test(i.name));
      assert.ok(parsley, "parsley went missing");
      const pepper = res.body.rrf.ingredients.find((i) => /pepper|salt/i.test(i.name));
      assert.ok(pepper);
      assert.ok(
        pepper.qty === null,
        `"salt and pepper to taste" must not acquire a number, got ${pepper.qty}`,
      );
    });

    await ok("cancelling an import is available to a guest", async () => {
      const second = await guest.post<{ jobId: string }>("/api/import", { rawText: "x".repeat(60) });
      // The second import costs the guest's allowance, so this may be gated —
      // either answer is correct, but neither may be a 401 with no explanation.
      if (second.status === 200) {
        const res = await guest.del(`/api/import/${second.body.jobId}`);
        assert.equal(res.status, 200, `cancel answered ${res.status}: ${res.text}`);
      } else {
        assert.equal(second.status, 401);
        assert.equal((second.body as { needsAccount?: boolean }).needsAccount, true);
      }
    });
  },
};

/** A second visitor is a second identity — guests must not see each other. */
export const guestIsolation: Flow = {
  name: "guest isolation — one visitor cannot read another's import",
  run: async (ok) => {
    const a = new Client();
    const b = new Client();
    const mine = await importCaption(a);

    await ok("a different browser gets a different guest", async () => {
      await b.post("/api/import", { rawText: "y".repeat(60) });
      assert.notEqual(a.cookie("rovelle_guest"), b.cookie("rovelle_guest"));
    });

    await ok("and cannot poll the first guest's job", async () => {
      const res = await b.get(`/api/import/${mine.jobId}`);
      assert.equal(res.status, 400, `expected a refusal, got ${res.status}`);
      assert.match(String(res.body.error), /No such import/);
    });

    await ok("nor read the first guest's recipe", async () => {
      const res = await b.get(`/api/recipes/${mine.recipeId}`);
      assert.equal(res.status, 400);
      assert.match(String(res.body.error), /No such recipe/);
    });

    await ok("nor open the first guest's review screen", async () => {
      const page = await b.page(`/import/${mine.jobId}/review`);
      assert.notEqual(page.status, 200, "another visitor's draft was rendered");
    });
  },
};
