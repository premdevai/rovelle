# Rovelle — Technical Specification

**Companion to** `PRD.md`, `XRD.md`

---

## 1. Stack

Free-tier-first, self-hostable, terminal-native. No vendor that can't be swapped in an afternoon.

| Layer | Choice | Why |
|---|---|---|
| Web | Next.js 15 (App Router, RSC) + TypeScript | You already live here |
| Styling | Tailwind v4 (CSS-first `@theme`) | Tokens as CSS vars, no config file drift |
| DB | Postgres (Neon free → your VPS) via Drizzle | SQL you can read; Drizzle migrations in-repo |
| Queue | **Postgres job table + `FOR UPDATE SKIP LOCKED`** | No Redis, no SQS, no bill. Handles 10k jobs/day easily. |
| Worker | Node + Python sidecar, systemd on your VPS | Same box and same pattern as `clipd` |
| ASR | `faster-whisper` (CPU, `small.en` / `medium` for multilingual) | Already proven on your KVM2 |
| Fetch | `yt-dlp` + platform oEmbed | Proven; see §5 on IP risk |
| LLM | Claude (Sonnet) via Anthropic API, JSON-constrained | Structuring only, ~$0.01–0.03/import |
| Auth | Better Auth, email OTP | Self-hostable, free, no password surface |
| Blob | Cloudflare R2 | Thumbnails only. Media is transient. |
| Observability | Your own Tare proxy + Sentry | Dogfood Tare on the extraction chain |

**Reuse note:** the Rovelle ingest worker is the `clipd` pipeline minus the render stage. `yt-dlp → audio extract → faster-whisper → structured output`. Fork the job-queue and systemd orchestration wholesale; do not rebuild.

## 2. Architecture

```
 Browser (Next.js)
   │  POST /api/import  { url | rawText }
   ▼
 Next.js API  ──▶  Postgres  ──▶  jobs table (status: queued)
   │                                   │
   │  GET /api/import/:id (poll 1s)    │  SKIP LOCKED claim
   │                                   ▼
   │                          Worker (VPS, systemd)
   │                            1. fetch      yt-dlp / oEmbed → meta + audio + caption
   │                            2. transcribe faster-whisper → segments w/ timestamps
   │                            3. extract    Claude → RRF JSON draft
   │                            4. validate   zod → RRF v1 → recipes.draft
   │                            5. cleanup    delete media
   ▼
 Review screen → user confirms → recipes.status = 'saved'
```

Worker is a **separate process**, not a Next.js route. Serverless timeouts will kill a 12-minute transcription; do not fight this.

## 3. Rovelle Recipe Format (RRF v1)

The durable contract. Export format, storage format, and LLM output format are the same object. If those ever diverge, export stops being a real guarantee.

```jsonc
{
  "rrf": "1.0",
  "id": "rcp_01HZ...",
  "title": "Weeknight Chicken Confit Pasta",
  "summary": "Slow-poached thighs, jammy garlic, glossy lemon-butter sauce.",
  "cuisine": "italian",              // free string; used for extraction hinting
  "servings": { "amount": 4, "unit": "portions", "scalable": true },
  "time": { "prep_min": 10, "cook_min": 28, "total_min": 38 },
  "difficulty": "easy",              // easy | medium | involved

  "source": {
    "platform": "instagram",         // instagram | tiktok | youtube | manual
    "url": "https://...",
    "handle": "@marcellahazan_estate",
    "creator_name": "Marcella Hazan Estate",
    "captured_at": "2026-07-26T09:14:00Z",
    "media_duration_s": 47
  },

  "ingredients": [
    {
      "id": "ing_1",
      "name": "Chicken thighs, bone-in",
      "qty": 600,                    // null when unstated — NEVER fabricate
      "unit": "g",                   // null | g|kg|ml|l|tsp|tbsp|cup|piece|pinch|handful|to_taste
      "note": "patted dry",
      "group": "main",               // for multi-component recipes: "marinade", "tadka", "garnish"
      "optional": false,
      "confidence": 0.94             // <0.75 renders with a review flag in S3
    }
  ],

  "tools": ["heavy saucepan", "tongs", "microplane"],

  "phases": [
    {
      "id": "ph_prep",
      "name": "Prep",
      "steps": [
        {
          "id": "st_1",
          "text": "Pat the chicken dry and salt it heavily.",   // REWRITTEN, never copied
          "duration_s": null,
          "temperature_c": null,
          "ingredient_ids": ["ing_1"],
          "source_ts_s": 3.2,          // jump-back point into the original video
          "confidence": 0.91
        }
      ]
    }
  ],

  "storage": "Pasta keeps 2 days refrigerated. Confit oil stores separately for a month.",
  "notes": [
    { "id": "nt_1", "body": "Mum's version uses confit garlic instead.",
      "author": "Mum", "created_at": "2026-02-12T19:40:00Z" }
  ],

  "meta": {
    "cooked_count": 4,
    "last_cooked_at": "2026-02-12T20:31:00Z",
    "user_edited": true,             // once true, extraction never overwrites
    "extraction_model": "claude-sonnet-4-6",
    "extraction_version": "2026.07.1"
  }
}
```

**Invariants**

1. `qty: null` is valid and expected. A fabricated number is a bug of the highest severity.
2. `step.text` is a rewritten imperative instruction. Verbatim caption text is a legal defect (PRD §9).
3. Once `meta.user_edited === true`, no automated process writes to that recipe.
4. `source_ts_s` on every step where derivable — it powers "show me this bit" without re-hosting the video.
5. Export is `JSON.stringify(rrf)`. No transform. No lossy Markdown-only path.

