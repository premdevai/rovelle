import { db, id, nowISO, type JobRow, type UserRow } from "./db";
import { Recipe } from "./rrf";
import { extract, inputFromFetched, EXTRACTION_VERSION, type Draft, type ExtractionInput } from "./extract";
import { fetchSource, FetchFailed, normaliseSourceUrl, detectPlatform } from "./fetchers";
import { ocr, mode, NeedsLiveError } from "./sarvam";
import { listen, mediaToolsAvailable, MediaError, snippet } from "./media";
import { slugify } from "./slug";

/**
 * The import queue.
 *
 * ponytail: the job row and the reaper are exactly as TECH-SPEC §4 specifies,
 * but the worker runs in-process — `void run(jobId)` after the POST responds.
 * A separate systemd worker exists to survive serverless timeouts; on a
 * long-lived Node server there is nothing to survive. The seam is `run()`:
 * point a real worker at the same table and delete the kick-off line.
 *
 * ponytail: single-process, so no SKIP LOCKED claim and no locked_by. Add both
 * (the SQL is in TECH-SPEC §4) the day you run two app servers.
 */

export const PHASES = [
  { key: "fetch", label: "Reading the video" },
  { key: "transcribe", label: "Listening for the steps" },
  { key: "extract", label: "Pulling out ingredients" },
  { key: "validate", label: "Building the recipe" },
] as const;

export type PhaseKey = (typeof PHASES)[number]["key"];

export const FREE_MONTHLY_IMPORTS = 5;
const CACHE_TTL_DAYS = 30;

export type JobInput = {
  url?: string;
  rawText?: string;
  /** base64 image or pdf, for the OCR path */
  imageBase64?: string;
  imageName?: string;
  language?: string;
  /** Set on a cross-user cache hit — skips fetch and extraction entirely. */
  seedDraft?: Draft;
};

export function enqueue(userId: string, input: JobInput): JobRow {
  const kind = input.url ? "import_url" : input.imageBase64 ? "import_image" : "import_text";
  const jobId = id("job");
  db()
    .prepare(
      `INSERT INTO jobs (id, user_id, kind, input, status, phase, timings, created_at)
       VALUES (?, ?, ?, ?, 'queued', 'fetch', '{}', ?)`,
    )
    .run(jobId, userId, kind, JSON.stringify(input), nowISO());
  const job = getJob(jobId)!;
  void run(jobId);
  return job;
}

export function getJob(jobId: string): JobRow | null {
  return (db().prepare("SELECT * FROM jobs WHERE id = ?").get(jobId) as JobRow | undefined) ?? null;
}

function setPhase(jobId: string, phase: PhaseKey, elapsedMs: number) {
  const job = getJob(jobId);
  if (!job) return;
  const timings = JSON.parse(job.timings) as Record<string, number>;
  timings[phase] = elapsedMs;
  db()
    .prepare("UPDATE jobs SET phase = ?, status = 'running', timings = ? WHERE id = ?")
    .run(phase, JSON.stringify(timings), jobId);
}

function fail(jobId: string, code: string) {
  db().prepare("UPDATE jobs SET status = 'failed', error = ? WHERE id = ?").run(code, jobId);
}

/** One line of the live feed (contract C2). */
export type JobEvent = { at: number; phase: string; note: string; pct?: number };

/**
 * Append-only. The worker is the only writer and it is single-process, so a
 * read-modify-write of the JSON column is safe; the day a second worker
 * exists this needs `json_insert` or its own table.
 */
export function appendEvent(jobId: string, e: Omit<JobEvent, "at">): void {
  const row = db()
    .prepare("SELECT events, created_at FROM jobs WHERE id = ?")
    .get(jobId) as { events: string; created_at: string } | undefined;
  if (!row) return;
  const events = JSON.parse(row.events) as JobEvent[];
  // `at` is milliseconds SINCE THE JOB STARTED, not a wall clock. Storing
  // Date.now() here rendered every event as "1785058585.7s" on the progress
  // screen, which is a Unix epoch wearing a stopwatch costume.
  // created_at is nowISO() — already `...Z`. Appending another one made every
  // parse NaN, which pinned every line of the live feed to "0.0s". The column
  // still defaults to datetime('now'), which is UTC with no zone marker, so
  // that form gets the Z it actually needs.
  const stamp = row.created_at.replace(" ", "T");
  const startedAt = Date.parse(/(Z|[+-]\d\d:?\d\d)$/.test(stamp) ? stamp : `${stamp}Z`);
  const at = Number.isFinite(startedAt) ? Math.max(0, Date.now() - startedAt) : 0;
  events.push({ at, ...e });
  db().prepare("UPDATE jobs SET events = ? WHERE id = ?").run(JSON.stringify(events), jobId);
}

