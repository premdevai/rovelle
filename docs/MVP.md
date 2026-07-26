# Rovelle — MVP specification, status and verification

**Purpose of this document.** A single place to (a) see every feature that has
been asked for, (b) understand how each one works, (c) check what is actually
built versus what is not, and (d) test, evaluate and fix it. Written to be the
only context needed to pick this project up cold.

**Last verified:** 26 July 2026, against a clean `npm run build` and a live run
of the full video pipeline.

**Status vocabulary used throughout:**

| Mark | Meaning |
|---|---|
| **BUILT** | Implemented, exercised, and verified working — command to prove it is given |
| **PARTIAL** | Works, but not to the standard the product needs |
| **NOT BUILT** | Specified here, no code yet |
| **v2** | Deliberately deferred |

---

## 1. The product, in one flow

This is the intended shape. Section 3 says how much of it exists.

```
                    ┌──────────────────────────────────────┐
   land on  /  ───▶ │ logged in?  ──yes──▶ dashboard        │
                    │             ──no───▶ URL input, right │
                    │                      there on the page│
                    └──────────────────────────────────────┘
                                   │
                          paste a public URL
                                   │
                                   ▼
              ╔════════════════════════════════════════╗
              ║  LIVE PROCESSING SCREEN                ║
              ║  real-time feedback, the way a modern  ║
              ║  LLM app streams its work — not a      ║
              ║  spinner, not four static ticks        ║
              ╚════════════════════════════════════════╝
                                   │
                    download → transcribe → extract
                                   │
                                   ▼
              ┌────────────────────────────────────────┐
              │  RRF DOCUMENT — the source of truth     │
              │  Everything downstream reads this and   │
              │  only this. Nothing else is canonical.  │
              └────────────────────────────────────────┘
                     │                          │
              want to save it?            start cooking
                     │                          │
              ▼ NOW ask for an account          ▼
              cookbook, history,        ┌───────────────────┐
              past cooks, search        │ COOK MODE          │
                                        │ wave / voice mode  │
                                        │ complete hands-off │
                                        └───────────────────┘
                                                 │
                                    voice in ──▶ RRF context ──▶ LLM
                                    voice out ◀── grounded answer
```

**Two principles that everything else follows from:**

1. **No account until there is something to lose.** A visitor gets the full
   import and the full cook without signing in. The account exists to make a
   recipe *persist*, and that is the only moment it is asked for.
2. **The RRF document is the source of truth.** It sits between the cook and
   the model. Voice questions are answered *from the document*, not from the
   model's memory of cooking. This is what stops the assistant inventing a
   quantity, and it is the difference between a cooking companion and a
   chatbot that happens to be open in the kitchen.

---

## 2. Feature inventory

### 2.1 Ingestion

| # | Feature | Status | Where |
|---|---|---|---|
| I1 | Paste a public URL, download the video | **BUILT** | `src/lib/media.ts` |
| I2 | Audio extraction, 16 kHz mono, chunked to 28s | **BUILT** | `media.ts` `listen()` |
| I3 | Speech → English text in any source language | **BUILT** | Sarvam Saaras v3 |
| I4 | Per-chunk timestamps → `source_ts_s` on steps | **BUILT** | `media.ts` `transcribeChunks()` |
| I5 | Read the video description | **BUILT** | `media.ts` `probe()` |
| I6 | Read recipe posted in the comments | **BUILT** | `media.ts` `pickRecipeComments()` |
| I7 | Strip creator promo before it costs tokens | **BUILT** | `parse.ts` `isBoilerplate()` |
| I8 | YouTube 403 resilience (player-client ladder) | **BUILT** | `media.ts` `CLIENTS` |
| I9 | Paste caption / transcript instead | **BUILT** | `/import` door two |
| I10 | Photo of a page → OCR | **BUILT** | Sarvam Vision, `sarvam.ts` `ocr()` |
| I11 | Instagram / TikTok download | **PARTIAL** | see §6.2 |
| I12 | Cross-user extraction cache | **BUILT** | `jobs.ts` `cachedDraft()` |

### 2.2 Extraction

