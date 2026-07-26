import { createHmac, timingSafeEqual, randomInt } from "node:crypto";
import { cookies } from "next/headers";
import { db, id, nowISO, type UserRow } from "./db";

/**
 * Email OTP, no password (PRD §4).
 *
 * ponytail: HMAC-signed cookie instead of a session table or an auth library.
 * A signed `userId.timestamp.mac` is stateless, forgery-resistant, and about
 * forty lines. Add a sessions table when you need server-side revocation.
 *
 * ponytail: there is no mail provider wired, so the OTP is written to the
 * server log and — only when NODE_ENV !== 'production' — returned in the API
 * response so you can sign in locally. Wire Resend/SES before you ship.
 */

const COOKIE = "rovelle_session";
export const MAX_AGE_S = 60 * 60 * 24 * 90;
const secret = () => process.env.ROVELLE_SECRET ?? "insecure-dev-secret";

/** Exported so guest.ts can sign its own cookie without a second crypto path. */
export function sign(payload: string) {
  return createHmac("sha256", secret()).update(payload).digest("base64url");
}

export function verify(token: string): string | null {
  const [userId, issued, mac] = token.split(".");
  if (!userId || !issued || !mac) return null;
  const expected = sign(`${userId}.${issued}`);
  const a = Buffer.from(mac);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  if (Date.now() - Number(issued) > MAX_AGE_S * 1000) return null;
  return userId;
}

export async function setSession(userId: string) {
  const issued = String(Date.now());
  const token = `${userId}.${issued}.${sign(`${userId}.${issued}`)}`;
  (await cookies()).set(COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: MAX_AGE_S,
  });
}

export async function clearSession() {
  (await cookies()).delete(COOKIE);
}

/** The signed-in user, or null. Never throws. */
export async function currentUser(): Promise<UserRow | null> {
  const token = (await cookies()).get(COOKIE)?.value;
  if (!token) return null;
  const userId = verify(token);
  if (!userId) return null;
  const row = db()
    .prepare("SELECT * FROM users WHERE id = ?")
    .get(userId) as UserRow | undefined;
  return row ?? null;
}

/** Use in route handlers that must not run anonymously. */
export async function requireUser(): Promise<UserRow> {
  const u = await currentUser();
  if (!u) throw new AuthError();
  return u;
}

export class AuthError extends Error {
  constructor() {
    super("Sign in first.");
  }
}

// ——— OTP ——————————————————————————————————————————————————

export function issueOtp(email: string): string {
  const code = String(randomInt(0, 1_000_000)).padStart(6, "0");
  const expires = new Date(Date.now() + 10 * 60_000).toISOString();
  db()
    .prepare(
      `INSERT INTO otps (email, code, expires_at) VALUES (?, ?, ?)
       ON CONFLICT(email) DO UPDATE SET code = excluded.code, expires_at = excluded.expires_at`,
    )
    .run(email, code, expires);
  console.log(`[rovelle] sign-in code for ${email}: ${code}`);
  return code;
}

/** Consumes the code. Returns the user, creating them on first sign-in. */
export function redeemOtp(email: string, code: string): UserRow | null {
  const d = db();
  const row = d.prepare("SELECT * FROM otps WHERE email = ?").get(email) as
    | { email: string; code: string; expires_at: string }
    | undefined;
  if (!row || row.code !== code || new Date(row.expires_at) < new Date()) return null;
  d.prepare("DELETE FROM otps WHERE email = ?").run(email);

  const existing = d.prepare("SELECT * FROM users WHERE email = ?").get(email) as
    | UserRow
    | undefined;
  if (existing) return existing;

  const userId = id("usr");
  const resets = new Date(Date.now() + 30 * 24 * 3600_000).toISOString();
  d.prepare(
    `INSERT INTO users (id, email, plan, imports_this_period, period_resets_at, created_at)
     VALUES (?, ?, 'free', 0, ?, ?)`,
  ).run(userId, email, resets, nowISO());
  return d.prepare("SELECT * FROM users WHERE id = ?").get(userId) as UserRow;
}
