import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { db, id, nowISO, type UserRow } from "./db";
import { MAX_AGE_S, currentUser, sign, verify } from "./auth";
import { guard } from "./api";
import { importsLeft } from "./jobs";

/**
 * Anonymous visitors (PRD: the account is required only to SAVE).
 *
 * ponytail: a guest is a real `users` row with is_guest = 1, not a parallel
 * anonymous-work table. Every downstream query — recipes, jobs, cook_sessions,
 * the cookbook, the exporter — already filters by user_id, so nothing else in
 * the codebase learns that guests exist. Signing up is then an UPDATE of
 * user_id, not a migration between two shapes of the same data.
 */

const COOKIE = "rovelle_guest";

export const GUEST_IMPORTS = 1;

/** Thrown where a guest hits the wall. Carried to the client as contract C1. */
export class NeedsAccountError extends Error {
  constructor(message = "Sign in to keep this.") {
    super(message);
  }
}

export const isGuest = (u: UserRow) => u.is_guest === 1;

/**
 * guard(), plus the one response shape the sign-in sheet keys off (C1):
 * 401 { error, needsAccount: true }. guard() can only answer 200 or an error
 * status it knows, and it is shared with routes this file doesn't own.
 */
export async function guestGuard<T>(fn: () => Promise<T> | T): Promise<NextResponse> {
  try {
    const value = await fn();
    return guard(() => value);
  } catch (err) {
    if (err instanceof NeedsAccountError) {
      return NextResponse.json({ error: err.message, needsAccount: true }, { status: 401 });
    }
    if (err instanceof SyntaxError) {
      console.error("[rovelle] malformed request body:", err.message);
      return NextResponse.json({ error: "That request didn't make sense." }, { status: 400 });
    }
    return guard(() => {
      throw err;
    });
  }
}

// ——— identity ——————————————————————————————————————————————

/** The users row only. Split out so guest-check can drive it without cookies. */
export function createGuestRow(): UserRow {
  const guestId = id("gst");
  const resets = new Date(Date.now() + 30 * 24 * 3600_000).toISOString();
  db()
    .prepare(
      `INSERT INTO users (id, email, is_guest, plan, imports_this_period, period_resets_at, created_at)
       VALUES (?, ?, 1, 'free', 0, ?, ?)`,
    )
    .run(guestId, guestId, resets, nowISO());
  return db().prepare("SELECT * FROM users WHERE id = ?").get(guestId) as UserRow;
}

async function guestFromCookie(): Promise<UserRow | null> {
  const token = (await cookies()).get(COOKIE)?.value;
  const guestId = token ? verify(token) : null;
  if (!guestId) return null;
  const row = db()
    .prepare("SELECT * FROM users WHERE id = ? AND is_guest = 1")
    .get(guestId) as UserRow | undefined;
  return row ?? null;
}

/** Signed-in user, else the cookie's guest, else nobody. Creates nothing. */
export async function currentAnyUser(): Promise<UserRow | null> {
  return (await currentUser()) ?? (await guestFromCookie());
}

/** Signed-in user, else the cookie's guest, else a brand new guest. */
export async function currentOrGuestUser(): Promise<UserRow> {
  const known = await currentAnyUser();
  if (known) return known;

  const guest = createGuestRow();
  const issued = String(Date.now());
  (await cookies()).set(COOKIE, `${guest.id}.${issued}.${sign(`${guest.id}.${issued}`)}`, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: MAX_AGE_S,
  });
  return guest;
}

/** Guests get one import, not the free tier's five. */
export function importsLeftFor(u: UserRow): number | null {
  return isGuest(u) ? Math.max(0, GUEST_IMPORTS - u.imports_this_period) : importsLeft(u);
}

// ——— the handover ——————————————————————————————————————————

/**
 * Moves everything a guest made onto their new real account, then deletes the
 * guest. One transaction: a half-claimed guest is work the cook can no longer
 * reach from either identity.
 *
 * Returns how many recipes moved.
 */
export async function claimGuestWork(guestId: string, realUserId: string): Promise<number> {
  const d = db();
  if (guestId === realUserId) return 0;
  const guest = d.prepare("SELECT id FROM users WHERE id = ? AND is_guest = 1").get(guestId);
  if (!guest) return 0;

  let moved = 0;
  d.exec("BEGIN IMMEDIATE");
  try {
    const mine = d.prepare("SELECT id, slug FROM recipes WHERE user_id = ?");
    // recipes(user_id, slug) is UNIQUE, and the real account may already hold
    // the slug. Renaming the arrival is the only outcome where nothing is lost
    // — an INSERT OR IGNORE here would silently drop somebody's recipe.
    const taken = new Set((mine.all(realUserId) as { slug: string }[]).map((r) => r.slug));
    const move = d.prepare("UPDATE recipes SET user_id = ?, slug = ? WHERE id = ?");

    for (const r of mine.all(guestId) as { id: string; slug: string }[]) {
      let slug = r.slug;
      for (let n = 2; taken.has(slug); n++) slug = `${r.slug}-${n}`;
      taken.add(slug);
      move.run(realUserId, slug, r.id);
      moved++;
    }

    d.prepare("UPDATE jobs SET user_id = ? WHERE user_id = ?").run(realUserId, guestId);
    d.prepare("UPDATE cook_sessions SET user_id = ? WHERE user_id = ?").run(realUserId, guestId);
    d.prepare("DELETE FROM users WHERE id = ?").run(guestId);
    d.exec("COMMIT");
  } catch (err) {
    d.exec("ROLLBACK");
    throw err;
  }

  try {
    (await cookies()).delete(COOKIE);
  } catch {
    // Called outside a request (checks, a worker). There is no cookie to clear.
  }
  return moved;
}

/** POST /api/auth calls this between redeeming the code and setting the session. */
export async function claimGuestSession(realUserId: string): Promise<number> {
  const token = (await cookies()).get(COOKIE)?.value;
  const guestId = token ? verify(token) : null;
  return guestId ? claimGuestWork(guestId, realUserId) : 0;
}
