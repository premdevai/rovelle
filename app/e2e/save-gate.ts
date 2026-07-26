import assert from "node:assert/strict";
import { Client, importCaption, otpFor, query, signIn, type Flow } from "./harness";

/**
 * The one interruption, and the handover behind it.
 *
 * Contract C1: a guest reaching for Save gets 401 { needsAccount: true } — a
 * shape the client turns into a sign-in sheet, not an error line.
 * Contract C3: POST /api/auth answers { ok, email, claimed }.
 *
 * The claim is the moment where losing data is unrecoverable, so this asserts
 * the work is reachable from the new account *and* gone from the old one.
 */
export const saveGate: Flow = {
  name: "save gate — the account is asked for at Save, and only at Save",
  run: async (ok) => {
    const c = new Client();
    const { recipeId } = await importCaption(c);
    const guestId = c.cookie("rovelle_guest");
    let rrf: Record<string, unknown> = {};

    await ok("saving as a guest answers contract C1, not a generic error", async () => {
      rrf = (await c.get<{ rrf: Record<string, unknown> }>(`/api/recipes/${recipeId}`)).body.rrf;
      const res = await c.patch<{ error: string; needsAccount: boolean }>(
        `/api/recipes/${recipeId}`,
        { rrf, status: "saved", userEdited: true },
      );
      assert.equal(res.status, 401);
      assert.equal(res.body.needsAccount, true, "contract C1 is the whole hinge of the flow");
      assert.ok(res.body.error.length > 0, "the sheet still needs a sentence");
    });

    await ok("the refusal did not save anything behind the cook's back", async () => {
      const after = await c.get<{ status: string }>(`/api/recipes/${recipeId}`);
      assert.equal(after.body.status, "draft");
    });

    await ok("requesting a code answers, and issues one", async () => {
      const res = await c.post<{ sent: boolean }>("/api/auth", { email: "gate@example.com" });
      assert.equal(res.status, 200);
      assert.equal(res.body.sent, true);
      assert.match(otpFor("gate@example.com"), /^\d{6}$/);
    });

    await ok("a wrong code is refused", async () => {
      const real = otpFor("gate@example.com");
      const wrong = real === "000000" ? "111111" : "000000";
      const res = await c.post<{ error: string }>("/api/auth", {
        email: "gate@example.com",
        code: wrong,
      });
      assert.equal(res.status, 400);
      assert.match(res.body.error, /wrong or has expired/);
    });

    await ok("the right code signs them in and answers contract C3", async () => {
      const res = await c.post<{ ok: boolean; email: string; claimed: number }>("/api/auth", {
        email: "gate@example.com",
        code: otpFor("gate@example.com"),
      });
      assert.equal(res.status, 200);
      assert.equal(res.body.ok, true);
      assert.equal(res.body.email, "gate@example.com");
      assert.equal(res.body.claimed, 1, "the guest's one recipe must come with them");
      assert.ok(c.cookie("rovelle_session"), "no session cookie was set");
    });

    await ok("the guest identity is retired, not left dangling", async () => {
      assert.equal(c.cookie("rovelle_guest"), null, "the guest cookie must be cleared");
      assert.equal(
        query("SELECT id FROM users WHERE id = ?", guestId!).length,
        0,
        "the guest row outlived the claim",
      );
    });

    await ok("the retried save now succeeds, with the guest's edits intact", async () => {
      const res = await c.patch<{ slug: string; status: string }>(`/api/recipes/${recipeId}`, {
        rrf,
        status: "saved",
        userEdited: true,
      });
      assert.equal(res.status, 200, `retry answered ${res.status}: ${res.text}`);
      assert.equal(res.body.status, "saved");
      assert.ok(res.body.slug);
    });

    await ok("and the recipe is in the cookbook the account can see", async () => {
      const page = await c.page("/cookbook");
      assert.equal(page.status, 200, `cookbook answered ${page.status} → ${page.location}`);
      assert.match(page.text, /Shrimp|shrimp/);
    });

    await ok("the saved recipe has its own page", async () => {
      const found = await c.get<{ slug: string }>(`/api/recipes/${recipeId}`);
      const page = await c.page(`/r/${found.body.slug}`);
      assert.equal(page.status, 200, `recipe page answered ${page.status} → ${page.location}`);
    });
  },
};

/**
 * The collision the claim must not resolve by throwing a recipe away: the
 * account already holds the slug the guest is bringing.
 */
export const claimCollision: Flow = {
  name: "save gate — a slug collision renames the arrival, loses nothing",
  run: async (ok) => {
    const owner = new Client();
    await signIn(owner, "collide@example.com");
    const first = await importCaption(owner);
    await owner.patch(`/api/recipes/${first.recipeId}`, {
      rrf: (await owner.get<{ rrf: object }>(`/api/recipes/${first.recipeId}`)).body.rrf,
      status: "saved",
    });

    const guest = new Client();
    const second = await importCaption(guest);

    await ok("signing the guest into the same account claims their work", async () => {
      const { claimed } = await signIn(guest, "collide@example.com");
      assert.equal(claimed, 1);
    });

    await ok("both recipes survive, under different slugs", async () => {
      const a = await guest.get<{ slug: string }>(`/api/recipes/${first.recipeId}`);
      const b = await guest.get<{ slug: string }>(`/api/recipes/${second.recipeId}`);
      assert.equal(a.status, 200);
      assert.equal(b.status, 200);
      assert.notEqual(a.body.slug, b.body.slug, "one recipe was silently dropped");
    });

    await ok("signing in again with nothing to claim is a no-op, not a crash", async () => {
      const again = new Client();
      const { claimed } = await signIn(again, "collide@example.com");
      assert.equal(claimed, 0);
    });
  },
};
