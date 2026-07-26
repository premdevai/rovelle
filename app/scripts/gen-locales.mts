/**
 * Generate every Indian-language UI dictionary from the English source.
 *
 *   npm run locales           # only languages with no file yet
 *   npm run locales -- --all  # redo everything (after editing strings.ts)
 *   npm run locales -- hi ta  # just these
 *
 * Runs once, writes JSON to src/lib/i18n/generated/, and those files are
 * committed. Nothing translates at request time — a cook opening the app in
 * Tamil costs zero Sarvam credits and zero latency.
 *
 * Uses the CHAT model, not /translate. UI microcopy needs context a general
 * translation endpoint does not get: "Mark step done" is a button a cook
 * presses, and /translate rendered it into Hindi as "the step was marked" —
 * grammatical, past tense, wrong for a button. The system prompt fixes that
 * by saying what these strings are for.
 *
 * ponytail: a script, not a pipeline. Reach for a TMS on the day a human
 * translator needs to review this, and not before.
 */

import { mkdirSync, existsSync, writeFileSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT = join(HERE, "..", "src", "lib", "i18n", "generated");

// Loading .env.local by hand — this runs outside Next, which would do it for us.
for (const file of [".env.local", ".env"]) {
  const path = join(HERE, "..", file);
  if (!existsSync(path)) continue;
  for (const line of readFileSync(path, "utf8").split("\n")) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
}

const KEY = process.env.SARVAM_API_KEY;
if (!KEY) {
  console.error("SARVAM_API_KEY is not set. Put it in app/.env.local.");
  process.exit(1);
}

const { en } = await import("../src/lib/i18n/strings.js");
const { LOCALES } = await import("../src/lib/i18n/locales.js");

const args = process.argv.slice(2);
const force = args.includes("--all");
const only = args.filter((a) => !a.startsWith("--"));

/** Small batches: the model reasons before answering and the tier caps at 4096. */
const BATCH = 18;
/** Sarvam rate-limits hard on the starter tier. Pace, don't hammer. */
const PACE_MS = 1200;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const SYSTEM = (language: string) => `You localise user-interface text for a cooking app called Rovelle.

You will get a JSON array of English UI strings. Return a JSON array of the same length, in the same order, translated into ${language}. Output ONLY the JSON array. No prose, no fences.

This is INTERFACE text, not prose, and that changes how you translate:
- A button label stays an imperative the user is being asked to do. "Mark step done" is what the cook presses, not a report that something already happened.
- Keep it SHORT. These sit inside buttons and narrow columns. Shorter than the English wherever the language allows.
- Use the everyday spoken register a home cook uses, not formal or literary vocabulary.
- Keep the product name "Rovelle" and the platform names Instagram, TikTok, YouTube in Latin script, untranslated.
- Keep technical tokens untranslated: JSON, RRF, Markdown, Sarvam.
- Preserve a trailing full stop where the English has one, and keep a sentence fragment a fragment.
- For cooking words use the term a cook in that language actually says in a kitchen.`;

type Json = { choices?: Array<{ message?: { content?: string | null }; finish_reason?: string }> };

async function chat(system: string, user: string, attempt = 0): Promise<string> {
  const res = await fetch("https://api.sarvam.ai/v1/chat/completions", {
    method: "POST",
    headers: { "api-subscription-key": KEY!, "Content-Type": "application/json" },
    body: JSON.stringify({
      model: process.env.SARVAM_CHAT_MODEL ?? "sarvam-105b",
      messages: [
        { role: "system", content: system },
        { role: "user", content: user },
      ],
      temperature: 0.2,
      max_tokens: 4096,
    }),
  });

  if (res.status === 429 || res.status === 503) {
    if (attempt >= 5) throw new Error(`still rate-limited after ${attempt} retries`);
    // Exponential backoff. Without this the script silently falls back to
    // English for whole languages, which is exactly what happened first time.
    const wait = 2000 * 2 ** attempt;
    process.stdout.write(` [${res.status}, waiting ${wait / 1000}s]`);
    await sleep(wait);
    return chat(system, user, attempt + 1);
  }
  if (!res.ok) throw new Error(`${res.status} ${(await res.text()).slice(0, 160)}`);

  const json = (await res.json()) as Json;
  const text = json.choices?.[0]?.message?.content;
  if (!text) throw new Error(`empty completion (${json.choices?.[0]?.finish_reason})`);
  return text;
}

function parseArray(text: string, expected: number): string[] | null {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  const body = (fenced?.[1] ?? text).trim();
  const start = body.indexOf("[");
  const end = body.lastIndexOf("]");
  if (start === -1 || end <= start) return null;
  try {
    const arr = JSON.parse(body.slice(start, end + 1)) as unknown;
    if (!Array.isArray(arr) || arr.length !== expected) return null;
    return arr.map((v) => String(v));
  } catch {
    return null;
  }
}

mkdirSync(OUT, { recursive: true });

const entries = Object.entries(en) as [string, string][];
const targets = LOCALES.filter((l) => l.code !== "en").filter(
  (l) => only.length === 0 || only.includes(l.code),
);

if (!targets.length) {
  console.log("Nothing to do. Pass locale codes, or --all.");
  process.exit(0);
}

for (const locale of targets) {
  const file = join(OUT, `${locale.code}.json`);
  if (existsSync(file) && !force) {
    console.log(`· ${locale.code} ${locale.native} — exists, skipping (use --all to redo)`);
    continue;
  }

  const batches = Math.ceil(entries.length / BATCH);
  console.log(`\n→ ${locale.code} ${locale.native} — ${entries.length} strings, ${batches} batches`);
  const started = Date.now();
  const dict: Record<string, string> = {};
  let failed = 0;

  for (let b = 0; b < batches; b++) {
    const slice = entries.slice(b * BATCH, (b + 1) * BATCH);
    process.stdout.write(`  ${b + 1}/${batches}`);

    let out: string[] | null = null;
    for (let attempt = 0; attempt < 2 && !out; attempt++) {
      try {
        const raw = await chat(
          SYSTEM(`${locale.english} (${locale.native})`),
          JSON.stringify(slice.map(([, v]) => v)),
        );
        out = parseArray(raw, slice.length);
        if (!out) process.stdout.write(" [shape mismatch, retrying]");
      } catch (err) {
        process.stdout.write(` [${err instanceof Error ? err.message : err}]`);
      }
    }

    // A failed batch keeps English for those keys. Counted and reported below,
    // never a silently half-translated file.
    slice.forEach(([k, v], i) => {
      dict[k] = out?.[i]?.trim() || v;
      if (!out) failed++;
    });

    process.stdout.write(out ? " ok\n" : " kept English\n");
    await sleep(PACE_MS);
  }

  writeFileSync(file, `${JSON.stringify(dict, null, 2)}\n`);
  const secs = Math.round((Date.now() - started) / 1000);
  console.log(
    `  wrote ${locale.code}.json in ${secs}s` +
      (failed ? ` — ${failed} strings still English, rerun to fill them` : ""),
  );
}

console.log("\nDone.");
