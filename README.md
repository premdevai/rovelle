# Rovelle

Turn saved cooking videos into a structured, permanent cookbook — then cook from it,
hands-free, in your own language.

**Simple. Premium. Permanent.**

## What actually works

Paste a public video URL and Rovelle downloads it, listens to the voiceover in
whatever language it was filmed in, reads the description and any recipe posted
in the comments, and produces a structured recipe with per-step timers,
cookware, heat levels and doneness cues. Then Cook Mode walks you through it one
step at a time and you can talk to the recipe while your hands are covered.

```
URL → yt-dlp (audio only) → ffmpeg 16kHz mono → 28s chunks
    → Sarvam Saaras v3 (speech → English, any source language)
    → description + pinned recipe comments
    → Sarvam-105B (structure + rewrite + sensory fields)
    → RRF v1 → review → Cook Mode
```

## Start

```bash
cd app
npm install
cp .env.example .env.local     # add SARVAM_API_KEY
npm run dev
```

Optional, for the video path: `brew install yt-dlp ffmpeg`.

| Command | Does |
|---|---|
| `npm run dev` | Run it |
| `npm run check` | 44 assertions over the parser, RRF, store and answerer |
| `npm run typecheck` | tsc |
| `npm run locales -- --all` | Regenerate Indian-language UI dictionaries |

## Sarvam modes

Every capability is `mock` or `live`, independently. Mock does real work on
real input — it never invents recipe content.

```
SARVAM_MODE=mock                 # everything local
SARVAM_MODE_EXTRACT=live         # Sarvam-105B structuring
SARVAM_MODE_STT=live             # Saaras — needed for the video path
SARVAM_MODE_TTS=live             # Bulbul — else the browser voice speaks
SARVAM_MODE_TRANSLATE=live       # recipes rendered in another language
SARVAM_LIVE_BUDGET=200           # per-process ceiling on live calls
```

## Documents

| File | What it settles |
|---|---|
| `docs/PRD.md` | Problem, users, north star, scope, moat, risks, pricing |
| `docs/XRD.md` | Design system, screens, Cook Mode spec, copy, a11y |
| `docs/TECH-SPEC.md` | Stack, architecture, RRF v1, data model, fetch cascade |

## Decisions worth not relitigating

1. **`qty: null` is a valid answer.** A fabricated "2 tbsp" is the worst
   possible output. Every path — model and parser — leaves gaps honest.
2. **Cook Mode before the importer.** The instrument is the product.
3. **Export ships at launch.** Permanence is the pitch; lock-in would contradict it.
4. **The cook's version wins.** Once edited, no automated process rewrites it.
