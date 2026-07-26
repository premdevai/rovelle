# Rovelle — demo script and UX lifecycle

Everything below is verified working as of the last run. Nothing here is a mockup.

---

## Before you start

```bash
cd /Users/premkumar/prem/Obsidian/Rovelle-MVP/app
export PATH="$HOME/.local/bin:/opt/homebrew/bin:$PATH"   # yt-dlp, ffmpeg
grep SARVAM_MODE .env.local        # must read: SARVAM_MODE=live
rm -f data/rovelle.db*             # a clean cookbook demos better
npm run build && npx next start -p 3000
```

Open an **incognito window** — the whole pitch is that a stranger with no
account can use it. A logged-in window skips the best part.

Have a YouTube cooking URL ready. Tested and working:
`https://www.youtube.com/watch?v=tmiGPrOiUQE` (Hindi, 98s, Kunal Kapur)

---

## The 4-minute demo

### 0:00 — The problem (20s, no screen)

> "Everyone saves cooking videos. Nobody cooks them. The recipe is trapped in
> someone's voice, in a language you might not speak, in a format you can't
> follow with wet hands. We save 40 a month and cook maybe one."

### 0:20 — Land, and paste (30s)

Open `/`. **Do not sign in.** Point at the input.

> "No sign-up. No account. Paste a link."

Paste the URL. It submits itself.

> "That's it. That's the whole onboarding."

### 0:50 — The processing screen (60s) — *let it run, narrate*

This is the screen that earns the demo. Read the events aloud as they land:

> "It's downloading the actual video. Extracting the audio. Now — this is
> Sarvam's Saaras model — it's **listening to a man speaking Hindi** and giving
> us English back. Four chunks, because their API caps at thirty seconds, so we
> split the audio and stitch the timestamps.
>
> Now Sarvam-105B is reading the description, the pinned comments, and the
> transcript together, and turning it into structure."

**If someone asks why it takes a minute:** it is downloading a real video and
making 8 real AI calls. Say that. It's a feature, not a delay.

### 1:50 — Review (40s)

> "It never auto-saves. You confirm, and in confirming it becomes *yours*
> rather than the AI's."

Point at three specific things:

1. **A blank quantity** — "the video never said how much. We leave it blank.
   A confident wrong number ruins dinner; a blank doesn't."
2. **A `check` flag** — "this one came from speech, not written text. We tell
   you which is which."
3. **The Tadka phase** — "the tempering is its own phase. Every generic
   importer flattens that into an ingredient line. This is the Indian-cuisine
   thing we actually got right."

Edit one field. Point out "edited — your version wins."

### 2:30 — The save gate (30s) — *the moment*

Click **Save to cookbook**.

> "Now — and only now — it asks who you are. You've already got the value. The
> account is to *keep* it."

Sign in with the code shown on screen.

> "And notice — the recipe I made before signing in came with me. It says
> `claimed: 1`. We move everything across in one transaction, including
> handling slug collisions, because losing someone's work at the exact moment
> you ask them to sign up is the worst bug you can ship."

### 3:00 — Cook Mode (60s) — *the product*

Click **Start cooking**.

> "Everything inverts. One step, full screen, a 72-pixel target, a ring timer.
> Nothing below 16px. The screen never sleeps."

Then the payload:

> "Every step carries what a cook actually asks: **what pan**, **what heat**,
> and **how do I know it's ready** — 'garlic turns light golden'. Timers lie,
> pans vary; that sensory cue is what an experienced cook goes by, and no
> recipe site records it."

Hit **Hands-free**, then say: **"Chef — how much rasam powder?"**

> "That answer came from the recipe document, not from the model's memory of
> cooking. The extracted recipe sits *between* the cook and the LLM. Ask about
> something that isn't in the recipe and it says so, instead of inventing it."

### 4:00 — Close (20s)

> "Any language in, any language out. It's a Hindi video; I could read it in
> Tamil and ask my question in Tamil too. Export is JSON, at launch, because
> permanence is the pitch — your cookbook is yours even if we disappear."

---

## The UX lifecycle — what happens at every stage

| Stage | User sees | Under the hood |
|---|---|---|
| **Land** | Hero + URL input, "No account needed" | No cookie set yet — a page view creates nothing |
| **Paste** | Input fills, autosubmits after 300ms | Guest user minted on POST, signed cookie |
| **Submit** | Button → "Reading it", locked | Job row queued, in-process worker kicked |
| **Fetch** | "Reading the video" · live events | yt-dlp probe → title, creator, description, top comments |
| **Download** | "Downloaded 1.5 MB of audio" | Audio-only, player-client ladder on 403 |
| **Transcribe** | "Transcribing chunk 2 of 4" | ffmpeg 28s chunks → Saaras, 4 concurrent, translate mode |
| **Extract** | "Found 19 ingredients" | Sarvam-105B pantry call, then parser segments, then enrich |
| **Validate** | "Building the recipe" | zod parse → RRF v1 → sqlite as a draft |
| **Review** | Editable recipe, flags on low confidence | Nothing saved yet; status is `draft` |
| **Save** | Sign-in modal | 401 `needsAccount:true` → gate, never an error |
| **Claim** | "your recipe came with you" | One transaction moves recipes, jobs, cook sessions |
| **Cook** | Full-screen step, ring timer | Wake lock, localStorage + server progress |
| **Ask** | Question and answer on screen, spoken | Saaras → grounded lookup → Bulbul |
| **Finish** | "Cooked." + note prompt | `cooked_count++`, north-star event fires |

---

## Verified working

```
57 automated assertions       selfcheck 44 · guest-check 7 · wave-check 6
build                         clean
guest journey                 all 10 steps green, end to end
live extraction               ~54s on a pasted recipe, ~95s on a video
video pipeline                URL → download → Saaras → 105B → RRF
grounded voice                "how much rasam powder" → "2 tsp rasam powder."
guest → account claim         claimed:1, nothing lost
fabrication audit             clean — every amount traces to the source
```

---

## Known gaps — say these before you're asked

Being straight about limits reads as confidence. Being caught out doesn't.

| Gap | The honest line |
|---|---|
| Instagram / TikTok download | "YouTube works today. Instagram login-walls datacenter IPs — that's a residential proxy or a share-sheet extension, and the paste fallback covers it meanwhile." |
| Step images | "The creator's thumbnail is real and hotlinked. Per-step frames from the video are next — we already have the timestamps." |
| 7 of 13 UI languages | "The generator's built and 6 are done. It's one command and ~25 minutes of API time." |
| Email delivery | "OTP goes to the server log. Resend is a 20-line wire-up, not a design problem." |
| Wave gesture | "Built and unit-tested against synthetic motion. Needs tuning in a real kitchen before I'd trust it on stage." |
| Starter tier | "max_tokens is 4096 and the model reasons inside that budget. That's why extraction is three stages instead of one — it's an architecture forced by a real constraint, and it's why it works at all." |

---

## If something breaks on stage

| Symptom | Do this |
|---|---|
| Import hangs past 2 min | Cancel → paste the caption instead. Same pipeline, ~15s. |
| YouTube 403 | Use the pasted-recipe path. Say the word "rate-limited" — everyone knows. |
| Sarvam 429 | `SARVAM_MODE=mock` and restart. Local parser, instant, still real output. |
| Voice doesn't trigger | Type the question. The endpoint is identical. |
| Everything is broken | `rm -rf .next && npm run build` — a stale build artifact caused exactly this once. |

---

## One-line pitch

> "Rovelle turns any cooking video, in any Indian language, into a recipe you
> can actually cook from — and then talks you through it while your hands are
> covered. No account until you want to keep it."