| # | Feature | Status | Where |
|---|---|---|---|
| E1 | Structured recipe (RRF v1) | **BUILT** | `src/lib/rrf.ts` |
| E2 | Never fabricate a quantity | **BUILT** | enforced in both paths |
| E3 | Per-step timers | **BUILT** | `duration_s` |
| E4 | Temperature, in Celsius | **BUILT** | `temperature_c` |
| E5 | **Cookware** — what it happens in | **BUILT** | `vessel` |
| E6 | **Heat level** | **BUILT** | `heat` |
| E7 | **Doneness cue** — how you know it's ready | **BUILT** | `doneness_cue` |
| E8 | **Hands-on / walk-away** | **BUILT** | `hands_on` |
| E9 | Tadka / tempering as its own phase | **BUILT** | verified by test |
| E10 | Whole vs ground spices distinguished | **BUILT** | verified by test |
| E11 | Hinglish method headers | **BUILT** | `parse.ts` `METHOD_HEADER` |
| E12 | Confidence per field, flagged for review | **BUILT** | `fieldsNeedingReview()` |
| E13 | Local parser fallback, zero credits | **BUILT** | `parse.ts` |

### 2.3 Cooking

| # | Feature | Status | Where |
|---|---|---|---|
| C1 | One step full-screen, giant done target | **BUILT** | `cook-mode.tsx` |
| C2 | Per-step ring timer, wall-clock accurate | **BUILT** | `StepTimer` |
| C3 | Never auto-advance | **BUILT** | by design |
| C4 | Screen never sleeps | **BUILT** | `navigator.wakeLock` |
| C5 | Ingredient drawer, one tap | **BUILT** | `IngredientDrawer` |
| C6 | Concurrent background timers | **BUILT** | `BackgroundStrip` |
| C7 | Resume within 6 hours | **BUILT** | `cook-host.tsx` |
| C8 | Full keyboard control | **BUILT** | space / ← → / I / P / Esc |
| C9 | Voice Q&A grounded in the RRF | **BUILT** | `ask.ts` |
| C10 | Hands-free wake word ("chef") | **BUILT** | `cook-voice.tsx` |
| C11 | **Wave gesture to enter voice mode** | **NOT BUILT** | §5.3 |
| C12 | Live camera feed | **v2** | intentionally deferred |

### 2.4 Account, library, output

| # | Feature | Status | Where |
|---|---|---|---|
| A1 | **Anonymous import — no login to try** | **NOT BUILT** | §5.1 — biggest gap |
| A2 | **Account only when saving** | **NOT BUILT** | §5.1 |
| A3 | Email OTP, no password | **BUILT** | `auth.ts` |
| A4 | Cookbook with search and sort | **BUILT** | `/cookbook` |
| A5 | Cooked count, last cooked | **BUILT** | north-star event |
| A6 | Personal notes, attributed | **BUILT** | `notes.tsx` |
| A7 | Export JSON + Markdown | **BUILT** | `/api/export` |
| A8 | Edit anything; the cook's version wins | **BUILT** | `user_edited` latch |
| A9 | Free tier, 5 imports/month | **BUILT** | `spendImport()` |

### 2.5 Language

| # | Feature | Status | Where |
|---|---|---|---|
| L1 | Understand any Indian language spoken in a reel | **BUILT** | Saaras `translate` mode |
| L2 | UI in 13 languages | **PARTIAL** | 6 of 13 generated |
| L3 | Render a recipe in another language | **BUILT** | `translate-recipe.ts` |
| L4 | Speak answers back in the cook's language | **BUILT** | Bulbul, browser fallback |
| L5 | Ask a question in any language | **BUILT** | Saaras → English → grounded answer |

---

## 3. How each subsystem works

### 3.1 The ingestion pipeline

`src/lib/media.ts` → `src/lib/extract.ts`

```
probe(url)          yt-dlp --dump-single-json --write-comments
                    ├─ title, uploader, duration
                    ├─ description
                    └─ comments, scored for recipe-likeness, top 2 kept

download(url)       yt-dlp -f bestaudio -x --audio-format wav
                    player-client ladder: default → android_vr → mweb
                    (measured: default 403s after ~a dozen pulls;
                     android_vr returns 1.5 MB audio-only and works)

ffmpeg              -f segment -segment_time 28 -ar 16000 -ac 1
                    Sarvam's sync STT refuses anything over 30s

transcribeChunks()  4 concurrent → POST /speech-to-text
                    model=saaras:v3  mode=translate
                    mode=translate means a Tamil voiceover arrives as
                    English, so one extraction prompt serves every language
                    chunk index × 28 = the timestamp for every cue

cleanup             finally { rm -rf tmpdir }   media never persists
```

