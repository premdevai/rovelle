# Four parallel agent briefs

Copy each block into a separate agent. They have **disjoint file ownership**, so
they cannot collide. Launch all four at once.

---

## SHARED CONTEXT — this preamble goes at the top of EVERY brief

```
You are working in /Users/premkumar/prem/Obsidian/Rovelle-MVP/app
Next.js 15 App Router + TypeScript. Storage is node:sqlite via src/lib/db.ts.
Rovelle turns cooking videos into structured recipes (RRF v1) and cooks with you.

DESIGN SYSTEM — dark, warm, cinematic. Read src/app/globals.css first.
  Tokens:  hsl(var(--primary)) gold · hsl(var(--foreground)) · hsl(var(--muted-foreground))
           hsl(var(--border)) · hsl(var(--card)) · hsl(var(--input)) · hsl(var(--secondary))
  Classes: .card .glass .btn-gold .btn-ghost .eyebrow .eyebrow-muted .text-gold
           .font-display .data .animate-fade-up .pill .dot-live
  Fonts:   Fraunces (display) + Inter (body) + JetBrains Mono (.data, quantities only)
  Primitives in src/components/ui.tsx: Display, Eyebrow, GoldButton, GhostButton,
           GoldLink, GhostLink, Card, LivePill, Stat, MetaStat, ErrorLine, cx,
           IconArrow IconCheck IconClock IconFlame IconServes IconMic IconPlay

ALREADY DONE — do not change:
  db.ts has users.is_guest INTEGER DEFAULT 0  and  jobs.events TEXT DEFAULT '[]'
  UserRow.is_guest: number   JobRow.events: string
  A guest's users.email holds their guest id (column is NOT NULL UNIQUE).

CROSS-AGENT CONTRACTS — fixed, do not renegotiate:
  C1  Guest tries to save →  HTTP 401  { "error": "...", "needsAccount": true }
  C2  Job events are  { at:number, phase:string, note:string, pct?:number }
      exposed by GET /api/import/[jobId] as  { ...existing, events: JobEvent[] }
  C3  POST /api/auth on success returns { ok:true, email, claimed:number }

HOUSE STYLE
  Comments explain WHY, never what. Match the density of files you read.
  Touch targets >= 44px. Works at 360px wide. Real labels, aria where it earns it.
  Never fabricate a recipe quantity anywhere — qty:null is the correct answer.

VERIFY BEFORE YOU FINISH — you are not done until this is clean:
  cd /Users/premkumar/prem/Obsidian/Rovelle-MVP/app && npx tsc --noEmit
  Other agents edit other files concurrently. Type errors in files you do NOT
  own are expected — ignore those, ensure YOUR files are clean.
  Also run:  npx tsx src/lib/selfcheck.ts   (44 assertions must still pass)

Report back: files changed, what you built in <=5 lines, test output. Be concise.
```

---

## AGENT 1 — Frontend: anonymous-first landing + save gate

