import type { Platform } from "./rrf";

/**
 * The fetch cascade (TECH-SPEC §5), minus the parts that need a proxy pool.
 *
 * 1. oEmbed / public metadata — free, no auth, ~1s. TikTok's oEmbed returns
 *    the full caption, which for a caption-rich creator is the entire recipe.
 * 2. YouTube caption track — public timedtext, no key. Gives per-line
 *    timestamps, which become RRF `source_ts_s` (invariant 4).
 * 3. Paste fallback — handled upstream; always available, never an error state.
 *
 * ponytail: no yt-dlp, no Whisper, no residential proxies. Those are the
 * €80/mo tier of this problem and they buy you Instagram, which login-walls
 * datacenter IPs anyway (PRD R1). Everything here works from a laptop today.
 * When you add the proxy pool, it slots in as step 2.5 and nothing else moves.
 */

export type Fetched = {
  platform: Platform;
  url: string;
  handle: string | null;
  creatorName: string | null;
  title: string | null;
  thumbnail: string | null;
  /** Caption, transcript, or both — whatever we could legitimately obtain. */
  text: string;
  /** Transcript lines with offsets, when the source gave us any. */
  cues: Array<{ t: number; text: string }>;
  durationS: number | null;
};

export class FetchFailed extends Error {
  constructor(public code: "LOGIN_WALL" | "PRIVATE" | "NO_TEXT" | "UNSUPPORTED" | "RATE_LIMITED", msg: string) {
    super(msg);
  }
}

const UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36";

export function detectPlatform(url: string): Platform | null {
  let h: string;
  try {
    h = new URL(url).hostname.replace(/^www\./, "").toLowerCase();
  } catch {
    return null;
  }
  if (h === "youtube.com" || h === "m.youtube.com" || h === "youtu.be") return "youtube";
  if (h === "tiktok.com" || h.endsWith(".tiktok.com")) return "tiktok";
  if (h === "instagram.com" || h.endsWith(".instagram.com")) return "instagram";
  return null;
}

/** Cache key. Strips tracking params so ?igshid=… doesn't defeat the cache. */
export function normaliseSourceUrl(url: string): string {
  const u = new URL(url);
  u.hash = "";
  u.hostname = u.hostname.replace(/^(www|m)\./, "");
  u.protocol = "https:";
  const keep = u.hostname.includes("youtube.com") ? ["v"] : [];
  for (const k of [...u.searchParams.keys()]) if (!keep.includes(k)) u.searchParams.delete(k);
  u.pathname = u.pathname.replace(/\/+$/, "");
  return u.toString();
}

export function youtubeId(url: string): string | null {
  const u = new URL(url);
  if (u.hostname.endsWith("youtu.be")) return u.pathname.slice(1) || null;
  const v = u.searchParams.get("v");
  if (v) return v;
  const m = u.pathname.match(/\/(shorts|embed|live)\/([\w-]+)/);
  return m?.[2] ?? null;
}

export async function fetchSource(url: string): Promise<Fetched> {
  const platform = detectPlatform(url);
  if (!platform) {
    throw new FetchFailed(
      "UNSUPPORTED",
      "That link isn't a video we can read. Try a Reel, Short, TikTok, or YouTube link.",
    );
  }
  if (platform === "youtube") return fetchYouTube(url);
  if (platform === "tiktok") return fetchTikTok(url);
  return fetchInstagram(url);
}

// ——— YouTube ——————————————————————————————————————————————

