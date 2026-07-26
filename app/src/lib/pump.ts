/**
 * Callback-pushing async call → async iterable of its chunks, returning the
 * call's own result at the end.
 *
 * A generator cannot yield from inside a callback, and buffering the chunks
 * until the call resolves would deliver everything in one frame — which is the
 * thing streaming exists to stop. So chunks land in a queue and the loop parks
 * on a promise the callback resolves.
 *
 *   const chunks = pump<string, string>((onChunk) => model(prompt, onChunk));
 *   let next = await chunks.next();
 *   while (!next.done) { send(next.value); next = await chunks.next(); }
 *   const whole = next.value;
 *
 * ponytail: a queue and one promise rather than a stream library. The failure
 * mode to watch is a lost wake-up, which is why `wake` is cleared before it
 * resolves and the queue is drained before parking again.
 */
export async function* pump<C, R>(
  start: (onChunk: (chunk: C) => void) => Promise<R>,
): AsyncGenerator<C, R> {
  const queue: C[] = [];
  let wake: (() => void) | null = null;
  let finished = false;
  let value: R | undefined;
  let failure: unknown;
  let failed = false;

  const task = start((chunk) => {
    queue.push(chunk);
    wake?.();
  })
    .then((r) => {
      value = r;
    })
    .catch((e) => {
      failed = true;
      failure = e;
    })
    .finally(() => {
      finished = true;
      wake?.();
    });

  for (;;) {
    // Drain before parking: a chunk pushed between the last yield and the
    // await would otherwise sit in the queue with nobody left to wake us.
    while (queue.length) yield queue.shift()!;
    if (finished) break;
    await new Promise<void>((resolve) => {
      wake = () => {
        wake = null;
        resolve();
      };
    });
  }

  await task;
  // A failure after some chunks already shipped still has to reach the caller;
  // half an answer presented as a whole one is worse than an error.
  if (failed) throw failure;
  return value as R;
}