export function readEvents(job: JobRow): JobEvent[] {
  try {
    return JSON.parse(job.events) as JobEvent[];
  } catch {
    return [];
  }
}

/**
 * URL in, extraction input out.
 *
 * Two routes, and it takes the good one when it can:
 *
 *   A. Download the audio and transcribe it (Saaras). This is the real
 *      pipeline — it hears the whole voiceover, in any language, and gives
 *      per-cue timestamps that become `source_ts_s`. Needs yt-dlp + ffmpeg
 *      on the box and a live STT budget.
 *   B. Public metadata only — oEmbed title, creator, description. Free and
 *      instant, and for caption-rich creators genuinely sufficient.
 *
 * A is tried first and B catches it. Route B is not a degraded mode to be
 * ashamed of; it is what runs when STT is mocked, and it costs nothing.
 */
async function ingestUrl(url: string, jobId: string, t0: number): Promise<ExtractionInput> {
  const canListen = mode("stt") === "live" && (await mediaToolsAvailable());

  if (canListen) {
    try {
      setPhase(jobId, "fetch", Date.now() - t0);
      let phase = "fetch";
      const listened = await listen(url, (e) => {
        // media reports the milestone; the coarse phase spine follows it.
        if (e.phase !== phase) {
          phase = e.phase;
          setPhase(jobId, e.phase as PhaseKey, Date.now() - t0);
        }
        appendEvent(jobId, e);
      });

      setPhase(jobId, "extract", Date.now() - t0);
      appendEvent(jobId, {
        phase: "extract",
        note: `Reading ${listened.cues.length} lines of transcript`,
        pct: 86,
      });

      // `text` carries the WRITTEN description and `cues` carries the spoken
      // transcript — never both in `text`. Putting the transcript in each
      // sends it to the model twice, and on a 4096-token budget that
      // duplication is the difference between a complete answer and one
      // truncated mid-array.
      // Creators put the measured recipe in one of two places and it is not
      // always the description: "full recipe in the pinned comment" is a
      // genre convention. Take both, labelled, so the model knows which is
      // written text (trustworthy quantities) and which is speech.
      const parts = [
        listened.meta.description && `--- Written description ---\n${listened.meta.description}`,
        ...listened.meta.recipeComments.map(
          (c, n) => `--- Recipe posted in a comment (${n + 1}) ---\n${c}`,
        ),
      ].filter(Boolean);
      const text = parts.join("\n\n");

      if (text.trim().length + listened.transcript.length >= 40) {
        return {
          kind: "video" as const,
          // The creator's own thumbnail, hotlinked from their platform's CDN.
          // Not copied and not re-hosted (PRD §9) — and not a stock photo
          // standing in for one, which would be a lie about the recipe.
          image: listened.meta.thumbnail,
          text,
          cues: listened.cues,
          titleHint: listened.meta.title,
          source: {
            platform: detectPlatform(url) ?? "manual",
            url,
            handle: listened.meta.uploaderId ? `@${listened.meta.uploaderId}` : null,
            creator_name: listened.meta.uploader,
            media_duration_s: listened.meta.durationS,
          },
        };
      }
    } catch (err) {
      if (err instanceof MediaError && (err.code === "TOO_LONG" || err.code === "PRIVATE")) throw err;
      console.warn("[rovelle] audio route failed, falling back to public metadata:", err);
    }
  }

  setPhase(jobId, "fetch", Date.now() - t0);
  appendEvent(jobId, { phase: "fetch", note: "Reading the public post", pct: 10 });
  const fetched = await fetchSource(url);
  setPhase(jobId, "transcribe", Date.now() - t0);
  const input = inputFromFetched(fetched);
  appendEvent(jobId, {
    phase: "transcribe",
    note: input.titleHint ? `Found: ${input.titleHint}` : "Read the caption",
    pct: 45,
  });
  setPhase(jobId, "extract", Date.now() - t0);
  appendEvent(jobId, {
    phase: "extract",
    note: `Reading ${input.text.trim().split(/\s+/).length} words of caption`,
    pct: 86,
  });
  return input;
}

