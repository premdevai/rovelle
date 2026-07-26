# Rovelle — Experience Requirements Document (XRD)

**Companion to** `PRD.md` · **Governs** design system, screens, states, copy, motion, a11y

---

## 1. Experience thesis

**The app inverts when you start cooking.**

Rovelle has two surfaces, and the transition between them is the signature moment:

- **Paper** — light, typographic, archival. Browsing, importing, editing, remembering. This is a library.
- **Hearth** — dark, high-contrast, enormous targets. Cooking. This is an instrument.

The inversion is functional, not decorative: an evening kitchen is dim, the phone is propped at arm's length, and glare from a light surface is the actual failure mode. The one full-screen crossfade from Paper to Hearth is the only orchestrated animation in the product, and it earns its keep by signalling a mode change to a person who is about to stop looking at their phone properly.

Everything else is quiet.

## 2. Design system

**Superseded July 2026.** The original spec here described a light, anti-card,
hairline-and-mono "Paper" surface. The built prototype went the other way and
that is what ships: one dark, warm, cinematic surface with gold as the single
accent. Where this document and the prototype disagreed, the prototype won.

Tokens live in `app/src/app/globals.css` as bare HSL triples (shadcn
convention) so any value can be used at any opacity: `hsl(var(--primary) / .4)`.

```
--background 30 14% 6%     --card       30 14% 9%     --border 35 12% 18%
--foreground 38 30% 92%    --primary    38 60% 62%    --input  35 12% 16%
--surface    30 12% 8%     --primary-glow  42 80% 70% --muted  30 10% 14%
--surface-elevated 30 14% 11%  --primary-deep 32 55% 45%
--muted-foreground 35 12% 62%  --destructive 12 70% 50%   --radius 1rem
```

Plus `--gradient-gold`, `--gradient-warm`, `--gradient-ember`,
`--gradient-text-gold`, `--shadow-glow`, `--shadow-card`, `--glass`, and
`--ease-cinema` for the one easing curve.

**Type**

| Role | Face | Usage |
|---|---|---|
| Display | Fraunces (variable, SOFT 0 / WONK 1) | Headings, recipe titles, stat numbers. |
| Body / UI | Inter | Everything. 300–600. |
| Data | JetBrains Mono | Quantities, timers, temperatures, counts. Tabular always. |

**Signature devices**

- **Gold gradient on one word** of a heading — "to *lasting* recipe", "it's a
  *cooking* instrument", "the cookbook you'll *keep*". `.text-gold`.
- **Gold letterspaced eyebrow**, 11px, `.eyebrow`, optionally with a short rule.
- **Glass cards** — `--radius` 1rem, inset hairline, deep soft shadow. Cards
  are the container device; the earlier "no cards, hairlines only" rule is void.
- **Pill controls** — gold gradient for primary, ghost outline for secondary.
- **Ring timer** in Cook Mode: a gold SVG arc around the remaining time.

**Quantities are always mono and gold.** A quantity is data, not prose.

## 2a. Ergonomics that outrank style

Cook Mode's rules in §4 (S6) are ergonomic, not decorative, and survive any
restyle: ≥72px primary target, no text below 16px, wake lock, timer on step
entry, never auto-advance, full keyboard control.

## 3. Screen inventory

| # | Screen | Route | Surface |
|---|---|---|---|
| S1 | Import | `/import` | Paper |
| S2 | Import in progress | `/import/[jobId]` | Paper |
| S3 | Review & confirm | `/import/[jobId]/review` | Paper |
| S4 | Recipe | `/r/[slug]` | Paper |
| S5 | Recipe edit | `/r/[slug]/edit` | Paper |
| S6 | **Cook Mode** | `/r/[slug]/cook` | **Hearth** |
| S7 | Cook complete | `/r/[slug]/cook/done` | Hearth → Paper |
| S8 | Cookbook | `/cookbook` | Paper |
| S9 | Settings / export | `/settings` | Paper |
| S10 | Auth | `/enter` | Paper |

## 4. Flow specs

### S1 — Import

Single input, autofocused, full-width. Placeholder: `Paste a link from Instagram, TikTok, or YouTube`.

