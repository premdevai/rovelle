import { spawn } from "node:child_process";
import { mkdtemp, readdir, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { transcribe } from "./sarvam";

/**
 * Download the video, listen to it, hand back a timestamped transcript.
 *
 * This is the real ingest path: a public URL in, the creator's actual spoken
 * words out, in English, regardless of what language they were speaking.
 * Captions were never going to be enough — most reels have no caption worth
 * reading and the recipe lives entirely in the voiceover.
 *
 * Legal posture (PRD §9): media is transient. It lands in a temp directory,
 * gets converted to audio, gets transcribed, and is deleted in a `finally`.
 * Nothing is re-hosted and no video ever reaches disk outside that window.
 */

const YTDLP = process.env.YTDLP_PATH ?? "yt-dlp";
const FFMPEG = process.env.FFMPEG_PATH ?? "ffmpeg";

/** Sarvam's sync STT refuses anything over 30s, so that's the chunk size. */
const CHUNK_S = 28;
/** ~20 minutes of audio. Past this, the credit cost stops being reasonable. */
const MAX_CHUNKS = Number(process.env.ROVELLE_MAX_CHUNKS ?? 44);
/** Sarvam rate-limits; four in flight is fast without tripping 429s. */
const CONCURRENCY = 4;

export type MediaMeta = {
  title: string | null;
  uploader: string | null;
  uploaderId: string | null;
  description: string | null;
  /** Comments that look like a recipe, best first. Often the real method. */
  recipeComments: string[];
  durationS: number | null;
  thumbnail: string | null;
};

export type Cue = { t: number; text: string };

/**
 * Progress out of the audio path. Structurally the job-event shape from
 * jobs.ts minus `at` — matched, not imported, because jobs.ts imports this
 * file and a cycle for one type is not worth it.
 *
 * ponytail: `pct` is the whole import's progress, not this stage's. media
 * owns 0–85 of it (fetch + transcribe); extraction and validation own the
 * rest. Hardcoded because the split only moves when the pipeline does.
 */
export type MediaProgress = (e: { phase: string; note: string; pct?: number }) => void;

export class MediaError extends Error {
  constructor(
    public code: "NOT_INSTALLED" | "LOGIN_WALL" | "PRIVATE" | "TOO_LONG" | "NO_AUDIO" | "DOWNLOAD_FAILED",
    message: string,
  ) {
    super(message);
  }
}

// ——— process helpers ——————————————————————————————————————

function run(
  cmd: string,
  args: string[],
  timeoutMs = 180_000,
): Promise<{ code: number; stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      reject(new MediaError("DOWNLOAD_FAILED", "That video took too long to fetch."));
    }, timeoutMs);

    child.stdout.on("data", (d) => (stdout += d));
    // yt-dlp is chatty; keep only the tail so an error message survives.
    child.stderr.on("data", (d) => (stderr = (stderr + d).slice(-4000)));
    child.on("error", (err) => {
      clearTimeout(timer);
      if ((err as NodeJS.ErrnoException).code === "ENOENT") {
        reject(
          new MediaError(
            "NOT_INSTALLED",
            `${cmd} isn't installed on this machine. Paste the caption instead, or install it.`,
          ),
        );
      } else reject(err);
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      resolve({ code: code ?? -1, stdout, stderr });
    });
  });
}

/** Turns yt-dlp's stderr into the one line the cook should read. */
function classify(stderr: string): MediaError {
  const s = stderr.toLowerCase();
  if (s.includes("login") || s.includes("sign in") || s.includes("cookies") || s.includes("rate-limit")) {
    return new MediaError("LOGIN_WALL", "That platform wants a login before it'll hand this over.");
  }
  if (s.includes("private") || s.includes("unavailable") || s.includes("removed") || s.includes("404")) {
    return new MediaError("PRIVATE", "That post is private, or it's been taken down.");
  }
  return new MediaError("DOWNLOAD_FAILED", "We couldn't download that video.");
}