**Why chunking, and why the timestamps matter.** Sarvam's synchronous STT caps
at 30 seconds and returns no timestamps. Chunking at 28s and multiplying the
chunk index gives every transcript cue an offset for free, and those offsets
become `source_ts_s` on each step — which is what lets a step point back into
the original video without re-hosting it.

### 3.2 Extraction, and why it is shaped the way it is

**The constraint that dictated the design:** the Sarvam account is starter
tier. `max_tokens` is hard-capped at 4096, and Sarvam-105B is a *reasoning*
model — its chain of thought comes back in `reasoning_content` and counts
against that same 4096. Ask it to analyse a transcript and it will spend the
entire budget deliberating and return `content: null`. Measured, repeatedly:

| Attempt | Result |
|---|---|
| One call, whole RRF, verbose prompt | 4096 tokens of reasoning, `content: null` |
| One call, terse prompt | JSON truncated mid-array |
| Two calls (pantry / method) | pantry OK, method `content: null` |
| Method split into 1-minute windows | still `content: null` |
| **Parser segments, model enriches** | **works** |

So extraction is now **three stages**:

```
1. PANTRY     one call. Sarvam-105B reads description + comments + transcript
              → title, summary, cuisine, servings, time, difficulty, tools,
                storage, ingredients[]
              positional arrays, not keyed JSON — halves the output tokens

2. SEGMENT    zero calls. parse.ts splits the transcript into ordered
              candidate steps, deterministically, with timers already read

3. ENRICH     one call per 8 steps. The model REWRITES each line as a clean
              imperative and adds vessel / heat / doneness_cue / hands_on /
              phase. A transformation, not an analysis — so it barely reasons
```

Every stage degrades rather than fails. A failed enrich batch keeps the
parser's own wording for those steps. A failed pantry call falls back to the
parser entirely. **An import never dies because the model had a bad day.**

**Phase smoothing.** Each enrich batch judges phase independently, so a lone
step occasionally disagrees with the eight around it. Single-step islands are
absorbed into their neighbours before grouping.

### 3.3 RRF — the source of truth

`src/lib/rrf.ts`. One zod schema that is simultaneously the storage format,
the export format and the model's output contract. If those ever diverge,
"your cookbook is yours forever" stops being true.

```jsonc
{
  "rrf": "1.0", "id": "rcp_…", "title": "…", "summary": "…",
  "servings": { "amount": 4, "unit": "portions", "scalable": true },
  "time": { "prep_min": 10, "cook_min": 28, "total_min": 38 },
  "ingredients": [{ "id":"ing_1", "name":"…", "qty": 600, "unit":"g",
                    "note":"patted dry", "group":"tadka", "optional": false,
                    "confidence": 0.94 }],
  "phases": [{ "id":"ph_1", "name":"Tadka", "steps":[{
      "id":"st_1", "text":"…",            // rewritten, never the creator's words
      "duration_s": 30, "temperature_c": null,
      "vessel": "kadai",                   // ─┐
      "heat": "medium",                    //  │ the four fields that make
      "doneness_cue": "cumin stops sputtering", // │ voice answers possible
      "hands_on": false,                   // ─┘
      "ingredient_ids": ["ing_9"], "source_ts_s": 56.0, "confidence": 0.8 }]}],
  "meta": { "cooked_count": 4, "user_edited": true, … }
}
```

**Invariants, all test-enforced:**

1. `qty: null` is valid and expected. A fabricated number is the
   highest-severity bug in the product.
2. `step.text` is rewritten. Verbatim creator prose is a legal defect.
3. Once `meta.user_edited` is true, no automated process writes to that
   document. One-way latch.
4. Export is `JSON.stringify`. No transform, no lossy path.

### 3.4 Voice — how the RRF sits between cook and model

`src/lib/ask.ts`, `src/app/api/ask/route.ts`

