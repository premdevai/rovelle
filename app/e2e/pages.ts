import assert from "node:assert/strict";
import { Client, importCaption, signIn, type Flow } from "./harness";

/**
 * Every route, rendered by the identity that should see it — and refused for
 * the one that shouldn't. A 500 on a page nobody tests is still a 500.
 */
export const pages: Flow = {
  name: "pages — every screen renders for the right identity",
  run: async (ok) => {
    const anon = new Client();

    await ok("the public screens are public", async () => {
      for (const path of ["/", "/enter"]) {
        const page = await anon.page(path);
        assert.equal(page.status, 200, `${path} answered ${page.status} → ${page.location}`);
      }
    });

    await ok("the account-only screens send a stranger to sign in, not to a 500", async () => {
      for (const path of ["/cookbook", "/settings"]) {
        const page = await anon.page(path);
        assert.ok(
          page.status >= 300 && page.status < 400,
          `${path} answered ${page.status}, expected a redirect`,
        );
        assert.match(String(page.location), /\/enter/, `${path} went to ${page.location}`);
      }
    });

    await ok("a recipe URL with no identity behind it goes to the hero, not a 500", async () => {
      // Not /enter: a stranger who followed a link to somebody's recipe has
      // nothing to sign in to yet. The hero is the honest destination.
      const page = await anon.page("/r/nothing-here");
      assert.ok(page.status >= 300 && page.status < 400, `answered ${page.status}`);
      assert.equal(page.location, "/");
    });

    const c = new Client();
    await signIn(c, "pages@example.com");

    await ok("a signed-in cook with an empty cookbook is sent to import, not a dashboard", async () => {
      const home = await c.page("/");
      assert.match(String(home.location), /\/import/, `home went to ${home.location}`);
      const cookbook = await c.page("/cookbook");
      assert.match(String(cookbook.location), /\/import/, `cookbook went to ${cookbook.location}`);
    });

    const { recipeId } = await importCaption(c);
    const rrf = (await c.get<{ rrf: Record<string, unknown> }>(`/api/recipes/${recipeId}`)).body.rrf;
    const slug = (await c.patch<{ slug: string }>(`/api/recipes/${recipeId}`, { rrf, status: "saved" }))
      .body.slug;

    await ok("with a recipe, every signed-in screen renders", async () => {
      for (const path of [
        "/cookbook",
        "/import",
        "/settings",
        `/r/${slug}`,
        `/r/${slug}/edit`,
        `/r/${slug}/cook`,
        `/r/${slug}/cook/done`,
      ]) {
        const page = await c.page(path);
        assert.equal(page.status, 200, `${path} answered ${page.status} → ${page.location}`);
      }
    });

    await ok("home now goes to the cookbook rather than the hero", async () => {
      const home = await c.page("/");
      assert.match(String(home.location), /\/cookbook/, `home went to ${home.location}`);
    });

    await ok("/enter is not shown to somebody already signed in", async () => {
      const page = await c.page("/enter");
      assert.ok(page.status >= 300 && page.status < 400, `enter answered ${page.status}`);
    });

    await ok("a recipe that isn't yours is not rendered", async () => {
      const other = new Client();
      await signIn(other, "stranger@example.com");
      const page = await other.page(`/r/${slug}`);
      assert.notEqual(page.status, 200, "another cook's recipe was rendered");
    });

    await ok("a job that doesn't exist redirects instead of throwing", async () => {
      const page = await c.page("/import/job_nope");
      assert.ok(page.status >= 300 && page.status < 400, `answered ${page.status}`);
      assert.match(String(page.location), /\/import/);
    });
  },
};

