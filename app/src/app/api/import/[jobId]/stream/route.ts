import { currentAnyUser } from "@/lib/guest";
import { statusFor, type JobStatus } from "@/lib/job-status";

/**
 * The live feed, pushed.
 *
 * ponytail: this is still a poll — it just runs on the server, at 400ms, and
 * only writes when something actually changed. The worker is in-process
 * (jobs.ts) so there is no queue to subscribe to; an emitter would buy
 * latency the cook cannot perceive and would break the moment the worker
 * moves out of process. Swap the loop body for a real subscription then.
 *
 * The whole status goes down each tick, not a delta. Twenty short events is
 * a couple of KB and the client stays a pure `setState` — dedup bugs on a
 * dropped reconnect are not worth the bytes.
 *
 * GET /api/import/[jobId] is untouched and remains the fallback: SSE through
 * a buffering proxy never arrives at all.
 */

export const dynamic = "force-dynamic";

const TICK_MS = 400;
/** Past this the job is wedged; close and let EventSource reconnect. */
const MAX_MS = 10 * 60_000;

export async function GET(req: Request, ctx: { params: Promise<{ jobId: string }> }) {
  const { jobId } = await ctx.params;

  let userId: string;
  try {
    // Guest or signed-in — a guest watching their own import is the common case.
    const user = await currentAnyUser();
    if (!user) throw new Error("no identity");
    statusFor(user.id, jobId); // ownership, before a stream is opened
    userId = user.id;
  } catch {
    // A non-200 makes EventSource fail without retrying, which is what puts
    // the client on the poll fallback rather than in a reconnect loop.
    return new Response("Sign in first.", { status: 401 });
  }

  const enc = new TextEncoder();
  const started = Date.now();

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      let last = "";
      let quiet = 0;

      const write = (s: string) => {
        try {
          controller.enqueue(enc.encode(s));
          return true;
        } catch {
          return false; // client hung up mid-write
        }
      };

      while (!req.signal.aborted && Date.now() - started < MAX_MS) {
        let status: JobStatus;
        try {
          status = statusFor(userId, jobId);
        } catch {
          break; // job vanished
        }

        const json = JSON.stringify(status);
        if (json !== last) {
          last = json;
          quiet = 0;
          if (!write(`data: ${json}\n\n`)) break;
        } else if (++quiet >= 25) {
          // A comment line every ~10s so proxies don't reap an idle stream.
          quiet = 0;
          if (!write(": ping\n\n")) break;
        }

        if (status.status === "done" || status.status === "failed") break;
        await new Promise((r) => setTimeout(r, TICK_MS));
      }

      try {
        controller.close();
      } catch {
        /* already closed */
      }
    },
  });

  return new Response(stream, { headers: sseHeaders() });
}

function sseHeaders(): HeadersInit {
  return {
    "Content-Type": "text/event-stream; charset=utf-8",
    "Cache-Control": "no-cache, no-transform",
    Connection: "keep-alive",
    // nginx buffers text/event-stream by default and the feed arrives in one
    // lump at the end, which looks exactly like the bug we are fixing.
    "X-Accel-Buffering": "no",
  };
}