```
mic ──▶ Saaras STT (mode=translate)
          │  a question asked in Tamil arrives as English
          ▼
     ┌─────────────────────────────────────────────────┐
     │ answerLocally(recipe, question, stepIndex)      │
     │                                                 │
     │ Reads the RRF document ONLY:                    │
     │   "how much turmeric"  → ingredient lookup      │
     │   "how long"           → step.duration_s        │
     │   "how hot"            → step.temperature_c     │
     │   "what pan"           → step.vessel            │
     │   "how do I know"      → step.doneness_cue      │
     │   "next" / "back"      → step navigation        │
     │   unstated amount      → says so, never guesses │
     └─────────────────────────────────────────────────┘
          │ miss?
          ▼
     Sarvam-105B, with the whole recipe as context and an
     instruction to answer ONLY from it
          │
          ▼
     Bulbul TTS in the cook's language  (browser voice if mocked)
```

The deterministic lookup runs **first** and answers most real kitchen
questions with zero latency and zero credits. The model is the fallback, not
the front door. This is the "RRF sits between the consumer and the LLM"
architecture you described, and it is already in place.

### 3.5 Sarvam capability switches

Each capability is independently `mock` or `live`. Mock does real work on real
input — it never invents recipe content.

```
SARVAM_MODE=mock              # global default
SARVAM_MODE_EXTRACT=live      # Sarvam-105B structuring
SARVAM_MODE_STT=live          # Saaras — required for the video path
SARVAM_MODE_TTS=live          # Bulbul — else the browser speaks
SARVAM_MODE_TRANSLATE=live    # recipes in other languages
SARVAM_LIVE_BUDGET=200        # per-process ceiling; refuses past it
SARVAM_MAX_TOKENS=4096        # raise when the plan is upgraded
```

---

## 4. Testing methodology

### 4.1 The four levels

| Level | What it catches | Cost | Command |
|---|---|---|---|
| L1 Unit | Parser, RRF, store, answerer logic | free, 2s | `npm run check` |
| L2 Build | Type errors, server/client leaks | free, 40s | `npm run build` |
| L3 Route | Every screen renders, flows connect | free, 30s | §4.4 script |
| L4 Live | Real video, real Sarvam, real credits | ~8 calls | §4.5 |

**Run L1–L3 on every change. Run L4 before saying "the pipeline works".**

### 4.2 L1 — the assertion suite

`npm run check` — 44 assertions, no framework. Every one of them failed at
least once during development, which is the only justification a test needs.

Grouped by what would break:

```
quantities          2 tbsp · 250g · 1/2 · ½ · 1 ½ · 2-3 · "two" · unstated
fabrication rule    "salt to taste" · "as needed" · bare name · whole-parse sweep
line parsing        parentheticals · prep clauses · optional · name-then-amount
                    · promo rejection · prose that starts with a number
times & temps       seconds/minutes/hours · Fahrenheit → Celsius
Indian cuisine      tadka is its own group AND its own phase ·
                    "cumin seeds" never collapses to "cumin" ·
                    "For Dal -" names the group "dal" not "dal-"
chatter             presenter greetings never become steps
extraction          schema validity · unique step ids · ingredient links ·
                    export round-trip · scaling leaves to_taste alone
formatting          ½ not 0.5 · 30 sec not 1 min · "Salt, to taste" word order
voice               grounded answers · admits unstated · next/back · returns
                    null rather than guessing
urls                platform detection · youtube id shapes · cache normalisation
                    · Devanagari slugs
store               sqlite round-trip · user_edited latch · north-star counter
                    agrees in both places · notes · export parses back
```

**Adding a test:** open `src/lib/selfcheck.ts`, add an `ok("what breaks if
this regresses", () => { … })`. No fixtures, no setup.

### 4.3 L2 — build

```bash
npm run typecheck   # tsc --noEmit
npm run build       # catches server-only imports leaking into client bundles
```

The build is the only thing that catches a client component importing
`next/headers` through a chain — which happened, via `lib/i18n`.

### 4.4 L3 — route smoke test