- Paste is detected on `onPaste` and submits automatically after 300ms. Do not make someone click a button after pasting a URL.
- Below input, muted: `Or paste the caption or transcript instead` → expands a textarea (the Rescue path, always present, never hidden behind an error).
- Free tier shows remaining imports as mono text: `3 / 5 imports left this month`. Never a progress bar; a bar implies pressure.

**Empty cookbook first-run:** the import field *is* the home screen. No dashboard, no tour.

### S2 — Import in progress

Not a spinner. A **named phase list**, because a 30s wait with visible progress reads as work, and a 30s spinner reads as broken.

```
Reading the video          ✓  2.1s
Listening for the steps    ✓  6.4s
Pulling out ingredients    ◐
Building the recipe        ·
```

- Phases map 1:1 to worker stages (`fetch`, `transcribe`, `extract`, `validate`).
- Copy is what the cook sees happening, not the system's names. Never "Invoking ASR pipeline".
- Cancel is always available.
- If total > 60s: `Longer video — this one's worth the wait. We'll email you when it's ready.` and the job continues server-side.

### S3 — Review & confirm — **the most important screen in the import flow**

Never auto-save. The user confirms, and in doing so takes ownership. This is what makes the recipe *theirs* rather than the AI's.

- Full RRF rendered as editable fields inline. Click any value, type, done. No modal, no separate edit mode.
- **Low-confidence fields are marked**, in `--flag`, with a hairline underline and the label `check`. Applies to: any quantity derived from audio only, any temperature, any duration.
- Missing quantities render as `to taste` / `as needed` in `--ink-3` italic — never a fabricated number.
- Attribution block is visible and non-editable: handle, platform, link back.
- Primary action: **Save to cookbook**. Secondary: **Save and cook now** — this is the onboarding-critical one and should be primary on a user's *first* import.

### S4 — Recipe

Asymmetric. Left: title (Cabinet Grotesk 40/64), one-line description, then phase-grouped steps. Right rail: total time, serves, level, ingredient list (mono quantities), source attribution, cooked count, notes.

- `Start cooking` is fixed bottom-right on desktop, fixed bottom full-width on mobile. Always reachable.
- Notes render at the bottom in `--saffron-wash` with a hairline left border, attributed. This is the emotional payload of the product — give it room.
- `Cooked 4×` and `Last cooked 12 Feb` in mono, `--ink-3`.

### S6 — Cook Mode — full spec

**Entry:** 400ms crossfade Paper → Hearth. Request `navigator.wakeLock`. Enter fullscreen where supported. Announce to screen readers: `Cook mode. Step 1 of 6.`

**Layout (mobile-first, but identical on desktop — a propped phone and a propped laptop are the same problem):**

```
┌─┬──────────────────────────────────────────┐
│▓│  STEP 03 / 06            CONFIT          │  eyebrow, mono, --hearth-ink-2
│▓│                                          │
│▓│  Confit thighs & garlic                  │  Cabinet Grotesk 44–72
│▓│  at 95 °C                                │
│▓│                                          │
│▓│  Oil should barely shimmer. Cloves go    │  Geist 24, --hearth-ink-2
│▓│  translucent gold; thighs go             │  max 60ch
│▓│  spoon-tender. Don't stir.               │
│ │                                          │
│ │        23:48                             │  JetBrains Mono 72, --saffron
│ │        remaining · 28 min step           │
│ │                                          │
│ │  ┌────────────────────────────────────┐  │
│ │  │        Mark step done              │  │  ≥72px tall, saffron, full width
│ │  └────────────────────────────────────┘  │
│ │                                          │
│ │  ‹ Back            Ingredients ▲         │  56px targets
└─┴──────────────────────────────────────────┘
 ↑ step rail — saffron fill, 6px wide, full height
```

**Hard requirements:**