/** The source had no recipe in it. Not a crash — a verdict. */
export class ThinSourceError extends Error {}

/**
 * Is there enough here to be a recipe at all?
 *
 * A 12-second Short whose entire soundtrack transcribes to "Music." and whose
 * caption is nine hashtags is not a recipe, and no amount of model time will
 * make it one. Discovering that after two 40-second Sarvam calls costs the
 * cook ninety seconds and costs us credits, and the answer at the end is
 * still "we found nothing". Decide before spending.
 */
export function tooThinToExtract(text: string, transcript: string): string | null {
  const strip = (v: string) =>
    v
      .replace(/#[\w]+/g, " ")            // hashtags carry no method
      .replace(/https?:\/\/\S+/g, " ")
      .replace(/\b(music|no audio|instrumental|applause|silence)\b/gi, " ")
      .replace(/[^\p{L}\p{N}\s]/gu, " ")
      .replace(/\s+/g, " ")
      .trim();

  const words = `${strip(text)} ${strip(transcript)}`.trim().split(/\s+/).filter(Boolean);
  if (words.length >= 25) return null;

  return words.length === 0
    ? "There's nothing to read in this one — no spoken steps and no caption."
    : `There's not enough here to build a recipe — ${words.length} usable words, no method.`;
}

/**
 * A visible pulse while a slow call is in flight.
 *
 * Sarvam-105B takes 30-50 seconds per call and says nothing while it thinks.
 * Without this the progress screen sits frozen and the cook has no way to tell
 * a working import from a dead one — which is exactly what happened on a real
 * import that stalled for 74 seconds.
 */
function heartbeat(jobId: string, phase: PhaseKey, note: string) {
  let n = 0;
  appendEvent(jobId, { phase, note });
  const id = setInterval(() => {
    n += 1;
    appendEvent(jobId, {
      phase,
      note: n === 1 ? "Still reading — the model is working through it" : `Still working (${n * 8}s)`,
    });
  }, 8000);
  return () => clearInterval(id);
}

// ——— the worker ———————————————————————————————————————————

export async function run(jobId: string): Promise<void> {
  const job = getJob(jobId);
  if (!job || job.status !== "queued") return;
  const input = JSON.parse(job.input) as JobInput & { seedDraft?: Draft };
  const t0 = Date.now();

  try {
    let draft: Draft;

    if (input.seedDraft) {
      // Cache hit — somebody already paid for this reel. Still walk the phase
      // list so S2 doesn't flicker, just at cache speed.
      for (const p of PHASES) setPhase(jobId, p.key, Date.now() - t0);
      appendEvent(jobId, { phase: "fetch", note: "We've read this one before", pct: 90 });
      draft = input.seedDraft;
    } else if (input.url) {
      const ingested = await ingestUrl(input.url, jobId, t0);
      const thin = tooThinToExtract(
        ingested.text,
        (ingested.cues ?? []).map((c) => c.text).join(" "),
      );
      if (thin) throw new ThinSourceError(thin);
      const stopUrl = heartbeat(jobId, "extract", "Reading it into a recipe");
      try {
        draft = await extract(ingested);
      } finally {
        stopUrl();
      }
    } else if (input.imageBase64) {
      setPhase(jobId, "fetch", Date.now() - t0);
      const bytes = Buffer.from(input.imageBase64, "base64");
      appendEvent(jobId, {
        phase: "fetch",
        note: `Reading ${input.imageName ?? "the page"} — ${(bytes.length / 1048576).toFixed(1)} MB`,
        pct: 10,
      });

      setPhase(jobId, "transcribe", Date.now() - t0);
      const text = await ocr(
        new Uint8Array(bytes),
        input.imageName ?? "page.png",
        input.language ?? "en-IN",
      );

      setPhase(jobId, "extract", Date.now() - t0);
      appendEvent(jobId, { phase: "extract", note: `Read: ${snippet(text)}`, pct: 60 });
      const stopOcr = heartbeat(jobId, "extract", "Reading it into a recipe");
      try {
      draft = await extract({
        text,
        kind: "photo",
        source: {
          platform: "manual",
          url: null,
          handle: null,
          creator_name: null,
          media_duration_s: null,
        },
      });
      } finally {
        stopOcr();
      }
    } else if (input.rawText) {
      setPhase(jobId, "fetch", Date.now() - t0);
      setPhase(jobId, "transcribe", Date.now() - t0);
      setPhase(jobId, "extract", Date.now() - t0);
      appendEvent(jobId, {
        phase: "extract",
        note: `Reading ${input.rawText.trim().split(/\s+/).length} words you pasted`,
        pct: 40,
      });
      const stopText = heartbeat(jobId, "extract", "Reading it into a recipe");
      try {
      draft = await extract({
        text: input.rawText,
        kind: "pasted",
        source: {
          platform: "pasted",
          url: null,
          handle: null,
          creator_name: null,
          media_duration_s: null,
        },
      });
      } finally {
        stopText();
      }
    } else {
      throw new Error("Nothing to import.");
    }

    // The first partial result worth showing: the model is done, the recipe
    // exists, and the cook can see what it found before the page turns.
    appendEvent(jobId, { phase: "extract", note: `It's ${draft.title}`, pct: 92 });
    appendEvent(jobId, {
      phase: "extract",
      note: `Found ${draft.ingredients.length} ingredients`,
      pct: 94,
    });

    setPhase(jobId, "validate", Date.now() - t0);
    appendEvent(jobId, {
      phase: "validate",
      note: `Writing ${draft.phases.reduce((n, p) => n + p.steps.length, 0)} steps`,
      pct: 96,
    });
    const recipeId = id("rcp");
    const recipe: Recipe = Recipe.parse({
      ...draft,
      id: recipeId,
      meta: {
        cooked_count: 0,
        last_cooked_at: null,
        user_edited: false,
        extraction_model: mode("extract") === "live" ? (process.env.SARVAM_CHAT_MODEL ?? "sarvam-105b") : "rovelle-parser",
        extraction_version: EXTRACTION_VERSION,
      },
    });

    const normalised = input.url ? normaliseSourceUrl(input.url) : null;
    db()
      .prepare(
        `INSERT INTO recipes (id, user_id, slug, rrf, status, source_url_normalised, created_at, updated_at)
         VALUES (?, ?, ?, ?, 'draft', ?, ?, ?)`,
      )
      .run(
        recipeId,
        job.user_id,
        uniqueSlug(job.user_id, recipe.title),
        JSON.stringify(recipe),
        normalised,
        nowISO(),
        nowISO(),
      );

    // A draft with no ingredients is a failed extraction that happens to have
    // parsed. Caching it means every future import of that URL gets served the
    // same emptiness instantly, and the cook never learns why.
    const worthCaching = draft.ingredients.length > 0;
    if (normalised && !input.seedDraft && worthCaching) {
      const expires = new Date(Date.now() + CACHE_TTL_DAYS * 86400_000).toISOString();
      db()
        .prepare(
          `INSERT INTO extraction_cache (source_url_normalised, draft, created_at, expires_at)
           VALUES (?, ?, ?, ?)
           ON CONFLICT(source_url_normalised) DO UPDATE SET draft = excluded.draft, expires_at = excluded.expires_at`,
        )
        .run(normalised, JSON.stringify(draft), nowISO(), expires);
    }

    appendEvent(jobId, { phase: "validate", note: "Recipe ready", pct: 100 });
    db()
      .prepare("UPDATE jobs SET status = 'done', result_recipe_id = ? WHERE id = ?")
      .run(recipeId, jobId);
  } catch (err) {
    const code =
      err instanceof ThinSourceError
        ? `ERROR:${err.message}`
        : err instanceof MediaError
        ? err.code === "TOO_LONG" || err.code === "NOT_INSTALLED"
          ? `ERROR:${err.message}`
          : err.code
        : err instanceof FetchFailed
        ? err.code
        : err instanceof NeedsLiveError
          ? `NEEDS_LIVE:${err.message}`
          : err instanceof Error
            ? `ERROR:${err.message}`
            : "ERROR:Unknown";
    console.error(`[rovelle] job ${jobId} failed:`, err);
    fail(jobId, code);
  }
}

// ——— cache lookup, used before spending an import ————————————

export function cachedDraft(url: string): Draft | null {
  const row = db()
    .prepare(
      "SELECT draft FROM extraction_cache WHERE source_url_normalised = ? AND expires_at > ?",
    )
    .get(normaliseSourceUrl(url), nowISO()) as { draft: string } | undefined;
  if (!row) return null;
  const draft = JSON.parse(row.draft) as Draft;
  // Defensive: an empty draft cached before the guard above existed.
  return draft.ingredients?.length ? draft : null;
}

export function uniqueSlug(userId: string, title: string): string {
  const base = slugify(title) || "recipe";
  let candidate = base;
  for (let n = 2; n < 200; n++) {
    const clash = db()
      .prepare("SELECT 1 FROM recipes WHERE user_id = ? AND slug = ?")
      .get(userId, candidate);
    if (!clash) return candidate;
    candidate = `${base}-${n}`;
  }
  return `${base}-${Date.now()}`;
}

// ——— free tier ————————————————————————————————————————————

export function importsLeft(user: UserRow): number | null {
  if (user.plan === "pro") return null;
  return Math.max(0, FREE_MONTHLY_IMPORTS - user.imports_this_period);
}

/**
 * Rolls the period over if it has elapsed, then spends one import.
 *
 * Returns the allowance left AFTER the spend (null on Pro, which is
 * unlimited), or `false` when there was nothing left. It returns the count
 * rather than a bare boolean because the caller is holding a UserRow that
 * this function has just made stale — computing "imports left" from that row
 * would report one more than the user actually has.
 */
export function spendImport(user: UserRow): number | null | false {
  const d = db();
  let used = user.imports_this_period;
  if (new Date(user.period_resets_at) < new Date()) {
    used = 0;
    d.prepare("UPDATE users SET imports_this_period = 0, period_resets_at = ? WHERE id = ?").run(
      new Date(Date.now() + 30 * 86400_000).toISOString(),
      user.id,
    );
  }
  if (user.plan === "free" && used >= FREE_MONTHLY_IMPORTS) return false;
  d.prepare("UPDATE users SET imports_this_period = ? WHERE id = ?").run(used + 1, user.id);
  return user.plan === "pro" ? null : Math.max(0, FREE_MONTHLY_IMPORTS - (used + 1));
}

/** S2 copy. Failure is a door to the paste screen, not a fire exit (XRD §5). */
export function failureCopy(raw: string | null): { message: string; fallback: string } {
  if (raw?.startsWith("NEEDS_LIVE:")) {
    return { message: raw.slice("NEEDS_LIVE:".length), fallback: "Paste the recipe text instead" };
  }
  if (raw?.startsWith("ERROR:")) {
    return { message: raw.slice("ERROR:".length), fallback: "Paste the caption or transcript instead" };
  }
  const map: Record<string, string> = {
    LOGIN_WALL: "Instagram wouldn't return this one.",
    PRIVATE: "That post is private, or it's been taken down.",
    NO_TEXT: "There's no readable speech or caption in this one.",
    NO_AUDIO: "There's no audio track in that video.",
    DOWNLOAD_FAILED: "We couldn't download that video.",
    UNSUPPORTED: "That link isn't a video we can read. Try a Reel, Short, TikTok, or YouTube link.",
    RATE_LIMITED: "The platform is throttling us right now.",
  };
  return {
    message: map[raw ?? ""] ?? "We couldn't read that video.",
    fallback: "Paste the caption or transcript instead",
  };
}

export { detectPlatform };