/** Sign in, sign out, and the two settings that persist. */
export const account: Flow = {
  name: "account — sign in, locale, sign out",
  run: async (ok) => {
    const c = new Client();

    await ok("a malformed email is refused before a code is issued", async () => {
      const res = await c.post<{ error: string }>("/api/auth", { email: "not-an-email" });
      assert.equal(res.status, 400);
      assert.match(res.body.error, /doesn't look like an email/);
    });

    await ok("a code that isn't six digits is refused", async () => {
      await c.post("/api/auth", { email: "acct@example.com" });
      const res = await c.post("/api/auth", { email: "acct@example.com", code: "12" });
      assert.equal(res.status, 400);
    });

    await ok("signing in creates the account on first use", async () => {
      const { claimed } = await signIn(c, "acct@example.com");
      assert.equal(claimed, 0, "there was no guest work to claim");
      assert.ok(c.cookie("rovelle_session"));
    });

    await ok("the same address signs back into the same account, not a new one", async () => {
      const again = new Client();
      await signIn(again, "acct@example.com");
      const page = await again.page("/settings");
      assert.equal(page.status, 200);
      assert.match(page.text, /acct@example.com/);
    });

    await ok("English declares itself as English, left to right", async () => {
      const page = await c.page("/import");
      assert.match(page.text, /<html[^>]+lang="en"/, "the document must name its language");
      assert.match(page.text, /<html[^>]+dir="ltr"/);
    });

    await ok("the UI language can be changed, and the page comes back translated", async () => {
      const res = await c.post("/api/locale", { locale: "hi" });
      assert.equal(res.status, 200, `locale answered ${res.status}: ${res.text}`);
      assert.equal(c.cookie("rovelle_locale"), "hi");
      const page = await c.page("/import");
      assert.equal(page.status, 200);
      assert.match(page.text, /[ऀ-ॿ]/, "the UI is still in English after switching");
      // lang="en" on a Hindi page is a lie a screen reader reads out loud.
      assert.match(page.text, /<html[^>]+lang="hi"/, `<html lang> did not follow the locale`);
    });

    await ok("the UI locale and a recipe's language are different settings", async () => {
      // /api/locale takes the UI code (hi); the recipe translator takes the
      // Sarvam code (hi-IN). Crossing them must not half-work.
      const res = await c.post<{ error: string }>("/api/locale", { locale: "hi-IN" });
      assert.equal(res.status, 400);
      assert.match(res.body.error, /don't speak that one/);
      assert.equal(c.cookie("rovelle_locale"), "hi", "a refusal must not clobber the setting");
    });

    await ok("a language we don't speak at all is refused", async () => {
      const res = await c.post<{ error: string }>("/api/locale", { locale: "fr" });
      assert.equal(res.status, 400);
      assert.match(res.body.error, /don't speak that one/);
    });

    await ok("Urdu comes back right-to-left, not RTL text in an LTR layout", async () => {
      assert.equal((await c.post("/api/locale", { locale: "ur" })).status, 200);
      const page = await c.page("/import");
      assert.match(page.text, /<html[^>]+lang="ur"/);
      assert.match(page.text, /<html[^>]+dir="rtl"/, "the one RTL locale must set dir");
    });

    await ok("switching back to English works", async () => {
      const res = await c.post("/api/locale", { locale: "en" });
      assert.equal(res.status, 200);
      assert.equal(c.cookie("rovelle_locale"), "en");
    });

    await ok("signing out clears the session and re-gates the cookbook", async () => {
      const res = await c.del("/api/auth");
      assert.equal(res.status, 200);
      assert.equal(c.cookie("rovelle_session"), null);
      const page = await c.page("/cookbook");
      assert.match(String(page.location), /\/enter/);
    });

    await ok("a forged session cookie is not accepted", async () => {
      const forged = new Client();
      forged.jar.set("rovelle_session", "usr_someone.1700000000000.deadbeef");
      const page = await forged.page("/cookbook");
      assert.match(String(page.location), /\/enter/, "a bad signature got through");
    });

    await ok("a forged guest cookie is not accepted either", async () => {
      const forged = new Client();
      forged.jar.set("rovelle_guest", "gst_someone.1700000000000.deadbeef");
      const res = await forged.get("/api/import/job_whatever");
      assert.equal(res.status, 401, `a forged guest got ${res.status}`);
    });
  },
};