Reference implementation: `app/src/lib/rrf.ts` (zod).

## 4. Data model

```sql
users        (id, email, plan, created_at)
recipes      (id, user_id, slug, rrf jsonb, status, created_at, updated_at,
              cooked_count int default 0, last_cooked_at)
jobs         (id, user_id, kind, input jsonb, status, phase, attempts,
              error, result_recipe_id, locked_at, locked_by, created_at)
cook_sessions(id, user_id, recipe_id, current_step, started_at, completed_at)
collections  (id, user_id, name) / collection_recipes (collection_id, recipe_id)
```

RRF lives as a single `jsonb` column. Do not normalise ingredients into tables in v1 — the whole document is the unit of edit, versioning, and export. Add GIN indexes on `rrf` for search when the cookbook exceeds a few hundred rows.

Job claim:

```sql
UPDATE jobs SET status='running', locked_at=now(), locked_by=$1
WHERE id = (SELECT id FROM jobs WHERE status='queued'
            ORDER BY created_at FOR UPDATE SKIP LOCKED LIMIT 1)
RETURNING *;
```

Reaper: any `running` job with `locked_at < now() - interval '10 minutes'` → `queued`, `attempts+1`. Three attempts then `failed`, and the user is routed to the paste-fallback.

## 5. Fetch layer — the actual hard problem

`yt-dlp` against Instagram and TikTok from a datacenter IP will be login-walled or 403'd within days. Plan for it now rather than discovering it in week 4.

**Cascade, cheapest and most durable first:**

1. **oEmbed / public metadata** — caption + thumbnail, no media. For caption-rich creators this alone is often sufficient and takes ~1s. This is where the "4.2s" marketing claim actually lives.
2. **`yt-dlp` audio-only** (`-f ba -x`) via residential proxy pool for IG/TikTok. YouTube tolerates datacenter IPs far better — route YT direct, proxy only IG/TT.
3. **Paste fallback** — user pastes caption or transcript. Zero infrastructure, 100% reliability, and legally the cleanest path.
4. **Share-sheet extension (v2)** — capture from the user's own logged-in app. This is the only durable long-term answer. Prioritise it earlier than instinct suggests.

Cache by normalised source URL across all users with a 30-day TTL. Popular reels get imported many times; pay for each once.

## 6. Extraction — prompt contract & eval

**System contract (abridged; full prompt in `worker/prompts/extract.md`):**

- Output valid RRF v1 JSON only. No prose, no fences.
- Rewrite every instruction in your own imperative words. Do not reproduce the creator's phrasing.
- If a quantity is not stated, emit `qty: null` and set `unit` to `"to_taste"` or leave null. Never estimate.
- Emit `confidence` per ingredient and step, honestly. Audio-only numerics cap at 0.8.
- Preserve technique vocabulary in its own language where it is the correct name for the action (`tadka`, `bhuna`, `dum`, `soffritto`, `deglaze`) and gloss it in the step text.
- Treat a tempering/tadka as its own **phase**, not an ingredient list.
- Whole vs. ground spices are distinct ingredients (`cumin seeds` ≠ `ground cumin`).

**Eval set — build this before scaling extraction.** 40 videos with hand-labelled RRF:

| Bucket | n | Why |
|---|---|---|
| Caption-rich Western | 8 | Baseline, should be near-perfect |
| Audio-only, no caption | 8 | Tests ASR→structure chain |
| Indian / South Asian | 12 | The moat. Tadka phases, transliteration, whole vs ground, "to taste". |
| Long-form YouTube (>10 min) | 6 | Latency + step segmentation |
| Adversarial (no quantities, code-switched Hinglish, heavy music) | 6 | Failure-mode honesty |

Scored on: ingredient F1, quantity exact-match, phase segmentation accuracy, **fabrication rate (must be 0)**. Run on every prompt change. Pipe through Tare for prompt-assembly telemetry.

## 7. Build order

| Slice | Ships | Gate |
|---|---|---|
| **0** | Repo, tokens, DB, auth, empty shell | Login works |
| **1** | RRF zod schema + manual recipe create/edit/view | Round-trips through export/import |
| **2** | **Cook Mode, fully** | One-handed, wet-hand test passes. *Build the instrument before the importer.* |
| **3** | Paste-fallback import (text → Claude → RRF → review) | 10 pasted captions, ≥60% zero-edit |
| **4** | Job queue + worker + YouTube fetch + Whisper | p95 ≤ 45s on 12-min video |
| **5** | Instagram + TikTok fetch, proxy, caching | 20 real reels, honest failure rate documented |
| **6** | Cookbook index, notes, cooked-count, export | North-star event instrumented end to end |
| **7** | Billing, free-tier limits, Pro gates | Free→Pro path testable |

**Slice 2 before Slice 3 is deliberate.** Cook Mode is the product; the importer is plumbing. Building it first means every extraction decision is made with knowledge of what Cook Mode actually needs from a step — which is how you avoid an RRF schema that parses beautifully and cooks badly.

## 8. Cost model (1,000 active cooks, 8 imports/mo each)

| Item | Monthly |
|---|---|
| Claude extraction (8k tok in / 2k out × 8k imports) | ~€160 |
| Whisper (your VPS, CPU) | €0 |
| Residential proxy (IG/TT) | €40–80 |
| Neon / Postgres | €0 → €19 |
| R2 thumbnails | ~€1 |
| **Total** | **~€200–260** |

At 6% Pro conversion (60 × €6.99) = €420. Thin but positive. The lever is caching popular reels and routing caption-rich imports around the LLM entirely with a cheap deterministic parser.