```bash
npm run build && npx next start -p 3111 &
sleep 6

# sign in (dev prints the OTP to the server log)
curl -s -c /tmp/c -X POST localhost:3111/api/auth \
  -H 'content-type: application/json' -d '{"email":"you@test.com"}'
CODE=$(grep -o 'sign-in code for you@test.com: [0-9]*' nohup.out | tail -1 | grep -o '[0-9]*$')
curl -s -b /tmp/c -c /tmp/c -X POST localhost:3111/api/auth \
  -H 'content-type: application/json' -d "{\"email\":\"you@test.com\",\"code\":\"$CODE\"}"

# import a pasted recipe, poll, confirm
JOB=$(curl -s -b /tmp/c -X POST localhost:3111/api/import \
  -H 'content-type: application/json' \
  -d '{"rawText":"Palak Paneer\n\nIngredients:\n250 g paneer\n500 g spinach\n2 tbsp ghee\nSalt to taste\n\nMethod:\nBlanch the spinach for 2 minutes.\nHeat the ghee and crackle the cumin for 30 seconds."}' \
  | python3 -c 'import sys,json;print(json.load(sys.stdin)["jobId"])')
sleep 2
curl -s -b /tmp/c localhost:3111/api/import/$JOB | python3 -m json.tool

# every screen returns 200
for P in /cookbook /import /settings /r/palak-paneer /r/palak-paneer/cook \
         /r/palak-paneer/edit /r/palak-paneer/cook/done; do
  echo "$P $(curl -s -b /tmp/c -o /dev/null -w '%{http_code}' localhost:3111$P)"
done
```

### 4.5 L4 — the live pipeline test

The only test that proves the product works. Costs roughly 8 Sarvam calls
(4 STT + 1 pantry + ~3 enrich) per run.

```bash
export PATH="$HOME/.local/bin:/opt/homebrew/bin:$PATH"   # yt-dlp, ffmpeg
SARVAM_MODE_STT=live SARVAM_MODE_EXTRACT=live npx tsx scripts/live-pipeline.mts <url>
```

**What to look at, in order of severity:**

1. **Did any quantity get invented?** Cross-check every `qty` against the
   description or transcript. This is the only failure that is unacceptable.
2. Did the tadka become its own phase?
3. Are `doneness_cue` fields populated? They are the highest-value field and
   the easiest for the model to skip.
4. Did presenter chatter get dropped?
5. Do timers match what was said?
6. Did any step keep the creator's exact wording? (legal defect)

### 4.6 Test corpus

Build this before scaling extraction. Forty videos, hand-labelled:

| Bucket | n | Tests |
|---|---|---|
| Caption-rich Western | 8 | baseline; should be near-perfect |
| Audio-only, no caption | 8 | the STT → structure chain |
| Indian / South Asian | 12 | the moat: tadka, transliteration, whole vs ground, "to taste" |
| Long-form (>10 min) | 6 | latency, chunk count, step segmentation |
| Adversarial | 6 | no quantities, code-switched Hinglish, heavy music |

---

## 5. What is NOT built — the MVP gap list

Everything in §1's flow that does not exist yet, in priority order.

### 5.1 Anonymous-first flow — **P0, blocks the MVP**

**Now:** `/` shows a marketing hero for signed-out visitors with a "Try
import" button that goes to `/enter`. `POST /api/import` calls `requireUser()`
and 401s. A visitor cannot import anything without an account.

**Wanted:** the URL input is on the home page. Import, review and cook all
work signed-out. The account is requested only at "save to cookbook".

**Implementation sketch:**

```
1. Anonymous session
   lib/auth.ts — issue a signed `rovelle_guest` cookie holding a random id,
   set on first visit. Same HMAC as the real session, different claim.

2. Guest users in the store
   users table gains `is_guest INTEGER NOT NULL DEFAULT 0`.
   Guest rows are real rows — recipes, jobs and cook_sessions already key
   off user_id, so nothing else changes.

3. Relax the routes
   /api/import, /api/import/[jobId], /api/ask, /api/recipes/[id] (GET/PATCH)
   accept a guest. Only these still require a real account:
     - PATCH with status:"saved"      (the save moment)
     - /api/export
     - /cookbook, /settings

4. Home page
   src/app/page.tsx — render <ImportForm> inline for signed-out visitors
   instead of the "Try import" link. Same component, no duplication.

5. Claim on sign-up
   When a guest signs in, UPDATE recipes/jobs/cook_sessions SET user_id = real
   WHERE user_id = guest, then delete the guest row. One transaction.
   This is the step that must not be skipped — otherwise signing up loses
   the recipe the visitor just made, which is the worst possible moment.

6. Guest limits
   1 import per guest session, no persistence guarantee. Say so in the UI:
   "Sign in to keep this." — the honest pitch, at the honest moment.
```

