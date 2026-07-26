import { NextResponse } from "next/server";
import { ZodError } from "zod";
import { AuthError } from "./auth";
import { NeedsLiveError, SarvamError } from "./sarvam";
import { FetchFailed } from "./fetchers";

/**
 * One error translator for every route.
 *
 * Copy rule (XRD §5): state what happened and the next move, in one line, no
 * apology. So the mapping lives here rather than being re-improvised per route.
 */
export async function guard<T>(fn: () => Promise<T> | T): Promise<NextResponse> {
  try {
    return NextResponse.json((await fn()) ?? { ok: true });
  } catch (err) {
    if (err instanceof AuthError) {
      return NextResponse.json({ error: "Sign in first." }, { status: 401 });
    }
    // JSON.parse throwing on a truncated or malformed body. The parser's own
    // words ("Unexpected token 'o'...") mean nothing to anyone holding a phone.
    if (err instanceof SyntaxError) {
      console.error("[rovelle] malformed request body:", err.message);
      return NextResponse.json({ error: "That request didn't make sense." }, { status: 400 });
    }
    if (err instanceof ZodError) {
      // A serialised issue array is not a sentence. Surface the one message
      // the schema author actually wrote.
      return NextResponse.json(
        { error: err.issues[0]?.message ?? "That request didn't make sense." },
        { status: 400 },
      );
    }
    if (err instanceof NeedsLiveError) {
      return NextResponse.json({ error: err.message, capability: err.capability }, { status: 501 });
    }
    if (err instanceof FetchFailed) {
      return NextResponse.json({ error: err.message, code: err.code }, { status: 422 });
    }
    if (err instanceof SarvamError) {
      return NextResponse.json({ error: err.message }, { status: err.status === 429 ? 429 : 502 });
    }
    console.error("[rovelle] route error:", err);
    const message = err instanceof Error ? err.message : "Something went wrong.";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
