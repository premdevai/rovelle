import { zipSync, unzipSync, strFromU8 } from "fflate";
import { voiceOr } from "./voices";

/**
 * Sarvam AI — the whole backend.
 *
 * Rovelle uses Sarvam because the person filming the reel is speaking Tamil,
 * Hindi, or Hinglish, and the person cooking from it may not be. Saaras
 * transcribes and translates the speech, Sarvam Vision reads the on-screen
 * text, Sarvam-105B turns it into RRF, Mayura renders the recipe in the
 * cook's language, and Bulbul speaks it back in Cook Mode.
 *
 * Every capability has a mode: `mock` or `live`.
 *
 *   mock  = does the work locally, or refuses with a clear message.
 *           It NEVER invents recipe content. A fabricated quantity is the
 *           highest-severity bug in this product (PRD R5), and a mock that
 *           fabricates is the same bug wearing a costume.
 *   live  = real HTTP to api.sarvam.ai, real credits.
 *
 * Flip per capability so you can run translate+tts live (cheap) while
 * extraction and OCR stay mocked (expensive). See .env.example.
 */

const BASE = process.env.SARVAM_API_BASE_URL ?? "https://api.sarvam.ai";

export type Capability = "extract" | "ocr" | "stt" | "tts" | "translate";

export function mode(cap: Capability): "mock" | "live" {
  const per = process.env[`SARVAM_MODE_${cap.toUpperCase()}`];
  const m = (per ?? process.env.SARVAM_MODE ?? "mock").toLowerCase();
  if (m === "live" && !process.env.SARVAM_API_KEY) return "mock";
  return m === "live" ? "live" : "mock";
}

/** Thrown when a capability has no honest local implementation. */
export class NeedsLiveError extends Error {
  constructor(public capability: Capability, hint: string) {
    super(hint);
  }
}

// ——— credit guard ————————————————————————————————————————
// Limited credits, and an accidental retry loop against a paid endpoint is a
// bad afternoon. Counts live calls per process; refuses past the cap.
const BUDGET = Number(process.env.SARVAM_LIVE_BUDGET ?? 200);
let spent = 0;
export const creditsUsed = () => spent;

async function call(path: string, init: RequestInit): Promise<Response> {
  if (spent >= BUDGET) {
    throw new Error(
      `Sarvam live-call budget of ${BUDGET} reached this process. Raise SARVAM_LIVE_BUDGET or restart.`,
    );
  }
  spent++;
  const started = Date.now();
  const res = await fetch(`${BASE}${path}`, {
    ...init,
    headers: { "api-subscription-key": process.env.SARVAM_API_KEY!, ...init.headers },
  });
  console.log(`[sarvam] ${init.method ?? "GET"} ${path} → ${res.status} (${Date.now() - started}ms, call ${spent}/${BUDGET})`);
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    // Log the actual refusal. A bare "failed (400)" cost real debugging time.
    console.error(`[sarvam] ${path} ${res.status}: ${body.slice(0, 400)}`);
    throw new SarvamError(res.status, path, body.slice(0, 500));
  }
  return res;
}

export class SarvamError extends Error {
  constructor(public status: number, public path: string, public body: string) {
    // 403 not 401 — Sarvam returns 403 on auth failure.
    super(
      status === 403
        ? "Sarvam rejected the API key."
        : status === 429
          ? "Sarvam is rate-limiting us. Try again in a moment."
          : `Sarvam ${path} failed (${status}).`,
    );
  }
}

// ——— chat: Sarvam-105B / 30B ————————————————————————————————

export type ChatMessage = { role: "system" | "user" | "assistant"; content: string };

/**
 * Hard ceiling on completion tokens.
 *
 * The starter tier rejects anything above 4096 with a 400 — not a truncation,
 * a refusal — so asking for more doesn't degrade, it fails the whole call.
 * Raise this when the plan does.
 */
const MAX_TOKENS = Number(process.env.SARVAM_MAX_TOKENS ?? 4096);

/**
 * Returns the assistant text. Callers that need JSON must ask for JSON in the
 * prompt and run the result through `extractJson` — Sarvam has no
 * response_format guarantee, so we parse defensively rather than trust it.
 *
 * Sarvam-105B is a reasoning model. Its chain of thought comes back in
 * `reasoning_content` and counts against `max_tokens`, while `content` stays
 * null until the thinking finishes. Two consequences, both learned the hard
 * way against the live API:
 *
 *   - max_tokens has to cover reasoning AND the answer. Set it too low and
 *     you pay for a full response that arrives as `content: null`.
 *   - `reasoning_effort` is deliberately not sent. Passing "low" measured
 *     WORSE than omitting it (300 tokens and a truncation, versus 80 tokens
 *     and a clean answer for the same prompt), and "none" is rejected.
 */