async function fetchYouTube(url: string): Promise<Fetched> {
  const id = youtubeId(url);
  if (!id) throw new FetchFailed("UNSUPPORTED", "We couldn't find a video id in that YouTube link.");

  const meta = await oembed(`https://www.youtube.com/oembed?url=${encodeURIComponent(`https://www.youtube.com/watch?v=${id}`)}&format=json`);
  const cues = await youtubeCaptions(id);
  const description = await youtubeDescription(id);

  const text = [
    meta?.title ?? "",
    description,
    cues.map((c) => c.text).join(" "),
  ]
    .filter(Boolean)
    .join("\n\n")
    .trim();

  if (text.length < 40) {
    throw new FetchFailed("NO_TEXT", "There's no readable speech or description in this video.");
  }

  return {
    platform: "youtube",
    url,
    handle: meta?.author_name ? `@${meta.author_name.replace(/\s+/g, "")}` : null,
    creatorName: meta?.author_name ?? null,
    title: meta?.title ?? null,
    thumbnail: meta?.thumbnail_url ?? `https://i.ytimg.com/vi/${id}/hqdefault.jpg`,
    text,
    cues,
    durationS: cues.length ? Math.round(cues[cues.length - 1].t) : null,
  };
}

/**
 * Public timedtext track. No API key, no quota.
 *
 * Measured reality as of July 2026: the watch page still exposes
 * `captionTracks`, but fetching those `baseUrl`s from an unauthenticated
 * client returns HTTP 200 with a zero-length body — YouTube now gates
 * timedtext behind a session token. The `youtubei` ANDROID-client route
 * returns 400. So this usually comes back empty, and that is expected, not a
 * regression: absence is handled by falling through to the description, which
 * does still work and for caption-rich creators carries the whole recipe.
 *
 * The durable fixes are a logged-in cookie jar, a residential proxy, or the
 * share-sheet extension (PRD R1) — all of which slot in right here. Until
 * then, spoken-only YouTube videos belong on the paste path.
 */
async function youtubeCaptions(id: string): Promise<Array<{ t: number; text: string }>> {
  try {
    const html = await (
      await fetch(`https://www.youtube.com/watch?v=${id}&hl=en`, {
        headers: { "User-Agent": UA, "Accept-Language": "en-US,en;q=0.9" },
      })
    ).text();

    const m = html.match(/"captionTracks":(\[.*?\])/);
    if (!m) return [];
    const tracks = JSON.parse(m[1]) as Array<{ baseUrl: string; languageCode: string; kind?: string }>;
    // Prefer a human track over ASR, and English over anything else.
    const pick =
      tracks.find((t) => t.languageCode.startsWith("en") && t.kind !== "asr") ??
      tracks.find((t) => t.languageCode.startsWith("en")) ??
      tracks[0];
    if (!pick) return [];

    const json = (await (
      await fetch(`${pick.baseUrl}&fmt=json3`, { headers: { "User-Agent": UA } })
    ).json()) as { events?: Array<{ tStartMs: number; segs?: Array<{ utf8: string }> }> };

    return (json.events ?? [])
      .map((e) => ({
        t: (e.tStartMs ?? 0) / 1000,
        text: (e.segs ?? []).map((s) => s.utf8).join("").replace(/\n/g, " ").trim(),
      }))
      .filter((c) => c.text.length > 0);
  } catch {
    return [];
  }
}

/** The description often holds the actual ingredient list with quantities. */
async function youtubeDescription(id: string): Promise<string> {
  try {
    const html = await (
      await fetch(`https://www.youtube.com/watch?v=${id}&hl=en`, {
        headers: { "User-Agent": UA },
      })
    ).text();
    const m = html.match(/"shortDescription":"((?:[^"\\]|\\.)*)"/);
    if (!m) return "";
    return JSON.parse(`"${m[1]}"`) as string;
  } catch {
    return "";
  }
}

// ——— TikTok ———————————————————————————————————————————————

async function fetchTikTok(url: string): Promise<Fetched> {
  const meta = await oembed(`https://www.tiktok.com/oembed?url=${encodeURIComponent(url)}`);
  if (!meta) {
    throw new FetchFailed("PRIVATE", "TikTok wouldn't return this one. It may be private or removed.");
  }
  // TikTok puts the whole caption in `title`. For caption-rich cooks that is
  // the recipe, quantities and all, for one free request.
  const text = meta.title ?? "";
  if (text.trim().length < 40) {
    throw new FetchFailed("NO_TEXT", "This TikTok has no caption for us to read.");
  }
  return {
    platform: "tiktok",
    url,
    handle: meta.author_unique_id ? `@${meta.author_unique_id}` : null,
    creatorName: meta.author_name ?? null,
    title: text.split("\n")[0]?.slice(0, 120) ?? null,
    thumbnail: meta.thumbnail_url ?? null,
    text,
    cues: [],
    durationS: null,
  };
}

// ——— Instagram ————————————————————————————————————————————

async function fetchInstagram(url: string): Promise<Fetched> {
  // Instagram's oEmbed needs a Facebook app token, and yt-dlp from a
  // datacenter IP gets login-walled (PRD R1). Rather than pretend, fail fast
  // and hand the user the paste door — which is also the cleanest legally.
  const token = process.env.FACEBOOK_OEMBED_TOKEN;
  if (token) {
    const meta = await oembed(
      `https://graph.facebook.com/v20.0/instagram_oembed?url=${encodeURIComponent(url)}&access_token=${token}&fields=author_name,thumbnail_url,title`,
    );
    if (meta?.title && meta.title.length > 40) {
      return {
        platform: "instagram",
        url,
        handle: meta.author_name ? `@${meta.author_name}` : null,
        creatorName: meta.author_name ?? null,
        title: meta.title.split("\n")[0]?.slice(0, 120) ?? null,
        thumbnail: meta.thumbnail_url ?? null,
        text: meta.title,
        cues: [],
        durationS: null,
      };
    }
  }
  throw new FetchFailed("LOGIN_WALL", "Instagram wouldn't return this one.");
}

// ——— shared ———————————————————————————————————————————————

type OEmbed = {
  title?: string;
  author_name?: string;
  author_unique_id?: string;
  thumbnail_url?: string;
};

async function oembed(endpoint: string): Promise<OEmbed | null> {
  try {
    const res = await fetch(endpoint, { headers: { "User-Agent": UA } });
    if (!res.ok) return null;
    return (await res.json()) as OEmbed;
  } catch {
    return null;
  }
}
