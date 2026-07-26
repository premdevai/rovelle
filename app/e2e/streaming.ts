import assert from "node:assert/strict";
import { Client, importCaption, signIn, sleep, type Flow } from "./harness";
import { pump } from "../src/lib/pump";

type AskEvent = {
  phase: string;
  question?: string;
  answer?: string;
  jumpToStep?: number | null;
  audio?: string | null;
  error?: string;
  capability?: string;
};

/** Reads an NDJSON body into events, with the wall-clock offset of each. */
async function drain(res: Response, started: number) {
  assert.ok(res.body, "no stream body");
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  const events: Array<AskEvent & { atMs: number }> = [];
  let buffer = "";
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    for (let nl = buffer.indexOf("\n"); nl !== -1; nl = buffer.indexOf("\n")) {
      const line = buffer.slice(0, nl).trim();
      buffer = buffer.slice(nl + 1);
      if (line) events.push({ ...(JSON.parse(line) as AskEvent), atMs: Date.now() - started });
    }
  }
  return events;
}

/**
 * The ask endpoint has two shapes and one implementation. If they ever drift,
 * the streaming client and every other caller start disagreeing about what the
 * recipe says — so both are driven here against the same question.
 */
export const askStreaming: Flow = {
  name: "ask streaming — NDJSON frames arrive in order, JSON still matches",
  run: async (ok) => {
    const c = new Client();
    await signIn(c, "stream@example.com");
    const { recipeId } = await importCaption(c);

    let frames: Array<AskEvent & { atMs: number }> = [];
    await ok("the stream opens as NDJSON, not as a buffered JSON body", async () => {
      const started = Date.now();
      const res = await c.raw("/api/ask", {
        method: "POST",
        headers: { "content-type": "application/json", accept: "application/x-ndjson" },
        body: JSON.stringify({ recipeId, question: "how much butter?", step: 0 }),
      });
      assert.equal(res.status, 200);
      assert.match(res.headers.get("content-type") ?? "", /x-ndjson/);
      assert.equal(res.headers.get("cache-control"), "no-cache, no-transform");
      // A buffering proxy turns this whole feature back into a single lump.
      assert.equal(res.headers.get("x-accel-buffering"), "no");
      frames = await drain(res, started);
    });

    await ok("the transcript lands before the answer does", async () => {
      const heard = frames.findIndex((f) => f.phase === "heard");
      const answered = frames.findIndex((f) => f.phase === "answer");
      assert.ok(heard >= 0, `no 'heard' frame: ${JSON.stringify(frames)}`);
      assert.ok(answered > heard, "the answer must not precede the question");
      assert.equal(frames[heard].question, "how much butter?");
    });

    await ok("the audio frame comes last, so the text never waits on the voice", async () => {
      const answered = frames.findIndex((f) => f.phase === "answer");
      const audio = frames.findIndex((f) => f.phase === "audio");
      assert.ok(audio > answered, "audio must follow the answer, not gate it");
      assert.equal(frames[audio].audio, null, "TTS is mocked, so the client speaks locally");
    });

    await ok("no error frame on a question the recipe can answer", async () => {
      assert.equal(frames.filter((f) => f.phase === "error").length, 0);
      assert.match(String(frames.find((f) => f.phase === "answer")?.answer), /butter|tbsp|3/i);
    });

    await ok("the plain JSON shape still answers identically", async () => {
      const res = await c.post<{ question: string; answer: string; jumpToStep: number | null }>(
        "/api/ask",
        { recipeId, question: "how much butter?", step: 0 },
      );
      assert.equal(res.status, 200);
      assert.equal(res.body.question, "how much butter?");
      assert.equal(res.body.answer, frames.find((f) => f.phase === "answer")?.answer);
    });

    await ok("a navigation command streams its jump target", async () => {
      const started = Date.now();
      const res = await c.raw("/api/ask", {
        method: "POST",
        headers: { "content-type": "application/json", accept: "application/x-ndjson" },
        body: JSON.stringify({ recipeId, question: "what's next?", step: 0 }),
      });
      const evs = await drain(res, started);
      assert.equal(evs.find((f) => f.phase === "answer")?.jumpToStep, 1);
    });

    await ok("a failure arrives as a frame, not as a dead connection", async () => {
      const started = Date.now();
      const res = await c.raw("/api/ask", {
        method: "POST",
        headers: { "content-type": "application/json", accept: "application/x-ndjson" },
        body: JSON.stringify({ recipeId, question: "   ", step: 0 }),
      });
      // The status line left before the work did, so the error rides the body.
      assert.equal(res.status, 200);
      const evs = await drain(res, started);
      const err = evs.find((f) => f.phase === "error");
      assert.ok(err, `expected an error frame, got ${JSON.stringify(evs)}`);
      assert.match(String(err.error), /didn't catch that/);
    });

    await ok("a recipe you don't own fails as a frame too, and says nothing about it", async () => {
      const other = new Client();
      await signIn(other, "streamnosy@example.com");
      const started = Date.now();
      const res = await other.raw("/api/ask", {
        method: "POST",
        headers: { "content-type": "application/json", accept: "application/x-ndjson" },
        body: JSON.stringify({ recipeId, question: "how much butter?" }),
      });
      const evs = await drain(res, started);
      assert.match(String(evs.find((f) => f.phase === "error")?.error), /No such recipe/);
      assert.equal(evs.filter((f) => f.phase === "answer").length, 0);
    });
  },
};

/**
 * The queue behind the `delta` frames.
 *
 * Nothing in a mocked run produces a token stream — the deterministic answerer
 * returns whole — so the machinery that would carry a live model's words is
 * driven directly here. A lost wake-up in it is a request that hangs until the
 * cook gives up, which is not a failure any HTTP assertion would describe.
 */
export const deltaPump: Flow = {
  name: "delta pump — chunks arrive as they are pushed, not in one lump",
  run: async (ok) => {
    await ok("chunks are yielded before the call resolves", async () => {
      const seen: number[] = [];
      const chunks = pump<string, string>(async (onChunk) => {
        for (const word of ["one ", "two ", "three"]) {
          await sleep(30);
          onChunk(word);
        }
        await sleep(30);
        return "one two three";
      });
      const started = Date.now();
      let next = await chunks.next();
      const collected: string[] = [];
      while (!next.done) {
        collected.push(next.value);
        seen.push(Date.now() - started);
        next = await chunks.next();
      }
      assert.deepEqual(collected, ["one ", "two ", "three"]);
      assert.equal(next.value, "one two three");
      // If they were buffered they would all land within a millisecond of the
      // last one; spread across the call is the whole point.
      assert.ok(seen[2] - seen[0] >= 40, `chunks arrived in one lump: ${seen.join(", ")}`);
    });

    await ok("a chunk pushed synchronously before the first read is not lost", async () => {
      const chunks = pump<string, number>(async (onChunk) => {
        onChunk("early");
        return 1;
      });
      const first = await chunks.next();
      assert.equal(first.value, "early");
      assert.equal((await chunks.next()).value, 1);
    });

    await ok("a failure after some chunks still reaches the caller", async () => {
      const chunks = pump<string, void>(async (onChunk) => {
        onChunk("partial");
        await sleep(10);
        throw new Error("model died");
      });
      assert.equal((await chunks.next()).value, "partial");
      await assert.rejects(() => chunks.next(), /model died/);
    });

    await ok("a call that pushes nothing still returns its result", async () => {
      const chunks = pump<string, string>(async () => "whole answer");
      const first = await chunks.next();
      assert.equal(first.done, true);
      assert.equal(first.value, "whole answer");
    });
  },
};

/** The import feed. A 30-second wait has to look like work, not like a hang. */
export const importStreaming: Flow = {
  name: "import streaming — the live feed arrives progressively",
  run: async (ok) => {
    const c = new Client();
    await signIn(c, "feed@example.com");

    await ok("SSE opens with the right headers and pushes at least one frame", async () => {
      const started = await c.post<{ jobId: string }>("/api/import", {
        rawText: (await import("./harness")).CAPTION,
      });
      const res = await c.raw(`/api/import/${started.body.jobId}/stream`);
      assert.equal(res.status, 200);
      assert.match(res.headers.get("content-type") ?? "", /text\/event-stream/);
      assert.equal(res.headers.get("x-accel-buffering"), "no");

      const reader = res.body!.getReader();
      const decoder = new TextDecoder();
      let text = "";
      // Read until the terminal frame or the stream closes; the worker is
      // in-process and fast, so this is bounded by the job itself.
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        text += decoder.decode(value, { stream: true });
        if (/"status":"(done|failed)"/.test(text)) break;
      }
      await reader.cancel().catch(() => {});

      assert.match(text, /^data: /m, "no SSE data frame arrived");
      assert.match(text, /"status":"done"/, `the job never reported done: ${text.slice(-300)}`);
    });

    await ok("the feed carries named events, not just a status word", async () => {
      const started = await c.post<{ jobId: string }>("/api/import", {
        rawText: (await import("./harness")).CAPTION,
      });
      const { awaitJob } = await import("./harness");
      await awaitJob(c, started.body.jobId);
      const res = await c.get<{ events: { phase: string; note: string; pct?: number }[] }>(
        `/api/import/${started.body.jobId}`,
      );
      assert.ok(res.body.events.length >= 3, "the live feed is what makes the wait readable");
      assert.ok(
        res.body.events.some((e) => /ingredients/i.test(e.note)),
        `expected a partial result in the feed, got: ${res.body.events.map((e) => e.note).join(" | ")}`,
      );
      assert.equal(res.body.events.at(-1)?.pct, 100, "the feed must land on 100");
    });
  },
};
