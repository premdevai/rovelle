import { db, id, nowISO, parseRecipe, type RecipeRow } from "./db";
import { Recipe, allSteps, formatDuration, formatNumber } from "./rrf";
import { uniqueSlug } from "./jobs";

export type RecipeListItem = {
  id: string;
  slug: string;
  title: string;
  cookedCount: number;
  lastCookedAt: string | null;
  totalMin: number | null;
  noteCount: number;
  thumbnail: string | null;
  status: RecipeRow["status"];
  createdAt: string;
};

/** Cookbook index. Default sort is last cooked — how you cook, not how you hoard. */
export function listRecipes(
  userId: string,
  opts: { q?: string; sort?: "cooked" | "added" | "title" } = {},
): RecipeListItem[] {
  const rows = db()
    .prepare("SELECT * FROM recipes WHERE user_id = ? AND status != 'archived'")
    .all(userId) as RecipeRow[];

  const q = opts.q?.trim().toLowerCase();
  const items = rows
    .map((r) => {
      const rrf = parseRecipe(r);
      return {
        id: r.id,
        slug: r.slug,
        title: rrf.title,
        cookedCount: r.cooked_count,
        lastCookedAt: r.last_cooked_at,
        totalMin: rrf.time.total_min,
        noteCount: rrf.notes.length,
        thumbnail: rrf.image ?? null,
        status: r.status,
        createdAt: r.created_at,
        // Kept off the returned type — only used for the search filter below.
        _haystack: `${rrf.title} ${rrf.summary} ${rrf.ingredients.map((i) => i.name).join(" ")} ${rrf.source.handle ?? ""}`.toLowerCase(),
      };
    })
    .filter((r) => !q || r._haystack.includes(q));

  const sort = opts.sort ?? "cooked";
  items.sort((a, b) => {
    if (sort === "title") return a.title.localeCompare(b.title);
    if (sort === "added") return b.createdAt.localeCompare(a.createdAt);
    // last cooked, never-cooked last, newest-added as the tiebreak
    if (a.lastCookedAt && b.lastCookedAt) return b.lastCookedAt.localeCompare(a.lastCookedAt);
    if (a.lastCookedAt) return -1;
    if (b.lastCookedAt) return 1;
    return b.createdAt.localeCompare(a.createdAt);
  });

  return items.map(({ _haystack, ...rest }) => rest);
}

export function getBySlug(userId: string, slug: string): { row: RecipeRow; rrf: Recipe } | null {
  const row = db()
    .prepare("SELECT * FROM recipes WHERE user_id = ? AND slug = ?")
    .get(userId, slug) as RecipeRow | undefined;
  return row ? { row, rrf: parseRecipe(row) } : null;
}

export function getById(userId: string, recipeId: string): { row: RecipeRow; rrf: Recipe } | null {
  const row = db()
    .prepare("SELECT * FROM recipes WHERE user_id = ? AND id = ?")
    .get(userId, recipeId) as RecipeRow | undefined;
  return row ? { row, rrf: parseRecipe(row) } : null;
}

/**
 * Writes a user-authored version of the recipe.
 *
 * Sets meta.user_edited, which is a one-way latch: after this, no automated
 * process is allowed to write to the document (TECH-SPEC §3 invariant 3).
 * The cook's version wins, permanently.
 */
export function saveRecipe(
  userId: string,
  recipeId: string,
  next: Recipe,
  opts: { userEdited?: boolean; status?: RecipeRow["status"] } = {},
): Recipe {
  const current = getById(userId, recipeId);
  if (!current) throw new Error("No such recipe.");

  const merged = Recipe.parse({
    ...next,
    id: recipeId,
    meta: {
      ...current.rrf.meta,
      ...next.meta,
      cooked_count: current.row.cooked_count,
      last_cooked_at: current.row.last_cooked_at,
      user_edited: current.rrf.meta.user_edited || (opts.userEdited ?? false),
    },
  });

  const titleChanged = merged.title !== current.rrf.title;
  const slug = titleChanged && current.row.status === "draft"
    ? uniqueSlug(userId, merged.title)
    : current.row.slug;

  db()
    .prepare(
      "UPDATE recipes SET rrf = ?, slug = ?, status = ?, updated_at = ? WHERE id = ? AND user_id = ?",
    )
    .run(
      JSON.stringify(merged),
      slug,
      opts.status ?? current.row.status,
      nowISO(),
      recipeId,
      userId,
    );

  return merged;
}

export function deleteRecipe(userId: string, recipeId: string) {
  db().prepare("DELETE FROM recipes WHERE id = ? AND user_id = ?").run(recipeId, userId);
}

// ——— cooking ———————————————————————————————————————————————

export function startCookSession(userId: string, recipeId: string, step = 0): string {
  const sessionId = id("cook");
  db()
    .prepare(
      "INSERT INTO cook_sessions (id, user_id, recipe_id, current_step, started_at) VALUES (?, ?, ?, ?, ?)",
    )
    .run(sessionId, userId, recipeId, step, nowISO());
  return sessionId;
}

/**
 * The session id comes off the client, so ownership is checked here rather
 * than assumed. Without the user_id clause anyone signed in could walk a
 * stranger's cook session by guessing an id.
 */
export function updateCookStep(userId: string, sessionId: string, step: number) {
  db()
    .prepare("UPDATE cook_sessions SET current_step = ? WHERE id = ? AND user_id = ?")
    .run(step, sessionId, userId);
}

/**
 * The north-star event. Everything else in this product is upstream of this
 * one write: a cook finished a recipe (PRD §3).
 */
