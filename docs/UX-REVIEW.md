# Rovelle — UX review system

A repeatable audit run **after every agent lands work**. Not a taste review — a
checklist with pass/fail criteria, so two people running it reach the same verdict.

**The standard:** the user is never confused about what just happened, what is
happening now, or what to do next. Every action acknowledges within 100ms. Every
failure names itself and offers a way forward. Nothing is vague, nothing is
silent, nothing is abrupt.

---

## 1. The three laws

Everything below is derived from these. When a rule and a law disagree, the law wins.

**L1 · No action without acknowledgement.**
Every click, tap, paste, keypress and voice command produces a visible response
within 100ms — before the work finishes. A button that does nothing for 800ms
while a request flies has failed, even if it eventually succeeds.

**L2 · No failure without a next move.**
"Something went wrong" is a bug. Every error states what happened in one line
and offers a specific action: retry, a different door, or a human explanation
of why this one cannot work. The paste fallback is always reachable.

**L3 · No motion that competes with cooking.**
Animation exists to explain change — where a thing came from, what became what.
Duration 150–400ms, one easing curve, transform and opacity only. Nothing
bounces. Nothing draws the eye away from a boiling pan.

---

## 2. Action inventory

Every action a user can take, and what each must show. This is the audit
checklist — walk it top to bottom.

Legend: **I** initiate (<100ms) · **P** in progress · **S** success · **F** failure · **E** empty

### 2.1 Landing and import

| # | Action | Required feedback |
|---|---|---|
| A1 | Paste a URL into the hero input | **I** input shows the text, autosubmit arms · **P** button → "Reading it", disabled, input locked · **S** route to processing · **F** inline error + the paste door |
| A2 | Click Import | **I** button state within 100ms · **P** spinner or label change · rest as A1 |
| A3 | Submit an unsupported link | **F** "That link isn't a video we can read. Try a Reel, Short, TikTok, or YouTube link." — before any network call |
| A4 | Expand "paste a caption" | **I** section expands ≤250ms, textarea focused |
| A5 | Submit pasted text <40 chars | **I** submit disabled, live character count visible — never a silent no-op |
| A6 | Upload a photo | **I** filename or thumbnail appears immediately · **P** "Reading the image" · **F** size/type error names the limit |
| A7 | Upload >10 MB | **F** "That file is over 10 MB. A screenshot should be well under it." |
| A8 | OCR is mocked | **E** the door is visible but explains what would switch it on |

### 2.2 Processing — the highest-risk screen

The user is waiting with nothing to do. Every second of silence is doubt.

| # | Action | Required feedback |
|---|---|---|
| B1 | Screen loads | **I** first phase active immediately, never an empty frame |
| B2 | Work proceeds | **P** something visibly changes at least every 3s |
| B3 | A phase completes | **S** tick + real elapsed seconds, next phase becomes active |
| B4 | Partial results exist | **P** show them — title, creator, ingredient count as they land |
| B5 | >60s elapsed | **P** reassurance copy, and the promise that leaving is safe |
| B6 | Cancel | **I** immediate, no confirm dialog, returns to import |
| B7 | Job fails | **F** the specific reason + a button to the paste door |
| B8 | Tab was backgrounded | **S** state correct on return — no stale phase, no lost job |
| B9 | Network drops mid-poll | **P** "Reconnecting…" not a frozen screen; resume when back |

### 2.3 Review and save

| # | Action | Required feedback |
|---|---|---|
| C1 | Edit any field | **I** focus ring + recessed field within 100ms · **S** "edited — your version wins" |
| C2 | Low-confidence value | **P** `check` mark, and a count at the top explaining why |
| C3 | Missing quantity | **P** rendered blank/italic with an explanation — never a fabricated number |
| C4 | Add / remove ingredient or step | **I** the row appears or leaves with a ≤200ms transition, not a jump |
| C5 | Save to cookbook (signed in) | **I** button busy · **S** navigate · **F** inline, edits preserved |
| C6 | Save to cookbook (guest) | **S** the sign-in modal — never an error, never a 401 leaking to the console |
| C7 | Sign in inside the modal | **P** per-step busy · **S** save retries automatically, then navigates · **F** "That code is wrong or has expired. Ask for a new one." |
| C8 | Guest import quota spent | **F** "Sign in to import more. What you've already made stays." |

### 2.4 Cook Mode

