import assert from "node:assert/strict";
import { spawn, type ChildProcess } from "node:child_process";
import { createServer } from "node:net";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";

/**
 * End-to-end: a real production build, a real HTTP server, real cookies.
 *
 * The bugs this suite exists to catch are the ones no unit test can see —
 * a page that redirects a guest to /enter, a route that answers 401 to the
 * person who owns the row. Those live in the seam between Next's request
 * handling and our identity code, so the only honest test drives the seam.
 *
 * ponytail: no Playwright, no test runner. `fetch` plus a cookie jar is the
 * whole client, because every flow here is HTTP — the one thing we do not
 * assert is pixels. Add a browser the day a bug is only visible in one.
 */

export const DB_FILE = join(mkdtempSync(join(tmpdir(), "rovelle-e2e-")), "e2e.db");

/** Its own build output, so a running `next dev` is left alone. */
export const DIST_DIR = ".next-e2e";

/** The pasted caption every flow imports. Deterministic, no network. */
export const CAPTION = [
  "Garlic Butter Shrimp Pasta",
  "",
  "Ingredients:",
  "250g spaghetti",
  "400g shrimp, peeled and deveined",
  "4 cloves garlic, minced",
  "3 tbsp butter",
  "1/2 cup Parmesan cheese",
  "Handful of fresh parsley",
  "Salt and black pepper to taste",
  "",
  "Instructions:",
  "Cook the spaghetti until al dente, about 9 minutes.",
  "Melt the butter in a large pan over medium heat.",
  "Add the minced garlic and saute for 1 minute until fragrant.",
  "Add the shrimp and cook for 3 minutes on each side until pink.",
  "Toss the drained spaghetti through the pan with a splash of pasta water.",
  "Add the Parmesan and parsley and toss until creamy.",
].join("\n");

// ——— the server ————————————————————————————————————————————

let child: ChildProcess | null = null;
let base = "";

export const baseUrl = () => base;

async function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const s = createServer();
    s.on("error", reject);
    s.listen(0, () => {
      const port = (s.address() as { port: number }).port;
      s.close(() => resolve(port));
    });
  });
}

export async function startServer(): Promise<void> {
  const port = await freePort();
  base = `http://127.0.0.1:${port}`;

  child = spawn("node", ["node_modules/next/dist/bin/next", "start", "-p", String(port)], {
    // Shell env wins over .env.local in Next, so a real SARVAM key sitting in
    // the developer's .env.local cannot turn this suite into a paid, flaky,
    // network-dependent run.
    env: {
      ...process.env,
      NODE_ENV: "production",
      NEXT_DIST_DIR: DIST_DIR,
      ROVELLE_DB: DB_FILE,
      ROVELLE_SECRET: "e2e-secret",
      SARVAM_API_KEY: "",
      SARVAM_MODE: "mock",
      SARVAM_MODE_STT: "mock",
      SARVAM_MODE_TTS: "mock",
      SARVAM_MODE_OCR: "mock",
      SARVAM_MODE_EXTRACT: "mock",
      SARVAM_MODE_TRANSLATE: "mock",
    },
    stdio: ["ignore", "pipe", "pipe"],
  });

  const log: string[] = [];
  child.stdout?.on("data", (b: Buffer) => log.push(String(b)));
  child.stderr?.on("data", (b: Buffer) => log.push(String(b)));
  child.on("exit", (code) => {
    if (code !== 0 && code !== null) {
      console.error(log.join(""));
      throw new Error(`next start exited with ${code}`);
    }
  });

  const deadline = Date.now() + 60_000;
  for (;;) {
    try {
      const res = await fetch(base, { redirect: "manual" });
      if (res.status < 500) return;
    } catch {
      // not listening yet
    }
    if (Date.now() > deadline) {
      console.error(log.join(""));
      throw new Error("server never came up");
    }
    await sleep(200);
  }
}

export function stopServer(): void {
  child?.kill("SIGTERM");
  child = null;
}

export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// ——— one browser ————————————————————————————————————————————

export type Res<T = Record<string, unknown>> = {
  status: number;
  body: T;
  text: string;
  location: string | null;
};

/**
 * A cookie jar with a fetch attached — i.e. one browser. Flows that need a
 * guest and a signed-in cook at the same time just make two.
 */
export class Client {
  readonly jar = new Map<string, string>();

  cookie(name: string) {
    return this.jar.get(name) ?? null;
  }

  async raw(path: string, init: RequestInit = {}): Promise<Response> {
    const cookie = [...this.jar].map(([k, v]) => `${k}=${v}`).join("; ");
    const res = await fetch(`${base}${path}`, {
      ...init,
      redirect: "manual",
      headers: { ...(init.headers ?? {}), ...(cookie ? { cookie } : {}) },
    });
    for (const raw of res.headers.getSetCookie()) {
      const [pair, ...attrs] = raw.split(";");
      const eq = pair.indexOf("=");
      const name = pair.slice(0, eq).trim();
      const value = pair.slice(eq + 1).trim();
      const dead =
        value === "" ||
        attrs.some((a) => /^\s*max-age=0\s*$/i.test(a)) ||
        attrs.some((a) => /^\s*expires=/i.test(a) && new Date(a.split("=")[1]) < new Date());
      if (dead) this.jar.delete(name);
      else this.jar.set(name, value);
    }
    return res;
  }