**Verification:** with cookies cleared, paste a URL on `/`, reach a cooked
recipe, then sign in and confirm the recipe is in the cookbook with its
cooked-count intact.

### 5.2 Real-time processing feedback — **P1**

**Now:** four static phases (`Reading the video` → `Listening for the steps` →
`Pulling out ingredients` → `Building the recipe`), polled once a second, with
elapsed seconds. Honest, but coarse — a 60-second import sits on one line for
40 of them.

**Wanted:** the texture of a modern LLM app. Sub-progress inside each phase,
and partial results as they land.

**Implementation sketch:**

```
1. Finer events
   jobs table gains `events TEXT` — an append-only JSON array.
   media.ts already takes an onPhase callback; widen it:
     { phase, note, pct, at }
   Emit: "Found: Punjabi Dal Tadka by Kunal Kapur"
         "Downloaded 1.5 MB of audio"
         "Transcribing 4 of 4 chunks"      ← real counter, already known
         "Heard: 'heat the ghee, add cumin…'"   ← first cue, as it lands
         "Found 19 ingredients"
         "Writing step 12 of 18"

2. Stream instead of poll
   Replace GET /api/import/[jobId] polling with a Server-Sent Events route.
   Next route handler returning a ReadableStream; the client uses
   EventSource. Poll stays as the fallback.

3. Show the work
   progress.tsx renders the event log as a terminal-style feed, newest
   last, with the ingredient list materialising above it as it is parsed.
```

**Verification:** import a 2-minute video and confirm the screen changes at
least every 3 seconds.

### 5.3 Wave gesture to enter voice mode — **P1**

**Now:** hands-free is a **button** plus the wake word "chef". Better than
push-to-talk, but it still needs one clean tap to arm.

**Wanted:** wave at the phone, voice mode engages. Zero contact.

**Implementation sketch — no ML model needed:**

```
Wave detection via frame differencing:
  1. getUserMedia({ video: { facingMode: "user", width: 320 } })
  2. draw to a 32×24 offscreen canvas, grayscale
  3. per frame, sum |pixel - previousPixel|
  4. a wave = motion energy crossing a threshold, oscillating
     left-half vs right-half of the frame, 2+ times in 1.5s
     (that oscillation test is what separates a wave from someone
      simply walking past, which is the false positive that matters)
  5. debounce 5s, and only while Cook Mode is open

~80 lines, no dependency, runs at 10fps on a 32×24 buffer for
negligible battery. Camera frames never leave the device and are never
recorded — say that in the UI next to the toggle, because a camera
permission prompt in a kitchen app needs an immediate explanation.

Fallback stays: the button, and the wake word.
```

**Verification:** wave from 1m with wet hands. Then deliberately try to
false-trigger it — walk past, stir a pan, reach for a spice jar.

### 5.4 Instagram / TikTok — **P1**

`yt-dlp` handles YouTube. Instagram login-walls datacenter IPs and TikTok is
inconsistent. Both currently fall through to the paste door.

Options, cheapest first: (a) let the user paste the caption — works today,
zero infrastructure, legally cleanest; (b) residential proxy pool, €30–80/mo;
(c) a share-sheet extension capturing from the user's own logged-in app —
the only durable answer, and worth prioritising earlier than instinct says.

### 5.5 Smaller gaps

| Gap | Effort |
|---|---|
| 7 of 13 UI languages ungenerated | `npm run locales -- --all`, ~25 min, ~90 calls |
| Email delivery — OTP only reaches the server log | wire Resend/SES, ~20 lines |
| Recipe images — extract a frame at `source_ts_s` | ffmpeg already present |
| Translation quality unreviewed by native speakers | needs humans |

---

## 6. Known constraints

### 6.1 The Sarvam starter tier is the binding constraint

