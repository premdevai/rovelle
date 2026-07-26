/**
 * The handover, checked.
 *
 * A guest signing up is the one moment where losing data is unrecoverable —
 * the guest cookie is gone, the guest row is gone, and there is no second
 * chance to reassign. So every branch of it is asserted here, including the
 * slug collision that a naive UPDATE would resolve by throwing a recipe away.
 *
 *   npx tsx src/lib/guest-check.ts
 */

import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

process.env.SARVAM_MODE = "mock";
process.env.ROVELLE_DB = join(mkdtempSync(join(tmpdir(), "rovelle-guest-")), "check.db");
process.env.ROVELLE_SECRET = "guest-check";

async function main() {
  const { db, id, nowISO } = await import("./db");
  const { claimGuestWork, createGuestRow, isGuest, GUEST_IMPORTS } = await import("./guest");
  const { addNote, completeCook, getById, startCookSession } = await import("./recipes");
  const { extract } = await import("./extract");
  const { Recipe } = await import("./rrf");

  let checks = 0;
  const ok = (label: string, fn: () => void) => {
    fn();
    checks++;
    console.log(`  ✓ ${label}`);
  };

  const draft = await extract({
    text: "Dal Tadka\n\n1 cup toor dal\nSalt to taste\n\nMethod:\nBoil the dal for 12 minutes.",
    source: { platform: "pasted", url: null, handle: null, creator_name: null, media_duration_s: null },
  });

  const putRecipe = (userId: string, slug: string) => {
    const rid = id("rcp");
    const rrf = Recipe.parse({
      ...draft,
      id: rid,
      meta: {
        cooked_count: 0,
        last_cooked_at: null,
        user_edited: false,
        extraction_model: "rovelle-parser",
        extraction_version: "guest-check",
      },
    });
    db()
      .prepare(
        `INSERT INTO recipes (id, user_id, slug, rrf, status, created_at, updated_at)
         VALUES (?, ?, ?, ?, 'draft', ?, ?)`,
      )
      .run(rid, userId, slug, JSON.stringify(rrf), nowISO(), nowISO());
    return rid;
  };

  // The real account, already holding the slug the guest is about to bring.
  const REAL = "usr_real";
  db()
    .prepare(
      "INSERT INTO users (id, email, plan, imports_this_period, period_resets_at) VALUES (?, 'cook@example.com', 'free', 0, ?)",
    )
    .run(REAL, new Date(Date.now() + 86400_000).toISOString());
  const realRecipeId = putRecipe(REAL, "dal-tadka");

  // ——— the guest ————————————————————————————————————————————

  console.log("\nthe guest");

  const guest = createGuestRow();

  ok("a guest is a real users row flagged is_guest = 1", () => {
    assert.equal(guest.is_guest, 1);
    assert.ok(isGuest(guest));
    assert.match(guest.id, /^gst_/);
    assert.equal(guest.email, guest.id, "the guest id doubles as the NOT NULL UNIQUE email");
    assert.equal(guest.plan, "free");
    assert.ok(new Date(guest.period_resets_at) > new Date(), "a guest needs a live period");
    assert.equal(GUEST_IMPORTS, 1);
  });

  const guestRecipeId = putRecipe(guest.id, "dal-tadka");

  ok("a guest owns their draft, no account required", () => {
    const found = getById(guest.id, guestRecipeId);
    assert.ok(found, "the guest must be able to read back their own draft");
    assert.equal(found.row.status, "draft");
  });

  // Everything a guest can do before signing up: cook it, and write on it.
  const sessionId = startCookSession(guest.id, guestRecipeId, 0);
  completeCook(guest.id, guestRecipeId, sessionId);
  addNote(guest.id, guestRecipeId, "Ma uses less haldi.", "Ma");

  const jobId = id("job");
  db()
    .prepare(
      `INSERT INTO jobs (id, user_id, kind, input, status, created_at) VALUES (?, ?, 'import_text', '{}', 'done', ?)`,
    )
    .run(jobId, guest.id, nowISO());

  // ——— the handover ——————————————————————————————————————————

  console.log("\nthe handover");

  const moved = await claimGuestWork(guest.id, REAL);

  ok("the claim moves recipes, jobs and cook sessions together", () => {
    assert.equal(moved, 1, "claimGuestWork reports the recipes it moved");
    assert.ok(getById(REAL, guestRecipeId), "the recipe now belongs to the real account");
    assert.equal(
      (db().prepare("SELECT user_id FROM jobs WHERE id = ?").get(jobId) as { user_id: string }).user_id,
      REAL,
    );
    assert.equal(
      (
        db().prepare("SELECT user_id FROM cook_sessions WHERE id = ?").get(sessionId) as {
          user_id: string;
        }
      ).user_id,
      REAL,
    );
  });

  ok("the guest row is gone afterwards", () => {
    assert.equal(db().prepare("SELECT 1 FROM users WHERE id = ?").get(guest.id), undefined);
  });

  ok("a slug collision renames the arrival — nothing is dropped", () => {
    const arrived = getById(REAL, guestRecipeId)!;
    const incumbent = getById(REAL, realRecipeId)!;
    assert.equal(incumbent.row.slug, "dal-tadka", "the recipe already there keeps its slug");
    assert.equal(arrived.row.slug, "dal-tadka-2");
    assert.equal(
      (db().prepare("SELECT COUNT(*) c FROM recipes WHERE user_id = ?").get(REAL) as { c: number }).c,
      2,
      "both recipes survive the claim",
    );
  });

  ok("cooked count and notes cross intact", () => {
    const arrived = getById(REAL, guestRecipeId)!;
    assert.equal(arrived.row.cooked_count, 1);
    assert.equal(arrived.rrf.meta.cooked_count, 1);
    assert.ok(arrived.row.last_cooked_at);
    assert.equal(arrived.rrf.notes.length, 1);
    assert.equal(arrived.rrf.notes[0].body, "Ma uses less haldi.");
    assert.equal(arrived.rrf.notes[0].author, "Ma");
  });

  // The sign-in POST can be retried; the guest is already gone by then.
  const replay = await claimGuestWork(guest.id, REAL);
  ok("claiming twice is a no-op, not a crash", () => assert.equal(replay, 0));

  console.log(`\n${checks} checks passed.\n`);
}

main().catch((e) => {
  // node:sqlite errors carry properties that util.inspect chokes on, and a
  // crash inside the crash handler tells you nothing about the failure.
  console.error(e instanceof Error ? (e.stack ?? e.message) : e);
  process.exit(1);
});