// ——— download ——————————————————————————————————————————————

/**
 * YouTube's default player client starts returning `HTTP 403 Forbidden` once
 * it has seen a handful of requests from one address — the throttling PRD R1
 * warns about, and it arrives within a dozen downloads, not weeks.
 *
 * Measured against a video the default client was refusing outright:
 *   default     403
 *   web_safari  no audio-only format offered
 *   tv          no audio-only format offered
 *   ios         no audio-only format offered
 *   mweb        works — 8.6 MB
 *   android_vr  works — 1.5 MB, audio only
 *
 * So: try the default, and fall down the ladder of clients that were actually
 * observed to work. A residential proxy pool is still the durable answer at
 * volume; this makes a single laptop reliable today.
 */
const CLIENTS: Array<string | null> = [null, "android_vr", "mweb"];

async function download(url: string, dir: string): Promise<void> {
  let last = "";

  for (const client of CLIENTS) {
    const { code, stderr } = await run(
      YTDLP,
      [
        "--no-warnings", "--no-playlist", "--no-part",
        "--retries", "5",
        "--extractor-retries", "3",
        "--retry-sleep", "http:exp=1:8",
        ...(client ? ["--extractor-args", `youtube:player_client=${client}`] : []),
        "-f", "bestaudio/best",
        "-x", "--audio-format", "wav",
        "--postprocessor-args", "ExtractAudio:-ar 16000 -ac 1",
        // --ffmpeg-location wants a PATH, not a command name. Passing the bare
        // word "ffmpeg" makes yt-dlp fail to find it and the download dies in
        // postprocessing. Only pass it when explicitly configured; otherwise
        // let yt-dlp search PATH itself.
        ...(process.env.FFMPEG_PATH ? ["--ffmpeg-location", process.env.FFMPEG_PATH] : []),
        "-o", join(dir, "audio.%(ext)s"),
        url,
      ],
      300_000,
    );

    if (code === 0) {
      if (client) console.log(`[rovelle] downloaded via player_client=${client}`);
      return;
    }

    last = stderr;
    // A private or deleted video will not become available by asking a
    // different client. Only retry the failures that are worth retrying.
    const err = classify(stderr);
    if (err.code === "PRIVATE") throw err;
    console.warn(
      `[rovelle] download failed on client=${client ?? "default"}: ${stderr.trim().split("\n").pop()}`,
    );
  }

  throw classify(last);
}

// ——— metadata ——————————————————————————————————————————————

/**
 * One call for title, creator, description, duration and top comments.
 *
 * Comments are fetched because a huge number of creators put the full
 * measured recipe in a pinned comment rather than the description — "recipe
 * in the comments" is a genre convention. Skipping them loses the only place
 * the quantities were ever written down.
 */
export async function probe(url: string, withComments = true): Promise<MediaMeta> {
  const { code, stdout, stderr } = await run(
    YTDLP,
    [
      "--no-warnings", "--skip-download", "--dump-single-json", "--no-playlist",
      ...(withComments
        ? ["--write-comments", "--extractor-args", "youtube:comment_sort=top;max_comments=25,all,0,0"]
        : []),
      url,
    ],
    120_000,
  );
  if (code !== 0) throw classify(stderr);

  const j = JSON.parse(stdout) as Record<string, unknown>;
  const uploaderId = (j.uploader_id as string) ?? (j.channel_id as string) ?? null;

  return {
    title: (j.title as string) ?? null,
    uploader: (j.uploader as string) ?? (j.channel as string) ?? null,
    uploaderId,
    description: (j.description as string) ?? null,
    recipeComments: pickRecipeComments(j.comments, uploaderId),
    durationS: typeof j.duration === "number" ? Math.round(j.duration) : null,
    thumbnail: (j.thumbnail as string) ?? null,
  };
}