```
[PASTE SHARED CONTEXT ABOVE]

MISSION: a signed-out visitor pastes a URL on the home page and gets a full
recipe without ever meeting a login screen. The account is asked for only when
they try to SAVE.

FILES YOU OWN — edit only these:
  src/app/import/import-form.tsx                    (edit)
  src/components/save-gate.tsx                      (CREATE)
  src/app/import/[jobId]/review/review-form.tsx     (edit)
  src/app/page.tsx                                  (FINISH — see below)

DO NOT EDIT: anything in src/lib/, any api route, ui.tsx, shell.tsx,
cook-*.tsx, src/app/import/[jobId]/progress.tsx or its page.tsx.

!! START HERE: src/app/page.tsx was already rewritten by a previous run. It
   passes  variant="hero"  and  note="No account needed. Sign in later to keep
   it."  to <ImportForm>. THOSE PROPS DO NOT EXIST YET, so the build is broken
   right now. Your first job is adding them. Read page.tsx, then make it true.

1. import-form.tsx
   - Add  variant?: "page" | "hero"  (default "page") and  note?: string.
   - hero: input min-h-[64px] text-[17px] md:text-[18px], wrapper .glass not
     .card, so it sits on the gradient properly.
   - hero: collapse the "paste a caption" and "photo of a page" doors behind ONE
     muted link — "Or paste a caption, or a photo of a page" — that expands to
     reveal them. Keep every existing path working; delete nothing.
   - Render `note` under the input in 13-14px muted.
   - Keep: paste-to-autosubmit after 300ms, ErrorLine, the live/mock capability dot.

2. save-gate.tsx (CREATE) — client component
   Props: { open: boolean; onClose: () => void; onSignedIn: () => void }
   - Modal on bg-black/70 backdrop-blur-sm, .glass panel, max-w-[440px], centred.
   - Eyebrow "Keep it" · Display size="md" "Save this to your cookbook." ·
     body "Your recipe is ready. Sign in and it's yours — plus every recipe you
     make after this."
   - Inline email → 6-digit code against POST /api/auth. READ
     src/app/enter/enter-form.tsx and copy its exact request/response handling
     including the dev-only `devCode` field.
   - On success call onSignedIn(). Esc closes, overlay click closes, autofocus email.

3. review-form.tsx
   - When PATCH /api/recipes/{id} returns 401 with needsAccount:true (contract C1),
     do NOT show an error — open <SaveGate>.
   - After onSignedIn, silently retry the same save, then navigate as originally
     intended (cookbook or cook). "Save and cook now" behaves the same way.
```

---

## AGENT 2 — Backend: guest sessions and claim-on-signup

```
[PASTE SHARED CONTEXT ABOVE]

MISSION: anonymous visitors can import, review and cook. The account is required
only to SAVE. When a guest signs up, everything they made transfers to the real
account — losing it at that moment would be the worst bug in the product.

FILES YOU OWN — edit only these:
  src/lib/guest.ts                            (CREATE)
  src/lib/guest-check.ts                      (CREATE — the test)
  src/lib/auth.ts                             (edit)
  src/app/api/import/route.ts                 (edit)
  src/app/api/ask/route.ts                    (edit)
  src/app/api/recipes/[id]/route.ts           (edit)
  src/app/api/recipes/[id]/cook/route.ts      (edit)
  src/app/api/recipes/[id]/notes/route.ts     (edit)
  src/app/api/auth/route.ts                   (edit)

DO NOT EDIT: db.ts, jobs.ts, media.ts, job-status.ts, recipes.ts, any page or
component, src/app/api/import/[jobId]/*.

READ FIRST: src/lib/auth.ts (HMAC cookie rovelle_session = userId.issued.mac),
src/lib/api.ts (guard() maps errors to responses), src/lib/jobs.ts
(spendImport / importsLeft — call them, don't edit them).

1. guest.ts
     currentOrGuestUser(): Promise<UserRow>   // creates a guest on first call
     currentAnyUser(): Promise<UserRow | null>
     isGuest(u): boolean
     claimGuestWork(guestId, realUserId): Promise<number>
     NeedsAccountError
     GUEST_IMPORTS = 1
   - Guest cookie `rovelle_guest`, SAME HMAC scheme as auth.ts — export sign/verify
     from auth.ts and reuse them, do not duplicate the crypto.
   - Creating a guest inserts a users row: id "gst_…", email = the guest id,
     is_guest = 1, plan 'free', a period_resets_at.
   - claimGuestWork, ONE transaction: reassign recipes, jobs, cook_sessions
     SET user_id = real WHERE user_id = guest; delete the guest row; clear the
     guest cookie; return how many recipes moved.
     !! There is a UNIQUE(user_id, slug) index. The real account may already own
        that slug. On conflict suffix -2, -3… Losing a recipe here is unacceptable.

2. Relax the routes: replace requireUser() with currentOrGuestUser() in all the
   api routes you own.
   THE ONE GATE — in PATCH /api/recipes/[id], if body.status === "saved" and the
   caller is a guest, respond exactly per contract C1. Agent 1 depends on that
   shape byte for byte. Everything else a guest does must work: import, edit a
   draft, cook, add notes, ask voice questions.
   Guests get GUEST_IMPORTS (1), not 5. When spent, also 401 + needsAccount:true,
   message "Sign in to import more. What you've already made stays."

3. POST /api/auth: before setSession() on a successful OTP redeem, read the guest
   cookie and if it maps to a guest row call claimGuestWork. Return contract C3.

4. guest-check.ts — assert-based, same style as src/lib/selfcheck.ts. READ IT for
   the ok(label, fn) helper and the async function main() wrapper — top-level
   await breaks tsx here. Set process.env.ROVELLE_DB to a temp file before
   importing anything, exactly as selfcheck.ts does. Cover:
     1 guest row created with is_guest = 1
     2 a guest can own a draft recipe
     3 claim moves recipes AND jobs AND cook_sessions
     4 the guest row is deleted afterwards
     5 a slug collision during claim loses nothing — both survive, one renamed
     6 cooked_count and notes survive intact
   Run: npx tsx src/lib/guest-check.ts
```