| # | Action | Required feedback |
|---|---|---|
| D1 | Enter Cook Mode | **I** ≤400ms transition, step 1 rendered, announced to screen readers |
| D2 | Mark step done | **I** press state within 100ms, step advances, rail fills |
| D3 | Timer runs | **P** ring depletes smoothly, seconds tick, state as TEXT not colour alone |
| D4 | Timer ends | **S** chime + vibrate + visible change — never auto-advance |
| D5 | Tap the ring | **I** paused/resumed, label changes |
| D6 | Open the drawer | **I** slides ≤250ms, dismiss by tapping anywhere |
| D7 | Hold to ask | **I** button turns gold and says "Listening" · **P** "Thinking" · **S** the question and the answer both shown, and spoken |
| D8 | Hands-free on | **P** persistent live dot + "Say chef, then ask" · interim speech echoed |
| D9 | Wave detected | **S** visible confirmation + haptic — the user must know it saw them |
| D10 | Mic permission denied | **F** one line, and the other input routes still work |
| D11 | Camera permission denied | **F** the toggle disables itself with an explanation, cooking continues |
| D12 | STT heard nothing | **F** "I didn't catch that. Say it again?" |
| D13 | Question not in the recipe | **S** says so plainly — never invents an answer |
| D14 | Exit past step 1 | **I** confirm, and it says progress is saved |
| D15 | Resume within 6h | **E** "Pick up at step 4?" with both choices |

### 2.5 Library and settings

| # | Action | Required feedback |
|---|---|---|
| E1 | Search the cookbook | **I** result count updates · **E** "Nothing matches X" + clear |
| E2 | Empty cookbook | **E** routed to import — an invitation, not a blank page |
| E3 | Change UI language | **I** busy state · **S** page re-renders translated |
| E4 | Translate a recipe | **P** "Translating…" · **S** rendered · **F** names the capability and how to enable it |
| E5 | Export | **I** download begins, or a visible confirmation |
| E6 | Delete a recipe | **I** confirm naming the recipe and suggesting export first |
| E7 | Add a note | **I** field focused · **S** appears in the list immediately |

---

## 3. Failure taxonomy

Every failure this app can produce, and the exact words. **No error may reach a
user without an entry here.**

| Code | Cause | What the user sees | Recovery |
|---|---|---|---|
| `UNSUPPORTED` | Not a video URL | "That link isn't a video we can read. Try a Reel, Short, TikTok, or YouTube link." | Input stays, focused |
| `LOGIN_WALL` | Platform wants a login | "Instagram wouldn't return this one." | → paste the caption |
| `PRIVATE` | Private or removed | "That post is private, or it's been taken down." | → paste the caption |
| `NO_AUDIO` | No audio track | "There's no audio track in that video." | → paste the caption |
| `NO_TEXT` | Nothing readable | "There's no readable speech or caption in this one." | → paste the caption |
| `TOO_LONG` | Over the chunk ceiling | "That video is 34 minutes. We read up to 20." | → paste the transcript |
| `DOWNLOAD_FAILED` | 403 after every client | "We couldn't download that video." | → paste the caption |
| `NOT_INSTALLED` | No yt-dlp on the box | "Reading videos isn't set up on this server." | → paste, and tell the operator |
| `RATE_LIMITED` | Sarvam 429 | "We're being rate-limited. Trying again in a moment." | Auto-retry with backoff, visible |
| `BAD_KEY` | Sarvam 403 | "The AI service rejected our key." | Operator problem — say so, don't blame the user |
| `NEEDS_LIVE` | Capability mocked | Names the capability and the env var | → the door that does work |
| `needsAccount` | Guest save | The sign-in modal | Not an error at all |
| `OFFLINE` | No network | "You're offline. We'll pick up when you're back." | Auto-resume |
| `MIC_DENIED` | Permission refused | "No microphone. Type the question instead." | Typed input |
| `CAMERA_DENIED` | Permission refused | "Camera's off. Use the button or say 'chef'." | Both other routes |
| `EMPTY_EXTRACTION` | Model returned nothing | "We couldn't find a recipe in this one." | → paste, and keep the transcript |

**Rules for every message above**
1. One line. Two at most.
2. Says what happened, then the next move.
3. No apology, no "oops", no exclamation marks, no blame.
4. Never exposes a stack trace, an HTTP code, or a model name to the cook.
5. The operator-facing detail goes to `console.error`, not to the screen.

---

## 4. Motion specification

Add to `globals.css`. One curve, four durations, transform and opacity only.

```css
:root {
  --ease-cinema: cubic-bezier(.22, 1, .36, 1);   /* the only curve */
  --t-tap:   120ms;   /* press feedback, focus rings */
  --t-move:  240ms;   /* things entering, leaving, expanding */
  --t-panel: 320ms;   /* drawers, modals, sheets */
  --t-scene: 400ms;   /* Paper → Hearth, the one big transition */
}
```

**Rules**

| Rule | Why |
|---|---|
| Animate `transform` and `opacity` only | Anything else hits layout and janks on a mid-range phone |
| One curve everywhere: `--ease-cinema` | Mixed easings read as different products stitched together |
| Nothing overshoots or bounces | Playful is wrong next to a hot pan |
| Enter 240ms, exit 160ms | Leaving should feel quicker than arriving |
| Stagger lists by 30ms, cap at 6 items | Beyond that it reads as slow, not considered |
| Never animate on first paint of a re-render | Content that re-animates on every keystroke is nauseating |
| Every animation inside `@media (prefers-reduced-motion: no-preference)` | The reduce case is already global; new work must not bypass it |