  /** GET a page. Returns the HTML, or the Location when Next redirects. */
  async page(path: string): Promise<Res<never>> {
    const res = await this.raw(path);
    const text = res.status < 300 || res.status >= 400 ? await res.text() : "";
    return {
      status: res.status,
      body: undefined as never,
      text,
      location: res.headers.get("location"),
    };
  }

  async get<T = Record<string, unknown>>(path: string): Promise<Res<T>> {
    return this.send<T>("GET", path);
  }

  async post<T = Record<string, unknown>>(path: string, body?: unknown): Promise<Res<T>> {
    return this.send<T>("POST", path, body);
  }

  async patch<T = Record<string, unknown>>(path: string, body?: unknown): Promise<Res<T>> {
    return this.send<T>("PATCH", path, body);
  }

  async del<T = Record<string, unknown>>(path: string, body?: unknown): Promise<Res<T>> {
    return this.send<T>("DELETE", path, body);
  }

  private async send<T>(method: string, path: string, body?: unknown): Promise<Res<T>> {
    const res = await this.raw(path, {
      method,
      ...(body === undefined
        ? {}
        : { headers: { "content-type": "application/json" }, body: JSON.stringify(body) }),
    });
    const text = await res.text();
    let parsed: unknown = {};
    try {
      parsed = JSON.parse(text);
    } catch {
      // A page or a download, not JSON. `text` still carries it.
    }
    return {
      status: res.status,
      body: parsed as T,
      text,
      location: res.headers.get("location"),
    };
  }
}

// ——— things only the database knows ——————————————————————————

/**
 * The OTP, read straight out of sqlite rather than off the API response.
 * `devCode` is suppressed in production and this suite runs a production
 * build — testing the code path that ships beats testing the dev affordance.
 */
export function otpFor(email: string): string {
  const d = new DatabaseSync(DB_FILE, { readOnly: true });
  try {
    const row = d.prepare("SELECT code FROM otps WHERE email = ?").get(email) as
      | { code: string }
      | undefined;
    assert.ok(row, `no OTP was issued for ${email}`);
    return row.code;
  } finally {
    d.close();
  }
}

export function query<T>(sql: string, ...params: (string | number)[]): T[] {
  const d = new DatabaseSync(DB_FILE, { readOnly: true });
  try {
    return d.prepare(sql).all(...params) as T[];
  } finally {
    d.close();
  }
}

export function exec(sql: string, ...params: (string | number)[]): void {
  const d = new DatabaseSync(DB_FILE);
  try {
    d.prepare(sql).run(...params);
  } finally {
    d.close();
  }
}

// ——— flows ————————————————————————————————————————————————

export type Flow = { name: string; run: (ok: Ok) => Promise<void> };
export type Ok = (label: string, fn: () => void | Promise<void>) => Promise<void>;

/** Drives a job to a terminal state, or fails loudly rather than hanging. */
export async function awaitJob(c: Client, jobId: string, ms = 30_000) {
  const deadline = Date.now() + ms;
  for (;;) {
    const res = await c.get<{ status: string; recipeId: string | null; slug: string | null; error: { message: string; fallback: string } | null }>(
      `/api/import/${jobId}`,
    );
    assert.equal(res.status, 200, `job poll answered ${res.status}: ${res.text}`);
    if (res.body.status === "done" || res.body.status === "failed") return res.body;
    assert.ok(Date.now() < deadline, `job ${jobId} never finished`);
    await sleep(150);
  }
}

/** Signs a client in, creating the account on first use. Returns the email. */
export async function signIn(c: Client, email: string): Promise<{ claimed: number }> {
  const sent = await c.post<{ sent: boolean }>("/api/auth", { email });
  assert.equal(sent.status, 200, `send-code answered ${sent.status}: ${sent.text}`);
  const done = await c.post<{ ok: boolean; claimed: number }>("/api/auth", {
    email,
    code: otpFor(email),
  });
  assert.equal(done.status, 200, `sign-in answered ${done.status}: ${done.text}`);
  return { claimed: done.body.claimed };
}

/** Guest imports the caption and lands on a draft recipe. */
export async function importCaption(c: Client, text = CAPTION) {
  const started = await c.post<{ jobId: string }>("/api/import", { rawText: text });
  assert.equal(started.status, 200, `import answered ${started.status}: ${started.text}`);
  const job = await awaitJob(c, started.body.jobId);
  assert.equal(job.status, "done", `import failed: ${JSON.stringify(job.error)}`);
  assert.ok(job.recipeId);
  return { jobId: started.body.jobId, recipeId: job.recipeId, slug: job.slug! };
}
