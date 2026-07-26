/**
 * One fetch wrapper for every client component.
 *
 * `fetch` rejects with "Failed to fetch" when the network is down, the server
 * restarted, or DNS blinked — and that string reached a user during a live
 * demo. It means nothing to a cook. Anything thrown from here is already a
 * sentence someone can act on.
 */
export class RequestError extends Error {
  constructor(
    message: string,
    public status: number,
    public payload: Record<string, unknown> = {},
  ) {
    super(message);
  }
}

export async function fetchJson<T = Record<string, unknown>>(
  input: string,
  init?: RequestInit,
): Promise<T> {
  let res: Response;
  try {
    res = await fetch(input, init);
  } catch {
    // The request never left, or never came back.
    throw new RequestError(
      typeof navigator !== "undefined" && navigator.onLine === false
        ? "You're offline. We'll pick up where you left off when you're back."
        : "Can't reach Rovelle right now. Check your connection and try again.",
      0,
    );
  }

  let json: Record<string, unknown> = {};
  try {
    json = (await res.json()) as Record<string, unknown>;
  } catch {
    if (res.ok) return {} as T;
    // An HTML error page, a proxy timeout — never show the body.
    throw new RequestError(
      res.status >= 500
        ? "Something broke on our side. Try again in a moment."
        : "That request didn't go through. Try again.",
      res.status,
    );
  }

  if (!res.ok) {
    throw new RequestError(
      typeof json.error === "string" ? json.error : "That request didn't go through.",
      res.status,
      json,
    );
  }
  return json as T;
}
