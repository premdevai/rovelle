# Rovelle — Product Requirements Document

**Version** 1.0 · **Status** Draft for build · **Owner** Prem
**Positioning** Simple. Premium. Permanent.
**One line** Rovelle turns the cooking videos you save into a structured, permanent cookbook — and then cooks with you.

---

## 1. Problem

Saving a cooking reel is frictionless. Cooking from one is miserable.

The gap is not discovery, it's **execution and permanence**:

| Failure | What actually happens |
|---|---|
| No structure | Ingredients are spoken, never listed. Quantities are in the caption, or nowhere. |
| No sequencing | You scrub back four times to catch "95°, not higher." |
| Hands-hostile | Wet/oily hands, phone locking, 12s loop restarting mid-step. |
| Impermanent | Account deleted, post removed, algorithm buries it. Your "cookbook" is a dead saves folder. |
| No personalisation | Your substitution, your timing, your mum's margin note has nowhere to live. |

The saves folder is a **graveyard of intent**. Rovelle is the exhumation tool.

## 2. Users

**Primary — The Saver-Cook.** 25–45, saves 5–40 cooking videos/month, cooks 2–5 nights/week, cooks maybe 3% of what they save. Owns the problem, feels mild shame about it. Willing to pay to close the loop.

**Secondary — The Inheritor.** Cooking family/regional recipes from relatives' or diaspora creators' videos. Highest emotional attachment, highest retention, and the wedge for the Indian-cuisine moat.

**Tertiary — The Archivist.** Already keeps a Notion/Notes recipe system that they hate maintaining. Converts on import speed + export guarantee.

**Explicit non-user:** the recipe browser looking for *what to cook*. Rovelle is not discovery. You bring the link.

## 3. North star & metrics

**North star:** **Weekly Cooked Recipes per Active Cook (WCR/AC)**

Not saves. Not imports. Not MAU. A cook that finishes a Cook Mode session is the only event that proves the product worked.

| Tier | Metric | Target (M6) |
|---|---|---|
| North star | WCR/AC | 1.4 |
| Input | Import → first cook conversion (7d) | ≥ 35% |
| Input | Cook Mode completion rate | ≥ 70% |
| Input | Extraction accept-without-edit rate | ≥ 60% |
| Input | Recipes with ≥1 personal note | ≥ 25% |
| Health | D30 retention (imported ≥3) | ≥ 40% |
| Business | Free → Pro conversion | ≥ 6% |
| Guardrail | Median import latency | ≤ 15s p50, ≤ 45s p95 |

The landing page claims **4.2s average extraction**. That is a marketing number for cached/caption-only paths. Do not ship a p50 target you can't hit on a 12-minute YouTube cook-along; see §8.

## 4. Scope

### v1 — Ship (weeks 1–6)

- **Import** by URL: Instagram Reels, TikTok, YouTube + Shorts. Plus paste-caption / paste-transcript fallback.
- **Extraction** to Rovelle Recipe Format (RRF v1): ingredients w/ qty+unit, tools, prep / cook / finish phases, per-step timers and temperatures, storage, attribution.
- **Recipe view** — read + edit everything. User edit is canonical, always.
- **Cook Mode** — one step full-screen, giant done target, per-step timer, live progress, ingredient drawer, screen wake lock.
- **Cookbook** — the archive, search, sort by last cooked.
- **Notes** — free-text note per recipe, attributed ("— Mum ♡").
- **Export** — JSON (RRF) + Markdown. Non-negotiable, shipped at launch, not promised.
- **Auth** — email OTP. No password.
- **Free tier** — 5 imports/mo, unlimited saves of what you've already imported.

### v1.1 — Fast follow (weeks 7–10)

Collections/folders · portion scaling · grocery list from selected recipes · cooked-count + last-cooked ledger · share a read-only recipe link.

### v2 — Pro depth

Weekly meal planner · Voice Cook Mode (hands-free "next", "repeat", "how much garlic") · multi-timer overview · household sharing · iOS/Android share-sheet import.

### Explicitly out of scope

Social feed. Following creators. Comments. Recipe discovery/search across other users' books. Nutrition macros (accuracy liability, low pull). Video re-hosting (legal, §9). Grocery-delivery affiliate integration in v1.

## 5. Core flows

```
IMPORT       paste link → job queued → live progress → RRF draft → confirm/edit → saved
COOK         recipe → Cook Mode → step 1..n (timers) → finish → cooked+1, prompt note
ARCHIVE      cookbook → filter/search → recipe → note/edit/scale → re-cook
RESCUE       link fails → paste caption/transcript → same extraction path → saved
```

The **Rescue flow is a first-class flow, not an error state.** Platform fetching will fail — rate limits, private accounts, geo-blocks. A user who hits a dead end and gets no path out is a churned user. Design the paste fallback as a normal door, not a fire exit.

## 6. Product principles

1. **The cook's version wins.** Any AI output is a draft. The moment the user edits, that's the recipe. Never re-overwrite from source.
2. **Never lose a recipe.** Export at launch. No lock-in as a retention mechanic — permanence *is* the pitch.
3. **Cook Mode is the product.** Import is the on-ramp. Optimise every decision for the moment hands are dirty.
4. **Structure over prose.** If we can't put it in a field, we're not adding value over the caption.
5. **Attribute always.** Creator handle, platform, and a link back on every recipe. Ethically right, and it's the legal posture (§9).
6. **No cleverness in the kitchen.** No auto-advancing steps, no gestures to learn, no animation that competes with a boiling pan.

