/**
 * The L4 test: a real URL, all the way through, against the live API.
 *
 *   npx tsx scripts/live-pipeline.mts <url>
 *
 * Costs roughly 8 Sarvam calls on a 100-second video — 4 STT chunks, 1 pantry
 * call, ~3 enrich batches. It is the only test that proves the product works,
 * so run it before claiming the pipeline is fine, and not much more often
 * than that.
 *
 * Prints an audit at the end. The FABRICATION line is the one that matters:
 * every other defect is a quality problem, that one is a correctness problem.
 */

import { existsSync, readFileSync } from "node:fs";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));

for (const file of [".env.local", ".env"]) {
  const path = join(HERE, "..", file);
  if (!existsSync(path)) continue;
  for (const line of readFileSync(path, "utf8").split("\n")) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
}

// This script exists to exercise the live path; force it on regardless of
// what .env.local says, so a mocked default can't quietly make it pass.
process.env.SARVAM_MODE_STT = "live";
process.env.SARVAM_MODE_EXTRACT = "live";
process.env.ROVELLE_DB = join(mkdtempSync(join(tmpdir(), "rovelle-l4-")), "l4.db");

const url = process.argv[2];
if (!url) {
  console.error("usage: npx tsx scripts/live-pipeline.mts <video-url>");
  process.exit(1);
}
if (!process.env.SARVAM_API_KEY) {
  console.error("SARVAM_API_KEY is not set. Put it in app/.env.local.");
  process.exit(1);
}

const { listen } = await import("../src/lib/media.js");
const { extract } = await import("../src/lib/extract.js");
const { Recipe, formatQty, formatDuration } = await import("../src/lib/rrf.js");
const { detectPlatform } = await import("../src/lib/fetchers.js");

const started = Date.now();

console.log("\n━━━ 1. download + transcribe ━━━");
const heard = await listen(url, (note) => console.log(`   · ${note}`));

console.log(`\n   ${heard.meta.title}`);
console.log(
  `   ${heard.meta.uploader ?? "unknown"} · ${heard.meta.durationS ?? "?"}s · ` +
    `${heard.cues.length} cues · ${heard.meta.recipeComments.length} recipe comments`,
);
console.log(`   transcript: ${heard.transcript.length} chars`);
for (const c of heard.cues.slice(0, 3)) {
  console.log(`     [${Math.round(c.t)}s] ${c.text.slice(0, 88)}`);
}

console.log("\n━━━ 2. extract ━━━");
const text = [
  heard.meta.description && `--- Written description ---\n${heard.meta.description}`,
  ...heard.meta.recipeComments.map((c, n) => `--- Recipe posted in a comment (${n + 1}) ---\n${c}`),
]
  .filter(Boolean)
  .join("\n\n");

const draft = await extract({
  text,
  cues: heard.cues,
  titleHint: heard.meta.title,
  source: {
    platform: detectPlatform(url) ?? "manual",
    url,
    handle: heard.meta.uploaderId ? `@${heard.meta.uploaderId}` : null,
    creator_name: heard.meta.uploader,
    media_duration_s: heard.meta.durationS,
  },
});

const r = Recipe.parse({
  ...draft,
  id: "rcp_l4",
  meta: {
    cooked_count: 0,
    last_cooked_at: null,
    user_edited: false,
    extraction_model: process.env.SARVAM_CHAT_MODEL ?? "sarvam-105b",
    extraction_version: "l4",
  },
});

console.log(`\n   ${r.title}`);
console.log(
  `   ${r.cuisine ?? "cuisine unstated"} · serves ${r.servings.amount} · ${r.difficulty}` +
    (r.time.total_min ? ` · ${r.time.total_min} min` : ""),
);
if (r.summary) console.log(`   ${r.summary}`);
if (r.tools.length) console.log(`   tools: ${r.tools.join(", ")}`);

console.log("\n   INGREDIENTS");
for (const i of r.ingredients) {
  const group = i.group === "main" ? "" : `  [${i.group}]`;
  console.log(`     ${formatQty(i).padStart(11)}  ${i.name}${group}`);
}

console.log("\n   METHOD");
for (const p of r.phases) {
  console.log(`   [${p.name}]`);
  for (const s of p.steps) {
    console.log(`     ${s.text}`);
    const facts = [
      formatDuration(s.duration_s),
      s.temperature_c !== null ? `${s.temperature_c}°C` : null,
      s.heat && `heat ${s.heat}`,
      s.vessel && `in ${s.vessel}`,
      s.hands_on === false && "can walk away",
      s.source_ts_s !== null ? `@${Math.round(s.source_ts_s)}s` : null,
    ].filter(Boolean);
    if (facts.length) console.log(`        ${facts.join(" · ")}`);
    if (s.doneness_cue) console.log(`        ready when: ${s.doneness_cue}`);
  }
}

// ——— audit ————————————————————————————————————————————————

const steps = r.phases.flatMap((p) => p.steps);
const haystack = `${text}\n${heard.transcript}`.toLowerCase();

// A quantity the source never mentioned anywhere is the one unacceptable
// defect. This is a heuristic — it can only prove a number IS present, not
// that it means what the model thinks — so it flags for a human, not a pass.
const unsupported = r.ingredients.filter((i) => {
  if (i.qty === null) return false;
  const forms = [String(i.qty), String(Math.round(i.qty)), i.qty.toString().replace(".", "/")];
  return !forms.some((f) => haystack.includes(f));
});

const verbatim = steps.filter((s) => {
  const t = s.text.toLowerCase().replace(/[^a-z0-9 ]/g, "").trim();
  return t.length > 25 && haystack.replace(/[^a-z0-9 ]/g, "").includes(t);
});

console.log("\n━━━ audit ━━━");
console.log(`   ingredients            ${r.ingredients.length}`);
console.log(`   unstated amounts       ${r.ingredients.filter((i) => i.qty === null).length} (blank is correct, not a bug)`);
console.log(`   steps                  ${steps.length}`);
console.log(`   with a timer           ${steps.filter((s) => s.duration_s !== null).length}`);
console.log(`   with a doneness cue    ${steps.filter((s) => s.doneness_cue).length}   <- the high-value field`);
console.log(`   with cookware          ${steps.filter((s) => s.vessel).length}`);
console.log(`   walk-away steps        ${steps.filter((s) => !s.hands_on).length}`);
console.log(`   linked to the video    ${steps.filter((s) => s.source_ts_s !== null).length}`);
console.log(`   phases                 ${r.phases.map((p) => p.name).join(" → ")}`);
console.log(`   needs review           ${r.ingredients.filter((i) => i.confidence < 0.75).length} ingredients`);

console.log(
  `\n   FABRICATION  ${
    unsupported.length === 0
      ? "clean — every amount traces to the source"
      : `${unsupported.length} SUSPECT: ${unsupported.map((i) => `${i.name}=${i.qty}${i.unit ?? ""}`).join(", ")}`
  }`,
);
console.log(
  `   VERBATIM     ${
    verbatim.length === 0
      ? "clean — all steps rewritten"
      : `${verbatim.length} STEP(S) COPIED FROM THE SOURCE — legal defect`
  }`,
);

console.log(`\n   ${Math.round((Date.now() - started) / 1000)}s total\n`);

if (unsupported.length || verbatim.length) process.exit(1);