export async function chat(
  messages: ChatMessage[],
  opts: { temperature?: number; maxTokens?: number } = {},
): Promise<string> {
  const res = await call("/v1/chat/completions", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model: process.env.SARVAM_CHAT_MODEL ?? "sarvam-105b",
      messages,
      temperature: opts.temperature ?? 0.2,
      max_tokens: Math.min(opts.maxTokens ?? MAX_TOKENS, MAX_TOKENS),
    }),
  });

  const json = (await res.json()) as {
    choices?: Array<{
      finish_reason?: string;
      message?: { content?: string | null; reasoning_content?: string | null };
    }>;
  };
  const choice = json.choices?.[0];
  const text = choice?.message?.content;

  if (!text) {
    if (choice?.finish_reason === "length") {
      throw new Error(
        "Sarvam ran out of tokens while reasoning and never reached an answer. Raise max_tokens.",
      );
    }
    throw new Error("Sarvam returned an empty completion.");
  }
  return text;
}

/**
 * Same call, token by token.
 *
 * Returns the full text once the stream ends, and hands each content chunk to
 * `onDelta` as it lands. Only `content` is forwarded — a reasoning model's
 * `reasoning_content` arrives first and at length, and reading a model's
 * private thinking aloud to somebody holding a hot pan is not an answer.
 */
export async function chatStream(
  messages: ChatMessage[],
  opts: { temperature?: number; maxTokens?: number } = {},
  onDelta: (chunk: string) => void,
): Promise<string> {
  const res = await call("/v1/chat/completions", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model: process.env.SARVAM_CHAT_MODEL ?? "sarvam-105b",
      messages,
      temperature: opts.temperature ?? 0.2,
      max_tokens: Math.min(opts.maxTokens ?? MAX_TOKENS, MAX_TOKENS),
      stream: true,
    }),
  });
  if (!res.body) throw new Error("Sarvam returned no stream.");

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let text = "";

  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });

    // SSE frames are separated by a blank line; a chunk can split one in half.
    let cut = buffer.indexOf("\n\n");
    for (; cut !== -1; cut = buffer.indexOf("\n\n")) {
      const frame = buffer.slice(0, cut);
      buffer = buffer.slice(cut + 2);
      for (const line of frame.split("\n")) {
        if (!line.startsWith("data:")) continue;
        const payload = line.slice(5).trim();
        if (!payload || payload === "[DONE]") continue;
        try {
          const json = JSON.parse(payload) as {
            choices?: Array<{ delta?: { content?: string | null } }>;
          };
          const chunk = json.choices?.[0]?.delta?.content;
          if (chunk) {
            text += chunk;
            onDelta(chunk);
          }
        } catch {
          // A frame we can't parse is not worth killing the answer over.
        }
      }
    }
  }

  if (!text.trim()) throw new Error("Sarvam streamed an empty completion.");
  return text;
}

/** Same, for a top-level JSON array. */
export function extractJsonArray(text: string): unknown[] {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  const candidate = (fenced?.[1] ?? text).trim();
  const start = candidate.indexOf("[");
  const end = candidate.lastIndexOf("]");
  if (start === -1 || end <= start) throw new Error("No JSON array in model output.");
  const parsed = JSON.parse(candidate.slice(start, end + 1)) as unknown;
  if (!Array.isArray(parsed)) throw new Error("Model output was not an array.");
  return parsed;
}

/** Pull the first JSON object out of a completion, fences and preamble and all. */
export function extractJson(text: string): unknown {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  const candidate = (fenced?.[1] ?? text).trim();
  const start = candidate.indexOf("{");
  const end = candidate.lastIndexOf("}");
  if (start === -1 || end <= start) throw new Error("No JSON object in model output.");
  return JSON.parse(candidate.slice(start, end + 1));
}

// ——— speech to text: Saaras v3 ————————————————————————————————

export type SttMode = "transcribe" | "translate" | "verbatim" | "translit" | "codemix";

/**
 * `translate` returns English regardless of what was spoken — that is the
 * whole reason a Tamil reel is consumable by someone in Berlin.
 */
export async function transcribe(
  audio: Blob,
  filename: string,
  sttMode: SttMode = "translate",
): Promise<{ transcript: string; language_code: string | null }> {
  if (mode("stt") === "mock") {
    throw new NeedsLiveError(
      "stt",
      "Speech-to-text has no offline equivalent. Set SARVAM_MODE_STT=live, or paste the transcript instead.",
    );
  }
  // Sarvam's sync STT refuses two things with a bare 400, and a live mic hits
  // both: an empty blob ("Failed to read the file") when the press was too
  // quick to capture anything, and anything over 30 seconds ("Audio duration
  // exceeds the maximum limit"). Catch them here with words a cook can act on
  // rather than letting an opaque 400 surface as a broken feature.
  if (audio.size < 1024) {
    throw new Error("I didn't hear anything. Hold the button while you speak.");
  }

  const form = new FormData();
  form.append("model", "saaras:v3");
  form.append("mode", sttMode);
  form.append("file", audio, filename);
  const res = await call("/speech-to-text", { method: "POST", body: form });
  const json = (await res.json()) as { transcript?: string; language_code?: string };
  return { transcript: json.transcript ?? "", language_code: json.language_code ?? null };
}

// ——— text to speech: Bulbul v3 ————————————————————————————————

/** Returns base64 wav, or null when mocked — the client falls back to the
 *  browser's own speechSynthesis, which is free and good enough to test with. */