---

## AGENT 3 — Live processing: granular events + streaming

```
[PASTE SHARED CONTEXT ABOVE]

MISSION: the processing screen should feel like a modern LLM app doing visible
work, not four static ticks. Real-time feedback, and partial results as they land.

FILES YOU OWN — edit only these:
  src/lib/media.ts                            (edit)
  src/lib/jobs.ts                             (edit)
  src/lib/job-status.ts                       (edit)
  src/app/api/import/[jobId]/route.ts         (edit)
  src/app/api/import/[jobId]/stream/route.ts  (CREATE)
  src/app/import/[jobId]/progress.tsx         (edit)

DO NOT EDIT: db.ts (jobs.events already exists), extract.ts, parse.ts, sarvam.ts,
guest.ts, any other api route, any other component.

CURRENT STATE: four coarse phases (fetch → transcribe → extract → validate),
polled once a second, with elapsed seconds. A 60s import sits on one line for 40
of them. media.ts already takes an onPhase(note: string) callback — widen it.

1. jobs.ts — an appendEvent(jobId, { phase, note, pct? }) writing to jobs.events
   (append-only JSON array, contract C2). Emit real events, not decoration:
     "Found: Punjabi Dal Tadka by Kunal Kapur"
     "Downloaded 1.5 MB of audio"
     "Transcribing chunk 2 of 4"            <- the count is already known
     "Heard: heat the ghee, add cumin…"      <- the first cue, as it lands
     "Found 19 ingredients"
     "Writing step 12 of 18"
   media.ts: widen onPhase to pass { note, pct? } and call it at each real
   milestone — probe done, download done, split done, per chunk transcribed.

2. job-status.ts — add  events: JobEvent[]  to JobStatus (contract C2).

3. stream/route.ts (CREATE) — Server-Sent Events. A Next route handler returning
   a ReadableStream, text/event-stream, emitting new events as they appear and
   closing on done|failed. Keep the existing poll route working untouched as the
   fallback — SSE behind a proxy is not guaranteed.

4. progress.tsx — consume SSE via EventSource, fall back to the 1s poll if it
   errors. Render the event log as a live feed (newest last, monospace .data
   timestamps, muted) with the four phases still shown as the spine above it.
   The screen must visibly change at least every ~3 seconds on a 2-minute video.
   Keep: cancel, the >60s reassurance copy, the failure state routing to paste.
```

---

## AGENT 4 — Voice: wave to talk, hands-off

