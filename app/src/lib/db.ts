import { DatabaseSync } from "node:sqlite";
import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import type { Recipe } from "./rrf";

/**
 * ponytail: node:sqlite (Node 24 stdlib) instead of Postgres + Drizzle.
 * Zero dependencies, zero migrations, one file you can copy. RRF still lives
 * as one JSON document per row, exactly as TECH-SPEC §4 specifies, so the
 * upgrade path is `CREATE TABLE ... jsonb` and swapping this module — the
 * SQL below is already portable. Move when you need more than one app server.
 */

const FILE = resolve(process.env.ROVELLE_DB ?? "./data/rovelle.db");

let _db: DatabaseSync | null = null;

export function db(): DatabaseSync {
  if (_db) return _db;
  mkdirSync(dirname(FILE), { recursive: true });
  const d = new DatabaseSync(FILE);
  d.exec("PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;");
  d.exec(SCHEMA);
  _db = d;
  return d;
}

const SCHEMA = `
CREATE TABLE IF NOT EXISTS users (
  id                  TEXT PRIMARY KEY,
  -- A guest's "email" is their guest id. Real accounts hold a real address.
  email               TEXT NOT NULL UNIQUE,
  -- 1 = anonymous visitor who has not signed up yet. Guests are real rows so
  -- that recipes, jobs and cook_sessions need no special-casing; signing up
  -- reassigns their user_id and deletes the guest row.
  is_guest            INTEGER NOT NULL DEFAULT 0,
  plan                TEXT NOT NULL DEFAULT 'free',
  imports_this_period INTEGER NOT NULL DEFAULT 0,
  period_resets_at    TEXT NOT NULL,
  locale              TEXT NOT NULL DEFAULT 'en-IN',
  created_at          TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS otps (
  email      TEXT PRIMARY KEY,
  code       TEXT NOT NULL,
  expires_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS recipes (
  id            TEXT PRIMARY KEY,
  user_id       TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  slug          TEXT NOT NULL,
  rrf           TEXT NOT NULL,               -- the whole RRF document
  status        TEXT NOT NULL DEFAULT 'draft',
  cooked_count  INTEGER NOT NULL DEFAULT 0,
  last_cooked_at TEXT,
  source_url_normalised TEXT,
  created_at    TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at    TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE UNIQUE INDEX IF NOT EXISTS recipes_user_slug_idx ON recipes(user_id, slug);
CREATE INDEX IF NOT EXISTS recipes_last_cooked_idx ON recipes(user_id, last_cooked_at);

CREATE TABLE IF NOT EXISTS jobs (
  id        TEXT PRIMARY KEY,
  user_id   TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kind      TEXT NOT NULL,                   -- import_url | import_text | import_image
  input     TEXT NOT NULL,                   -- JSON
  status    TEXT NOT NULL DEFAULT 'queued',  -- queued | running | done | failed
  phase     TEXT,                            -- fetch | transcribe | extract | validate
  timings   TEXT NOT NULL DEFAULT '{}',      -- JSON { phase: ms } — drives S2
  -- Append-only JSON array of { at, phase, note, pct }. The live processing
  -- screen replays this, so the cook sees the work rather than a spinner.
  events    TEXT NOT NULL DEFAULT '[]',
  attempts  INTEGER NOT NULL DEFAULT 0,
  error     TEXT,
  result_recipe_id TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS jobs_claim_idx ON jobs(status, created_at);

CREATE TABLE IF NOT EXISTS cook_sessions (
  id           TEXT PRIMARY KEY,
  user_id      TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  recipe_id    TEXT NOT NULL REFERENCES recipes(id) ON DELETE CASCADE,
  current_step INTEGER NOT NULL DEFAULT 0,
  started_at   TEXT NOT NULL DEFAULT (datetime('now')),
  -- Non-null == the north-star event fired. This column IS the metric.
  completed_at TEXT
);
CREATE INDEX IF NOT EXISTS cook_sessions_recipe_idx ON cook_sessions(recipe_id, started_at);

-- Translations are paid for once per (recipe, language) and then reused.
-- Sarvam credits are finite; re-translating the same recipe on every page view
-- is the easiest way to burn them for nothing.
CREATE TABLE IF NOT EXISTS translations (
  recipe_id  TEXT NOT NULL REFERENCES recipes(id) ON DELETE CASCADE,
  language   TEXT NOT NULL,
  rrf        TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (recipe_id, language)
);

-- Cross-user extraction cache. A popular reel is extracted once, not once per user.
CREATE TABLE IF NOT EXISTS extraction_cache (
  source_url_normalised TEXT PRIMARY KEY,
  draft      TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  expires_at TEXT NOT NULL
);
`;

// ——— row types ————————————————————————————————————————————

export type UserRow = {
  id: string;
  email: string;
  is_guest: number;
  plan: "free" | "pro";
  imports_this_period: number;
  period_resets_at: string;
  locale: string;
  created_at: string;
};

export type RecipeRow = {
  id: string;
  user_id: string;
  slug: string;
  rrf: string;
  status: "draft" | "saved" | "archived";
  cooked_count: number;
  last_cooked_at: string | null;
  source_url_normalised: string | null;
  created_at: string;
  updated_at: string;
};

export type JobRow = {
  id: string;
  user_id: string;
  kind: "import_url" | "import_text" | "import_image";
  input: string;
  status: "queued" | "running" | "done" | "failed";
  phase: "fetch" | "transcribe" | "extract" | "validate" | null;
  timings: string;
  events: string;
  attempts: number;
  error: string | null;
  result_recipe_id: string | null;
  created_at: string;
};

export function parseRecipe(row: RecipeRow): Recipe {
  return JSON.parse(row.rrf) as Recipe;
}

export const nowISO = () => new Date().toISOString();
export const id = (prefix: string) => `${prefix}_${crypto.randomUUID().replace(/-/g, "").slice(0, 20)}`;