export async function speak(
  text: string,
  targetLanguage: string,
  speaker?: string | null,
): Promise<string | null> {
  if (mode("tts") === "mock") return null;
  const res = await call("/text-to-speech", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      text: text.slice(0, 1500),
      target_language_code: targetLanguage,
      model: "bulbul:v3",
      // Any speaker works in any language — they are independent choices, and
      // hardcoding one made the voice a hidden consequence of the language.
      speaker: voiceOr(speaker),
    }),
  });
  const json = (await res.json()) as { audios?: string[] };
  return json.audios?.join("") ?? null;
}

// ——— translate: Sarvam Translate / Mayura ————————————————————

/** Mocked translate is the identity function. Wrong language beats wrong words. */
export async function translate(
  input: string,
  targetLanguage: string,
  sourceLanguage = "auto",
): Promise<string> {
  if (mode("translate") === "mock" || targetLanguage === sourceLanguage) return input;
  const res = await call("/translate", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      input: input.slice(0, 2000),
      source_language_code: sourceLanguage,
      target_language_code: targetLanguage,
    }),
  });
  const json = (await res.json()) as { translated_text?: string };
  return json.translated_text ?? input;
}

// ——— OCR: Sarvam Vision via Document Digitization ————————————

type SignedUrls = Record<string, { file_url: string }>;

/**
 * Screenshot → text. Six calls: create job, get upload URL, PUT the file,
 * start, poll, download. The upload endpoint takes exactly one PDF or ZIP,
 * so a bare PNG gets wrapped in a one-entry zip on the way out.
 *
 * ponytail: polling with a fixed 2s interval and a hard 3-minute ceiling.
 * A ten-page document is the documented maximum and finishes well inside
 * that; swap to the webhook callback if you ever queue real batches.
 */
export async function ocr(
  file: Uint8Array,
  filename: string,
  language = "en-IN",
): Promise<string> {
  if (mode("ocr") === "mock") {
    throw new NeedsLiveError(
      "ocr",
      "Reading text off an image needs Sarvam Vision. Set SARVAM_MODE_OCR=live, or type the recipe in instead.",
    );
  }

  const isPdf = filename.toLowerCase().endsWith(".pdf");
  const upload = isPdf
    ? { name: "page.pdf", bytes: file }
    : { name: "pages.zip", bytes: zipSync({ [filename.replace(/[^\w.-]/g, "_")]: file }) };

  const create = (await (
    await call("/doc-digitization/job/v1", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ job_parameters: { language, output_format: "md" } }),
    })
  ).json()) as { job_id: string };
  const jobId = create.job_id;

  const links = (await (
    await call("/doc-digitization/job/v1/upload-files", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ job_id: jobId, files: [upload.name] }),
    })
  ).json()) as { upload_urls: SignedUrls };

  const putUrl = links.upload_urls[upload.name]?.file_url;
  if (!putUrl) throw new Error("Sarvam returned no upload URL.");

  const put = await fetch(putUrl, {
    method: "PUT",
    // Azure blob presigned PUTs require this header; harmless on the others.
    headers: { "x-ms-blob-type": "BlockBlob", "Content-Type": "application/octet-stream" },
    body: upload.bytes as unknown as BodyInit,
  });
  if (!put.ok) throw new Error(`Upload to storage failed (${put.status}).`);

  await call(`/doc-digitization/job/v1/${jobId}/start`, { method: "POST" });

  const deadline = Date.now() + 180_000;
  let state = "Running";
  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 2000));
    const status = (await (
      await call(`/doc-digitization/job/v1/${jobId}/status`, { method: "GET" })
    ).json()) as { job_state: string };
    state = status.job_state;
    if (state === "Completed" || state === "PartiallyCompleted") break;
    if (state === "Failed") throw new Error("Sarvam couldn't read that image.");
  }
  if (state !== "Completed" && state !== "PartiallyCompleted") {
    throw new Error("Sarvam Vision timed out on that document.");
  }

  const dl = (await (
    await call(`/doc-digitization/job/v1/${jobId}/download-files`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "{}",
    })
  ).json()) as { download_urls: SignedUrls };

  return collectText(dl.download_urls);
}

/** Output arrives as a zip of .md (plus a .json of page data) or as loose files. */
async function collectText(urls: SignedUrls): Promise<string> {
  const parts: string[] = [];
  for (const [name, { file_url }] of Object.entries(urls)) {
    const res = await fetch(file_url);
    if (!res.ok) continue;
    if (name.toLowerCase().endsWith(".zip")) {
      const entries = unzipSync(new Uint8Array(await res.arrayBuffer()));
      for (const [entryName, bytes] of Object.entries(entries)) {
        if (/\.(md|txt|html)$/i.test(entryName)) parts.push(strFromU8(bytes));
      }
    } else if (/\.(md|txt|html)$/i.test(name)) {
      parts.push(await res.text());
    }
  }
  const text = parts.join("\n\n").replace(/<[^>]+>/g, " ").replace(/[ \t]+/g, " ").trim();
  if (!text) throw new Error("Sarvam read the image but found no text in it.");
  return text;
}