```
[PASTE SHARED CONTEXT ABOVE]

MISSION: a cook with dough on both hands waves at the phone and voice mode
engages. Complete hands-off. No tapping.

FILES YOU OWN — edit only these:
  src/lib/wave.ts                 (CREATE — pure detector, no React)
  src/lib/wave-check.ts           (CREATE — the test)
  src/components/cook-voice.tsx   (edit)
  src/lib/i18n/strings.ts         (ADDITIVE ONLY — new keys in the `en` object,
                                   change nothing that exists)

DO NOT EDIT: cook-mode.tsx, ui.tsx, any other lib, any api route, any page.

READ FIRST: src/components/cook-voice.tsx. It already has push-to-talk via
MediaRecorder → POST /api/ask, a handsFree toggle using browser SpeechRecognition
with the wake word "chef", a language select, makeT(dict), and send(audio, text?).
strings.ts already has cook.freeOn, cook.freeOff, cook.wake, cook.heard.

1. wave.ts — frame differencing. NO ML, NO dependencies.
     export type WaveSample = { t: number; left: number; right: number }
     export function isWaveSignature(samples: WaveSample[]): boolean   // PURE
     export function detectWave(opts: { video, onWave, fps?, onEnergy? }): { stop() }
   Algorithm: draw the video to an offscreen 32x24 grayscale canvas; per frame sum
   the absolute pixel difference against the previous frame, separately for the
   left and right halves; keep a rolling ~1.5s window.
   !! A wave is left/right dominance ALTERNATING — crossing over 2+ times, above a
      noise floor. That oscillation test is the whole design: it is what separates
      a wave from someone walking past, steam rising, or an arm reaching for a
      spice jar. A plain "lots of motion" threshold false-positives constantly in
      a kitchen and is not acceptable.
   Debounce 5s after firing. Keep isWaveSignature pure so it tests with synthetic
   data and no camera.

2. cook-voice.tsx — a third control beside "Hands-free": "Wave to talk" (camera
   icon), OFF by default, never request the camera unprompted.
   - On: getUserMedia({ video:{ facingMode:"user", width:320, height:240 } }),
     an invisible <video playsInline muted autoPlay className="sr-only">, start
     detectWave.
   - On wave: turn hands-free ON, show "Waved — listening", navigator.vibrate?.(120).
   - Privacy line, visible whenever the camera is on, non-negotiable:
     "Camera stays on your device. Nothing is recorded or sent."
   - Stop the track and the detector on toggle-off, unmount, and visibilitychange.
     A camera left running in the background is unacceptable.
   - Degrade quietly: no getUserMedia or permission denied → hide the toggle, one
     line of explanation. Button and wake word keep working exactly as now.

3. wave-check.ts — assert-based, same style as src/lib/selfcheck.ts (read it for
   the ok() helper and the async main() wrapper; top-level await breaks tsx here).
   Feed isWaveSignature synthetic samples:
     1 clean alternating left/right oscillation      -> true
     2 steady high energy in BOTH halves (walk-past) -> false
     3 one-directional motion, no alternation        -> false
     4 low-energy noise                              -> false
     5 a single crossing, not repeated               -> false
   Run: npx tsx src/lib/wave-check.ts
```

---

## After all four report back

```bash
cd /Users/premkumar/prem/Obsidian/Rovelle-MVP/app
npx tsc --noEmit
npx tsx src/lib/selfcheck.ts     # 44
npx tsx src/lib/guest-check.ts   # agent 2
npx tsx src/lib/wave-check.ts    # agent 4
npm run build
npx next start -p 3111 &
```

Then the one flow that proves the hackathon demo, with cookies cleared:

1. Open `/` — the URL input is on the page, no login.
2. Paste a YouTube cooking URL. The processing screen must visibly move.
3. Reach the review screen. Edit an ingredient.
4. Hit **Save to cookbook** → the sign-in modal appears, not an error.
5. Sign in. The recipe is saved and you land on it.
6. `/cookbook` shows it.
7. Start cooking → wave at the camera → ask "how much turmeric" out loud.

Full live pipeline check (~8 Sarvam calls):
```bash
export PATH="$HOME/.local/bin:/opt/homebrew/bin:$PATH"
npm run live -- "https://www.youtube.com/watch?v=tmiGPrOiUQE"
```
Watch the FABRICATION and VERBATIM lines at the end. Both must read "clean".