**Where motion is earned**

| Moment | What | Duration |
|---|---|---|
| Button press | scale .985 | `--t-tap` |
| Field focus | border colour + background | `--t-tap` |
| Card / row entering | opacity 0→1, translateY 8px→0 | `--t-move` |
| Ingredient row removed | opacity→0, height collapse | 160ms |
| Paste door expanding | opacity + translateY | `--t-move` |
| Processing event arriving | fade + slide up 6px | `--t-move` |
| Phase tick completing | the tick scales 0.8→1 once | `--t-tap` |
| Save-gate modal | overlay fade, panel translateY 12px + fade | `--t-panel` |
| Ingredient drawer | translateY 100%→0 | `--t-panel` |
| Entering Cook Mode | crossfade | `--t-scene` |
| Step advancing | old step out 160ms, new in 240ms | — |
| Timer ring | `stroke-dashoffset`, linear, 250ms tick | continuous |
| Step rail filling | `scaleY`, transform only | `--t-move` |
| Wave detected | one gold pulse | `--t-move` |

**Explicitly banned:** spinners longer than 2s without accompanying text,
skeleton screens that never resolve, layout-shifting entrances, anything
looping in Cook Mode except the timer and the live dot.

---

## 5. The review procedure

Run after every agent lands. ~25 minutes.

### Pass 1 — the journey, cold (10 min)

Clear cookies. Then walk the real path, out loud, noting anything that makes you
pause:

```
1  Land on /                    can I tell what this does in 3 seconds?
2  Paste a YouTube URL          did it acknowledge before it worked?
3  Watch processing             did it change every ~3s? did I ever doubt it?
4  Land on review               do I understand what needs checking?
5  Edit an ingredient           did it respond instantly?
6  Save to cookbook             did the account ask feel fair, or like a wall?
7  Sign in                      did my recipe survive?
8  Start cooking                is step 1 readable at arm's length?
9  Mark a step done             instant?
10 Wave / say "chef" / ask      did it show me it heard me?
11 Finish                       does the note prompt feel like a gift or a chore?
12 Cookbook                     is my recipe there, with its cook count?
```

**Rule:** every hesitation is a finding. Write it down before rationalising it.

### Pass 2 — deliberate failure (10 min)

Break each one on purpose and check the message against §3.

```bash
# unsupported link
paste  https://example.com/not-a-video

# private video
paste  https://www.youtube.com/watch?v=aaaaaaaaaaa

# offline mid-import
start an import, then: Network tab → Offline

# rate limit
SARVAM_LIVE_BUDGET=1 npm run dev    # second call refuses

# bad key
SARVAM_API_KEY=sk_wrong SARVAM_MODE=live npm run dev

# permissions
deny the mic, then deny the camera, in Cook Mode

# guest quota
import twice without signing in
```

For each: is the message in §3? Is there a next move? Did anything technical leak?

### Pass 3 — mechanical (5 min)

```
□ 360px wide — no horizontal scroll on any screen
□ Keyboard only — can reach and fire every action; focus ring always visible
□ prefers-reduced-motion: reduce — nothing animates, nothing breaks
□ 200% browser zoom — no clipping
□ Cook Mode at arm's length — readable standing back from the desk
□ Throttle to Slow 3G — every screen still explains itself
□ Console — zero errors, zero unhandled rejections through the whole journey
```

---

## 6. Findings format

One line each, so they can be handed straight to an agent.

```
[SEV] SCREEN · ACTION → what happens now → what should happen
```

| Severity | Meaning | Fix by |
|---|---|---|
| **S0** | Data loss, a fabricated quantity, or a dead end with no way out | Immediately |
| **S1** | An action with no feedback, or a vague error | Before demo |
| **S2** | Feedback exists but is slow, unclear, or harshly animated | Before demo if time |
| **S3** | Polish | Backlog |

Examples:

```
[S0] review · guest save → 401 in console, button does nothing → open SaveGate
[S1] import · submit → 900ms of nothing → busy state within 100ms
[S1] cook · mic denied → silent failure → "No microphone. Type instead."
[S2] processing · phase tick → snaps in → 120ms scale, --ease-cinema
[S3] cookbook · card hover → no affordance → 1px border lift
```

---

## 7. Definition of done

The frontend ships when all of these hold:

```
□ Every row in §2 passes
□ Every error a user can reach appears in §3, verbatim
□ Every animation obeys §4 — one curve, transform/opacity only
□ Pass 1 completes with zero hesitations
□ Pass 2 produces no vague message and no dead end
□ Pass 3 is fully ticked
□ Zero console errors across the whole journey
□ No S0 or S1 findings open
```