export function completeCook(userId: string, recipeId: string, sessionId: string | null) {
  const d = db();
  const at = nowISO();
  if (sessionId) {
    d.prepare("UPDATE cook_sessions SET completed_at = ? WHERE id = ? AND user_id = ?").run(
      at,
      sessionId,
      userId,
    );
  }
  d.prepare(
    "UPDATE recipes SET cooked_count = cooked_count + 1, last_cooked_at = ?, updated_at = ? WHERE id = ? AND user_id = ?",
  ).run(at, at, recipeId, userId);

  // Re-read AFTER the UPDATE above, so the row already carries the new count.
  // Adding one here again would put the document a cook ahead of the column.
  const found = getById(userId, recipeId);
  if (!found) return;
  const rrf = {
    ...found.rrf,
    meta: { ...found.rrf.meta, cooked_count: found.row.cooked_count, last_cooked_at: at },
  };
  d.prepare("UPDATE recipes SET rrf = ? WHERE id = ?").run(JSON.stringify(rrf), recipeId);
  console.log(`[rovelle] recipe_cook_completed recipe=${recipeId} user=${userId}`);
}

/** The emotional payload. A recipe with a note is unreplaceable (XRD §4 S7). */
export function addNote(userId: string, recipeId: string, body: string, author: string | null) {
  const found = getById(userId, recipeId);
  if (!found) throw new Error("No such recipe.");
  const rrf: Recipe = {
    ...found.rrf,
    notes: [
      ...found.rrf.notes,
      { id: id("nt"), body: body.trim(), author: author?.trim() || null, created_at: nowISO() },
    ],
  };
  db()
    .prepare("UPDATE recipes SET rrf = ?, updated_at = ? WHERE id = ? AND user_id = ?")
    .run(JSON.stringify(rrf), nowISO(), recipeId, userId);
  return rrf;
}

export function deleteNote(userId: string, recipeId: string, noteId: string) {
  const found = getById(userId, recipeId);
  if (!found) return;
  const rrf: Recipe = { ...found.rrf, notes: found.rrf.notes.filter((n) => n.id !== noteId) };
  db()
    .prepare("UPDATE recipes SET rrf = ?, updated_at = ? WHERE id = ? AND user_id = ?")
    .run(JSON.stringify(rrf), nowISO(), recipeId, userId);
}

// ——— stats & export ————————————————————————————————————————

export function cookbookStats(userId: string) {
  const rows = db()
    .prepare("SELECT * FROM recipes WHERE user_id = ? AND status != 'archived'")
    .all(userId) as RecipeRow[];
  const notes = rows.reduce((a, r) => a + parseRecipe(r).notes.length, 0);
  const cooked = rows.reduce((a, r) => a + r.cooked_count, 0);
  return { recipes: rows.length, notes, cooked };
}

/** Export is JSON.stringify. No transform, no lossy path (TECH-SPEC §3). */
export function exportAll(userId: string): string {
  const rows = db()
    .prepare("SELECT * FROM recipes WHERE user_id = ? ORDER BY created_at")
    .all(userId) as RecipeRow[];
  return JSON.stringify(
    { rrf: "1.0", exported_at: nowISO(), recipes: rows.map(parseRecipe) },
    null,
    2,
  );
}

export function toMarkdown(r: Recipe): string {
  // "Salt, to taste" — not "to taste Salt". An amount that is a phrase goes
  // after the name; a numeric one goes before it.
  const before = (n: number | null, u: string | null) => {
    if (u === "to_taste" || u === "as_needed" || n === null) return "";
    return u ? `${formatNumber(n)} ${u} ` : `${formatNumber(n)} `;
  };
  const after = (u: string | null) =>
    u === "to_taste" ? ", to taste" : u === "as_needed" ? ", as needed" : "";
  const lines: string[] = [`# ${r.title}`, ""];
  if (r.summary) lines.push(r.summary, "");
  lines.push(
    `Serves ${r.servings.amount} ${r.servings.unit}` +
      (r.time.total_min ? ` · ${r.time.total_min} min` : "") +
      ` · ${r.difficulty}`,
    "",
    "## Ingredients",
    "",
  );

  const groups = [...new Set(r.ingredients.map((i) => i.group))];
  for (const g of groups) {
    if (groups.length > 1) lines.push(`**${g}**`, "");
    for (const i of r.ingredients.filter((x) => x.group === g)) {
      lines.push(
        `- ${before(i.qty, i.unit)}${i.name}${after(i.unit)}` +
          (i.note ? ` (${i.note})` : "") +
          (i.optional ? " — optional" : ""),
      );
    }
    lines.push("");
  }

  for (const p of r.phases) {
    lines.push(`## ${p.name}`, "");
    p.steps.forEach((s, n) => {
      const bits = [
        formatDuration(s.duration_s),
        s.temperature_c !== null ? `${s.temperature_c} °C` : null,
      ].filter(Boolean);
      lines.push(`${n + 1}. ${s.text}${bits.length ? ` _(${bits.join(" · ")})_` : ""}`);
    });
    lines.push("");
  }

  if (r.storage) lines.push("## Storage", "", r.storage, "");
  if (r.notes.length) {
    lines.push("## Notes", "");
    for (const n of r.notes) lines.push(`> ${n.body}${n.author ? ` — ${n.author}` : ""}`, "");
  }
  if (r.source.url) {
    lines.push("---", "", `Source: ${r.source.handle ?? r.source.platform} — ${r.source.url}`);
  }
  return lines.join("\n");
}

export { allSteps };