type RawComment = {
  text?: string;
  author_id?: string;
  author_is_uploader?: boolean;
  is_pinned?: boolean;
  like_count?: number;
};

/**
 * Most comments are "looks delicious 😋". A few are the entire recipe.
 *
 * Keep the ones that could plausibly be instructions — the creator's own, a
 * pinned one, or anything carrying several quantities or recipe headings —
 * and throw the rest away before they cost a single token.
 */
function pickRecipeComments(raw: unknown, uploaderId: string | null): string[] {
  if (!Array.isArray(raw)) return [];

  const scored = (raw as RawComment[])
    .map((c) => {
      const text = (c.text ?? "").trim();
      if (text.length < 60) return null;

      const quantities = (text.match(/\d+\s*(?:g|kg|ml|l|tsp|tbsp|cup|gms?|grams?)\b/gi) ?? []).length;
      const headings = /\b(ingredients?|method|steps?|recipe|instructions?|samagri|vidhi|banane)\b/i.test(text);
      const lines = text.split(/\r?\n/).filter((l) => l.trim()).length;
      const fromCreator = c.author_is_uploader === true || (!!uploaderId && c.author_id === uploaderId);

      let score = 0;
      if (fromCreator) score += 4;
      if (c.is_pinned) score += 3;
      if (headings) score += 3;
      score += Math.min(4, quantities);
      if (lines >= 4) score += 2;

      // A long chatty comment with no numbers and no headings is not a recipe.
      return score >= 4 ? { text, score } : null;
    })
    .filter((x): x is { text: string; score: number } => x !== null)
    .sort((a, b) => b.score - a.score);

  // Two is plenty. More is duplicate recipes competing for the token budget.
  return scored.slice(0, 2).map((c) => c.text.slice(0, 3000));
}

// ——— download + transcribe ————————————————————————————————

export type Listened = { meta: MediaMeta; cues: Cue[]; transcript: string; language: string | null };

/**
 * The whole audio path. Downloads audio only (never video frames — smaller,
 * faster, and enough), splits it into Sarvam-sized chunks, transcribes them
 * concurrently, and stitches the results back into one timestamped
 * transcript. Chunk index gives every cue its offset, which is what puts
 * `source_ts_s` on each step so Cook Mode can point back into the video.
 */
export async function listen(url: string, onPhase?: MediaProgress): Promise<Listened> {
  const dir = await mkdtemp(join(tmpdir(), "rovelle-"));
  try {
    onPhase?.({ phase: "fetch", note: "Looking up the video", pct: 2 });
    const meta = await probe(url);
    onPhase?.({
      phase: "fetch",
      note: meta.title
        ? `Found: ${meta.title}${meta.uploader ? ` by ${meta.uploader}` : ""}`
        : "Found the video",
      pct: 8,
    });
    if (meta.recipeComments.length) {
      onPhase?.({
        phase: "fetch",
        note: `Read ${meta.recipeComments.length} recipe comment${meta.recipeComments.length > 1 ? "s" : ""}`,
        pct: 10,
      });
    }

    if (meta.durationS && meta.durationS > MAX_CHUNKS * CHUNK_S) {
      throw new MediaError(
        "TOO_LONG",
        `That video is ${Math.round(meta.durationS / 60)} minutes. We read up to ${Math.round((MAX_CHUNKS * CHUNK_S) / 60)}. Paste the transcript instead.`,
      );
    }

    onPhase?.({
      phase: "fetch",
      note: meta.durationS ? `Downloading ${fmtDuration(meta.durationS)} of audio` : "Downloading the audio",
      pct: 12,
    });
    await download(url, dir);

    const audio = join(dir, "audio.wav");
    const info = await stat(audio).catch(() => null);
    if (!info || info.size < 1024) {
      throw new MediaError("NO_AUDIO", "There's no audio track in that video.");
    }
    onPhase?.({
      phase: "fetch",
      note: `Downloaded ${(info.size / 1048576).toFixed(1)} MB of audio`,
      pct: 26,
    });
    await run(
      FFMPEG,
      [
        "-hide_banner", "-loglevel", "error",
        "-i", audio,
        "-f", "segment", "-segment_time", String(CHUNK_S),
        "-ar", "16000", "-ac", "1",
        "-c:a", "pcm_s16le",
        join(dir, "part-%04d.wav"),
      ],
      180_000,
    );

    const parts = (await readdir(dir))
      .filter((f) => f.startsWith("part-") && f.endsWith(".wav"))
      .sort()
      .slice(0, MAX_CHUNKS);
    if (parts.length === 0) throw new MediaError("NO_AUDIO", "We couldn't read the audio.");

    onPhase?.({ phase: "transcribe", note: `Split into ${parts.length} chunks`, pct: 30 });
    const cues = await transcribeChunks(dir, parts, onPhase);

    return {
      meta,
      cues,
      transcript: cues.map((c) => c.text).join(" ").trim(),
      language: null,
    };
  } finally {
    // PRD §9 — media is transient. It does not outlive the request.
    await rm(dir, { recursive: true, force: true }).catch(() => {});
  }
}

