import { guard } from "@/lib/api";
import { currentOrGuestUser } from "@/lib/guest";
import { getById } from "@/lib/recipes";
import { answer } from "@/lib/ask";
import { speak, transcribe, translate, mode, NeedsLiveError } from "@/lib/sarvam";
import { voiceOr } from "@/lib/voices";
import { pump } from "@/lib/pump";
import type { Recipe } from "@/lib/rrf";

/**
 * Cook-talk-live, one round trip.
 *
 * Accepts multipart (mic audio) or JSON (typed / Web Speech transcript).
 * Audio goes through Saaras in `translate` mode, so a question asked in Tamil
 * arrives here as English and the same grounded answerer handles it. The reply
 * is translated back and spoken by Bulbul in whatever language was asked.
 *
 * Two response shapes, one handler:
 *
 *   JSON (default)             — everything at once, as it always was.
 *   NDJSON (Accept: x-ndjson)  — one JSON object per line, in the order the
 *                                work finishes.
 *
 * The second exists because the round trip is four hops — transcribe, answer,
 * translate, speak — and a cook with their hands in a pan was watching a
 * "Thinking" label through all four. Now the transcript appears the moment it
 * is heard and the answer streams in as it is written. Nothing about the work
 * changed; only when the cook hears about it.
 */

export type AskEvent =
  | { phase: "heard"; question: string; language: string }
  | { phase: "delta"; text: string }
  | { phase: "answer"; answer: string; jumpToStep: number | null }
  | { phase: "audio"; audio: string | null; speakLocally: boolean; ttsMode: string }
  /** `capability` is set when a Sarvam mode is off, so the client can retry
   *  the same question down a path that doesn't need it. */
  | { phase: "error"; error: string; capability?: string };

type Input = {
  recipeId: string;
  stepIndex: number;
  question: string;
  language: string;
  /** The Bulbul speaker. Independent of language — any voice, any language. */
  voice: string;
  audio: Blob | null;
};

async function readInput(req: Request): Promise<Input> {
  if (req.headers.get("content-type")?.includes("multipart/form-data")) {
    const form = await req.formData();
    const file = form.get("audio");
    return {
      recipeId: String(form.get("recipeId") ?? ""),
      stepIndex: Number(form.get("step") ?? 0),
      language: String(form.get("language") ?? "en-IN"),
      voice: voiceOr(form.get("voice") ? String(form.get("voice")) : null),
      question: String(form.get("question") ?? ""),
      audio: file instanceof Blob ? file : null,
    };
  }
  const body = (await req.json()) as {
    recipeId: string;
    step?: number;
    question?: string;
    language?: string;
    voice?: string;
  };
  return {
    recipeId: body.recipeId,
    stepIndex: body.step ?? 0,
    question: body.question ?? "",
    language: body.language ?? "en-IN",
    voice: voiceOr(body.voice ?? null),
    audio: null,
  };
}

/**
 * The work, emitted as it completes. Both response shapes drain this one
 * generator, so the streaming client and the JSON client cannot drift apart.
 */
async function* ask(rrf: Recipe, input: Input): AsyncGenerator<AskEvent> {
  let { question, language } = input;

  if (input.audio && !question) {
    const stt = await transcribe(input.audio, "question.webm", "translate");
    question = stt.transcript;
    if (stt.language_code) language = stt.language_code;
  }
  if (!question.trim()) throw new Error("I didn't catch that. Say it again?");
  yield { phase: "heard", question, language };

  // Deltas only survive the trip when nothing has to translate them on the
  // way out — half a sentence cannot be translated and then corrected.
  const streamable = language === "en-IN";
  const chunks = pump<string, Awaited<ReturnType<typeof answer>>>((onChunk) =>
    answer(rrf, question, input.stepIndex, streamable ? onChunk : undefined),
  );
  let next = await chunks.next();
  while (!next.done) {
    yield { phase: "delta", text: next.value };
    next = await chunks.next();
  }
  const result = next.value;

  const spokenText = language === "en-IN" ? result.text : await translate(result.text, language);
  yield { phase: "answer", answer: spokenText, jumpToStep: result.jumpToStep ?? null };

  // Last on purpose: the client can already speak with the browser's own
  // voice, so Bulbul landing a second later upgrades an answer the cook has
  // rather than delaying one they don't.
  const audio = await speak(spokenText, language, input.voice);
  yield { phase: "audio", audio, speakLocally: audio === null, ttsMode: mode("tts") };
}

export async function POST(req: Request) {
  const wantsStream = req.headers.get("accept")?.includes("application/x-ndjson");

  if (!wantsStream) {
    return guard(async () => {
      const user = await currentOrGuestUser();
      const input = await readInput(req);
      const found = getById(user.id, input.recipeId);
      if (!found) throw new Error("No such recipe.");

      const out: Record<string, unknown> = {};
      for await (const event of ask(found.rrf, input)) {
        if (event.phase === "heard") out.question = event.question;
        if (event.phase === "answer") {
          out.answer = event.answer;
          out.jumpToStep = event.jumpToStep;
        }
        if (event.phase === "audio") {
          out.audio = event.audio;
          out.speakLocally = event.speakLocally;
          out.ttsMode = event.ttsMode;
        }
      }
      return out;
    });
  }

  const user = await currentOrGuestUser();
  const input = await readInput(req);
  const found = getById(user.id, input.recipeId);

  const enc = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (e: AskEvent) => {
        try {
          controller.enqueue(enc.encode(`${JSON.stringify(e)}\n`));
        } catch {
          // The cook navigated away mid-answer. Nothing to recover.
        }
      };
      try {
        if (!found) throw new Error("No such recipe.");
        for await (const event of ask(found.rrf, input)) send(event);
      } catch (err) {
        // An error inside a 200 stream: the status line left before the work
        // did, so the failure has to arrive as a frame the client understands.
        send({
          phase: "error",
          error: err instanceof Error ? err.message : "I couldn't work that one out.",
          capability: err instanceof NeedsLiveError ? err.capability : undefined,
        });
      }
      try {
        controller.close();
      } catch {
        /* already closed */
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "application/x-ndjson; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      "X-Accel-Buffering": "no",
    },
  });
}