| # | Requirement |
|---|---|
| C1 | Primary action target ≥ 72px tall, ≥ 90% viewport width. Thumb-reachable one-handed. |
| C2 | No text below 18px anywhere in Hearth. |
| C3 | Screen never sleeps (`wakeLock`, re-acquired on visibility change). |
| C4 | Timer starts **on step entry** if the step has a duration; user can pause by tapping the timer itself. |
| C5 | Timer completion: audible chime + `navigator.vibrate([200,100,200])` + step rail pulses. **Never auto-advance.** The pan does not know the timer finished. |
| C6 | Ingredient drawer slides from bottom, one tap, dismissible by tapping anywhere. Never navigates away. |
| C7 | Keyboard: `Space`/`→` next · `←` back · `I` ingredients · `Esc` exit (with confirm) · `P` pause timer. |
| C8 | Exit requires confirmation if past step 1. `Leave cook mode? Your progress is saved.` |
| C9 | Progress persists to localStorage + server every step. Reopening within 6h resumes with `Pick up at step 4?` |
| C10 | Multi-timer (Pro): concurrent timers listed in a collapsed strip above the primary action, each tappable. |
| C11 | Reduced motion: step rail fills without transition; crossfade becomes instant cut. |

**Voice (Pro, v2):** Web Speech API. Grammar limited to `next`, `back`, `repeat`, `pause`, `resume`, `how much <ingredient>`, `timer`. Push-to-talk fallback for noisy kitchens — always-listening in a kitchen with an extractor fan running is a false-positive machine.

### S7 — Cook complete

```
        Cooked.
        Chicken Confit Pasta · 41 min

        [ How did it go? ]        ← optional note, single textarea, autofocused

        Save note        Skip
```

Increments `cooked_count`, sets `last_cooked_at`, fires `recipe_cook_completed` (north-star event). The note prompt is the single highest-leverage retention mechanic in the app — the note is what makes the recipe unreplaceable. Skipping must be one tap and carry zero friction or guilt.

### S8 — Cookbook

**Anti-card.** Not a grid of tiles. A **ruled index**: one row per recipe, hairline separated, left-aligned title in Cabinet Grotesk 20, with mono metadata right-aligned (`cooked 4× · 38 min · Feb 12`). A small 48px square thumbnail sits flush-left with no border-radius and no shadow.

Default sort: **last cooked**, not date added. The cookbook should reflect how you cook, not how you hoard.

Header stats in mono, understated: `147 recipes · 42 notes`.

## 5. Copy rules

- Sentence case everywhere. No title case, no ALL CAPS except mono eyebrows.
- Active voice, and the verb persists: button `Start cooking` → screen titled `Cooking` → completion `Cooked.`
- Never sell inside the app. Marketing voice stays on the marketing site.
- No emoji, no exclamation marks.
- Errors state what happened and the next move, in one line, no apology:
  - `Instagram wouldn't return this one. Paste the caption instead →`
  - `That link isn't a video we can read. Try a Reel, Short, TikTok, or YouTube link.`
  - `No quantities in this video. We've listed the ingredients — add amounts as you cook.`
- Empty states are invitations: `Paste your first link. It takes about fifteen seconds.`

## 6. Motion

Total motion budget for the app: **four moments.**

1. Paper → Hearth crossfade on Cook Mode entry (400ms, ease-out).
2. Step rail fill (300ms, transform only).
3. Ingredient drawer slide (250ms, spring, transform only).
4. Import phase-list tick-through (opacity only).

That's it. Transform and opacity only, never layout properties. `prefers-reduced-motion` removes 1, 3, and reduces 2 to an instant state change.

## 7. Accessibility floor

- WCAG 2.2 AA. Saffron `#E0A227` on Hearth `#131110` = 8.6:1 ✓. Saffron on Paper fails for text — **saffron is never used for body text on Paper**, only fills and borders, with `--ink` text on top of saffron fills (contrast 9.1:1).
- Every Cook Mode step change announced via `aria-live="assertive"`.
- Timer state exposed as text, not colour alone.
- Full keyboard operation of Cook Mode (C7).
- Visible focus ring: 2px `--saffron`, 2px offset, on both surfaces.
- Touch targets ≥ 44px globally, ≥ 72px in Hearth.
- Tested at 200% zoom and with VoiceOver on iOS.

## 8. Responsive

Breakpoints: 360 / 768 / 1280.

Cook Mode does **not** change layout across breakpoints — it scales type and keeps the single column, capped at 720px and centred, because the desktop use case is a propped laptop on a counter, which is the phone problem at a different distance. Resist the urge to "use the space".