| Limit | Value | Consequence |
|---|---|---|
| `max_tokens` | 4096 hard | Above it → HTTP 400, not truncation |
| Reasoning | counts against the same budget | Why extraction is three stages |
| STT sync | 30s per request | Why audio is chunked at 28s |
| Rate limits | aggressive | Backoff in `gen-locales.mts`; concurrency capped at 4 |

**On upgrade:** raise `SARVAM_MAX_TOKENS`, and the enrich stage can merge back
into a single method call. The seam is `extractMethod()` in `extract.ts`.

### 6.2 Platform retrieval is adversarial

YouTube begins returning 403 after roughly a dozen downloads from one IP. The
player-client ladder handles it today. At volume it will not; that is what the
proxy pool and share-sheet extension are for. **Plan for this rather than
discovering it in week four.**

### 6.3 Legal posture

- User-initiated retrieval only. No crawler, no bulk ingest.
- Media is transient — deleted in a `finally`, never re-hosted.
- Steps are **rewritten**, never copied. Enforced in the prompt, spot-check it.
- Attribution and a link back on every recipe and every export.

---

## 7. The fix loop

When something is wrong, in this order:

```
1. REPRODUCE at the cheapest level that shows it.
   Bad quantity → a parse.ts unit test, not a live video.
   Bad step wording → the enrich prompt, not the whole pipeline.

2. WRITE THE ASSERTION FIRST, in selfcheck.ts, and watch it fail.
   Every test in there exists because something broke. That is the bar.

3. FIX.

4. RE-RUN THE LADDER.  npm run check && npm run build && L3

5. RE-RUN L4 if the change touched media, extract, parse or sarvam.

6. If it was a live-API discovery, WRITE THE MEASUREMENT INTO THE COMMENT
   next to the code. "reasoning_effort: low measured worse — 300 tokens and
   a truncation, versus 80 and a clean answer" is worth more than "don't
   use reasoning_effort", because the next person can check whether it is
   still true.
```

**Triage by severity:**

| Severity | Example | Response |
|---|---|---|
| **S0** | A quantity was invented | Stop. Assertion, fix, audit the whole path. |
| S0 | Creator's prose reproduced verbatim | Legal defect. Same treatment. |
| S1 | Import fails on a common source | Fix the fallback so it degrades, then fix the cause |
| S1 | Voice answers from model memory, not the RRF | Grounding regression |
| S2 | Wrong phase, clumsy wording, missing cue | Prompt work, batch it |
| S3 | Layout, copy | Batch it |

---

## 8. Commands

```bash
cd app
npm install
cp .env.example .env.local          # add SARVAM_API_KEY
npm run dev                         # http://localhost:3000

npm run check                       # 44 assertions
npm run typecheck
npm run build
npm run locales -- --all            # regenerate every UI language

brew install yt-dlp ffmpeg          # required for the video path
```

**Rotate the Sarvam API key** — the one in `.env.local` was shared in a chat
transcript and should be considered public.

---

## 9. Where things live

```
app/src/
  app/
    page.tsx                    landing (§5.1 changes this)
    enter/                      S10 auth
    import/                     S1 · [jobId] S2 · [jobId]/review S3
    cookbook/                   S8
    settings/                   S9
    r/[slug]/                   S4 · edit S5 · cook S6 · cook/done S7
    api/
      import/                   enqueue + poll
      recipes/[id]/             save · notes · cook · translate
      ask/                      the voice endpoint
      auth/ locale/ export/
  components/
    ui.tsx                      design primitives — change design here
    cook-mode.tsx               the instrument
    cook-voice.tsx              wake word, hands-free (§5.3 extends this)
    recipe-editor.tsx           S3 + S5 share it
    shell.tsx                   app chrome
  lib/
    rrf.ts                      THE SCHEMA — source of truth
    media.ts                    download, chunk, transcribe
    extract.ts                  pantry → segment → enrich
    parse.ts                    the deterministic parser
    sarvam.ts                   every Sarvam call, mock/live switch
    ask.ts                      grounded answering
    jobs.ts                     queue + worker
    recipes.ts                  store operations
    db.ts                       node:sqlite schema
    i18n/                       UI strings + generated locales
    selfcheck.ts                the 44 assertions
docs/
  PRD.md  XRD.md  TECH-SPEC.md  MVP.md
```