## 7. Differentiation & moat

| Competitor | What they do | Where Rovelle wins |
|---|---|---|
| ReciMe, Recipe Keeper, Crouton, Paprika | Import + store. Some do video. | Cook Mode as an instrument, not a scroll-view; permanence framing; note/version layer. |
| Notion/Notes/screenshots | Free, manual | 15 seconds vs. 15 minutes |
| Platform "saves" | Zero friction | Structure + survives deletion |

**Defensible moat (in order of durability):**

1. **The cook's own layer** — notes, edits, timings, substitutions, cooked-count. Grows monotonically, non-portable to a competitor even with export. This is the real retention asset.
2. **Indian- and regional-cuisine-aware extraction.** Western-trained flavour models mis-parse Indian technique and pairing: *tadka/chhonk* as a phase not an ingredient; *bhuna* as a doneness state; "haldi/turmeric" transliteration collapse; hing, kasuri methi, sabut vs. powdered spice; "salt to taste" as legitimate. Every generic importer produces garbage here. Build a labelled eval set (see TECH-SPEC §6) and treat this as a measured capability, not a claim.
3. **Extraction quality per creator** — cached parsing conventions per creator handle improves repeat imports from the same source.

## 8. Honest risk register

| # | Risk | Severity | Mitigation |
|---|---|---|---|
| R1 | **Instagram/TikTok block datacenter IPs.** `yt-dlp` from a VPS gets 403/login-walled within days. | **Critical — this can kill v1** | Residential/mobile proxy pool for IG+TT (budget €30–80/mo); aggressive per-URL caching; oEmbed/caption path first; paste-fallback always available; ship the iOS share-sheet extension early — client-side capture from a logged-in app is the durable path. |
| R2 | **Platform ToS.** Automated retrieval breaches IG/TikTok ToS. | High | User-initiated only, never crawl. Store derived structure + attribution + link, never re-host video/audio. Rate-limit per user. Accept this is grey; do not build the business on scraped media. |
| R3 | **Copyright.** Ingredient *lists* aren't copyrightable (US/EU); descriptive prose is. | Medium | Extraction prompt must **rewrite** steps into imperative instruction, never reproduce caption text verbatim. Enforce in the prompt and spot-check. Prominent attribution + link back. DMCA process from day one. |
| R4 | ASR mis-hears quantities ("two tablespoons" vs "two teaspoons"). Actively harmful. | High | Confidence flag per numeric field. Any low-confidence quantity renders with a "check this" affordance in the review screen, not silently. Never auto-save an unreviewed import. |
| R5 | Video has no quantities at all (very common). | High | Emit `qty: null` with `"to taste"` / `"as needed"` rather than hallucinating "2 tbsp". A confident wrong number is worse than an honest blank. Hard rule in the extraction contract. |
| R6 | Cost per import at scale. | Medium | Whisper CPU on your own VPS ≈ €0. LLM structuring ≈ $0.01–0.03/import. €6.40/mo Pro supports ~200 imports/mo before margin pressure. Fine. |
| R7 | Cold-start: user imports 3 recipes, cooks none, churns. | High | Onboarding must end **in Cook Mode**, not in the cookbook. First-run: import → immediately "Cook this now or schedule it." |
| R8 | Pricing €6.40 is oddly specific and below the €4.99/€7.99 anchors. | Low | Test €6.99/mo + €59/yr. Annual is the real lever for a "permanent" product — permanence and monthly billing are dissonant. |

## 9. Legal posture (v1)

- User-initiated retrieval only. No crawler, no bulk ingest, no discovery index.
- Derived structured data only. No storage or serving of source video or audio beyond the transient processing window (delete media within 24h of job completion).
- Attribution + canonical link rendered on every recipe view and export.
- Steps are **rewritten**, not copied.
- Public DMCA/takedown contact; creator opt-out list honoured at import time.
- Export guaranteed in ToS.

## 10. Pricing

| | Free | Pro — €6.99/mo or €59/yr |
|---|---|---|
| Imports | 5 / month | Unlimited (fair-use 300/mo) |
| Saved recipes | Unlimited | Unlimited |
| Collections | 1 default | Unlimited |
| Cook Mode | Full, with timers | + Voice, multi-timer |
| Scaling / grocery list / planner | — | ✓ |
| Export | ✓ (always) | ✓ |

Free tier keeps Cook Mode **fully unlocked**. Gating the north-star action to protect conversion is self-sabotage — you'd be optimising against the only metric that matters.

## 11. Launch definition of done

- [ ] 50 real imports across IG/TikTok/YT, ≥60% accepted with zero edits
- [ ] 20-recipe Indian-cuisine eval set at ≥80% field accuracy
- [ ] Cook Mode usable one-handed, wet-hand tested, at arm's length on a propped phone
- [ ] Export round-trips: export → import → identical RRF
- [ ] p95 import ≤ 45s on a 12-min YouTube video
- [ ] Paste-fallback reachable from every failure state