async function transcribeChunks(
  dir: string,
  parts: string[],
  onPhase?: MediaProgress,
): Promise<Cue[]> {
  const cues: Cue[] = [];
  // Chunks land out of order at CONCURRENCY 4, so the cook is told how many
  // are done, not which one — "chunk 7 of 12" after "chunk 5 of 12" reads as
  // a bug. The first words heard get their own line: it is the first real
  // proof the machine understood the video.
  let done = 0;
  let heard = false;

  for (let i = 0; i < parts.length; i += CONCURRENCY) {
    const window = parts.slice(i, i + CONCURRENCY);
    const results = await Promise.all(
      window.map(async (name, n) => {
        const index = i + n;
        try {
          const bytes = await readFile(join(dir, name));
          const { transcript } = await transcribe(
            new Blob([new Uint8Array(bytes)], { type: "audio/wav" }),
            name,
            // `translate` means a Tamil voiceover arrives here as English, so
            // one extraction prompt works for every language on earth.
            "translate",
          );
          const text = transcript.trim();
          done++;
          if (text && !heard) {
            heard = true;
            onPhase?.({ phase: "transcribe", note: `Heard: ${snippet(text)}` });
          }
          onPhase?.({
            phase: "transcribe",
            note: `Transcribed ${done} of ${parts.length} chunks`,
            pct: 30 + Math.round((done / parts.length) * 55),
          });
          return { t: index * CHUNK_S, text };
        } catch (err) {
          // One bad chunk must not lose the other twenty. A gap in the middle
          // of a transcript is recoverable; a failed import is not.
          console.warn(`[rovelle] chunk ${index} failed:`, err);
          return null;
        }
      }),
    );
    for (const r of results) if (r?.text) cues.push(r);
  }

  return cues.sort((a, b) => a.t - b.t);
}

function fmtDuration(s: number): string {
  return s < 60 ? `${s}s` : `${Math.floor(s / 60)}m ${String(s % 60).padStart(2, "0")}s`;
}

/** One line of the feed, cut on a word so it doesn't end mid-syllable. */
export function snippet(text: string, max = 64): string {
  const flat = text.replace(/\s+/g, " ").trim();
  if (flat.length <= max) return flat;
  const cut = flat.slice(0, max);
  return `${cut.slice(0, cut.lastIndexOf(" ") > max * 0.6 ? cut.lastIndexOf(" ") : max)}…`;
}

/** Is the machine able to do any of this? Surfaced on the import screen. */
export async function mediaToolsAvailable(): Promise<boolean> {
  try {
    const { code } = await run(YTDLP, ["--version"], 10_000);
    return code === 0;
  } catch {
    return false;
  }
}
