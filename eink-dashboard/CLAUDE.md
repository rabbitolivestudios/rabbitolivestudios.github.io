# Claude Code — E-Ink Dashboard Project Guidelines

**Purpose**: Persistent instructions for Claude Code sessions on the E-Ink Dashboard. Read this file end-to-end at the start of every session before doing any work.

**Default behavior**: Prefer small, reviewable changes. Test visually before deploying. Strong documentation over large refactors.

**Critical**: The auto-memory (`MEMORY.md`) defines current technical truth. When sources conflict, prefer `MEMORY.md` first, then `DECISIONS.md`, then `README.md`, then session chat logs.

---

## Start of Session Checklist (mandatory)

Every session must begin with these steps:

1. Read this file (`CLAUDE.md`) end-to-end
2. Read `MEMORY.md` (auto-loaded) — authoritative technical snapshot
3. Read `DECISIONS.md` — understand standing decisions and failed approaches
4. Read `README.md` — understand current endpoints, pipelines, architecture
5. Run `git log --oneline -10` — understand recent changes
6. Run `git status` — check for uncommitted work
7. Check `package.json` version — know what version is current
8. Summarize the current project state in 3-5 bullets before proceeding
9. Ask the user what they want to work on
10. Confirm scope and define a "done checklist" before writing any code

---

## Quick Obligations

| Situation | Required action |
|-----------|----------------|
| Starting a session | Run the full Start of Session Checklist above |
| Before writing code | Read the files you plan to modify. Never propose changes to code you haven't read |
| After completing a feature or fix | Update all documentation in the same commit (see Documentation section) |
| Before deploying | `npx wrangler deploy --dry-run` to verify the build succeeds |
| Before committing | Verify build succeeds. Do not commit broken code |
| Ending a session | Update docs, commit and push, stop dev server if running |
| Ideas or features discussed but not implemented | Note in commit message or DECISIONS.md |
| Changing any pipeline or cache behavior | Bump the relevant cache key version |
| Adding visual changes to weather/fact pages | Test in browser at 800x480 before deploying |

---

## Project Overview

- **Project**: E-Ink "Moment Before" Dashboard
- **Tech**: Cloudflare Workers (TypeScript)
- **Repo**: `rabbitolivestudios/rabbitolivestudios.github.io`
- **Subdirectory**: `eink-dashboard/`
- **Live URL**: `https://eink-dashboard.thiago-oliveira77.workers.dev`
- **Displays**: reTerminal E1001 (mono, 7.5" ePaper, 800x480) + reTerminal E1002 (Spectra 6 color, 7.3", 800x480)
- **Device manager**: SenseCraft HMI (Web Function screenshots URLs)

---

## Build, Test, Deploy

```bash
# Build check (always run before committing)
npx wrangler deploy --dry-run

# Local dev server (check port 8787/8790 availability first)
lsof -ti:8790
npx wrangler dev --port 8790

# Deploy to production
npx wrangler deploy

# Test endpoints (E1001) — no key needed in local dev
curl http://localhost:8790/weather?test-device
curl http://localhost:8790/weather?test-device&test-alert=tornado
curl http://localhost:8790/fact.png
curl "http://localhost:8790/test.png?m=10&d=31"
# In production (TEST_AUTH_KEY set): curl "https://URL/test.png?m=10&d=31&key=YOUR_KEY"

# Test endpoints (E1002 color)
curl http://localhost:8790/color/weather?test-device
curl http://localhost:8790/color/weather?test-device&test-alert=tornado
curl http://localhost:8790/color/headlines?test-headlines
curl "http://localhost:8790/color/test-moment?m=7&d=20"
curl http://localhost:8790/color/apod
```

Always build before committing. Do not commit code that doesn't compile.

---

## Image Pipelines — DO NOT Cross-Contaminate

This project has independent image pipelines. They share the LLM event selection (via `getOrGenerateMoment`) but diverge at style injection, image model, and post-processing. Changes to one pipeline must not affect the others.

| | Pipeline A (`/fact.png`) | Pipeline B (`/fact1.png`) | Pipeline D (`/color/moment`) |
|---|---|---|---|
| Model | FLUX.2 klein-9b | SDXL | FLUX.2 (fallback SDXL) |
| Style | Daily rotation (Woodcut/Pencil/Charcoal) | 6-style rotation (style-aware) | 5-style rotation (gouache/oil/graphic/ink/woodblock) |
| Output | 4-level grayscale | 1-bit (Bayer or threshold) | 6-color Spectra (Floyd-Steinberg) |
| Cache key | `fact4:v4:YYYY-MM-DD` | `fact1:v7:YYYY-MM-DD` | `color-moment:v2:YYYY-MM-DD:STYLE_ID` |
| Display | E1001 (mono) | E1001 (mono) | E1002 (Spectra 6) |

---

## E-Ink Display Constraints

These constraints are non-negotiable for any UI changes:

- **800x480px** — no scrolling, everything must fit
- **Pure black (#000) only** — grays are invisible on e-ink
- **No emoji** — ESP32-S3 renderer lacks emoji font support, use inline SVG
- **No JavaScript** — SenseCraft HMI screenshots static HTML
- **Test at 800x480** in browser before deploying visual changes
- **Test all alert states** — normal, tornado, winter, rain warning
- **Always bump cache key version** after pipeline changes

---

## Definition of Done

Before coding any task, write a short checklist:
- What must work
- What must be tested (browser at 800x480 + live device if applicable)
- What docs must be updated
- How success is verified
- Edge cases to consider (e.g., alert banners, no device data, API failures)

At the end, explicitly confirm each item.

---

## Documentation Requirements

Change logging is mandatory. Every meaningful change must update documentation **in the same commit**.

### Documentation Files

| File | Purpose | Update when |
|------|---------|-------------|
| `MEMORY.md` | Auto-memory — technical truth, key learnings | Architecture changes, new patterns, critical bugs |
| `DECISIONS.md` | Why things are the way they are, failed approaches | Any tradeoff, threshold change, or pipeline change |
| `README.md` | User-facing: endpoints, pipelines, architecture, setup | New endpoints, changed behavior, version bumps |
| `package.json` | Version number | Feature releases |
| `src/index.ts` | `VERSION` constant | Feature releases |

### Mandatory Documentation Sweep

Every time you update documentation, sweep ALL files:

| # | File | Check |
|---|------|-------|
| 1 | `MEMORY.md` | Key architecture, cache keys, learnings — all accurate? |
| 2 | `DECISIONS.md` | Any new or changed decisions documented? |
| 3 | `README.md` | Endpoints table, architecture diagram, version — all accurate? |
| 4 | `package.json` + `src/index.ts` | Version numbers match? |

Do not commit documentation updates until you have verified every file.

---

## Code Standards

- **Think before coding.** Follow this order:
  1. Think about the architecture
  2. Read the existing codebase
  3. Check `DECISIONS.md` and `MEMORY.md` for past learnings
  4. Implement, or ask about tradeoffs
- **Fix from first principles.** Don't apply bandaids. Find the root cause.
- **Keep it simple.** Write idiomatic TypeScript. Always ask: is this the simplest solution?
- **No dead code.** Delete unused functions, parameters, and files.
- **Avoid unnecessary changes.** Don't refactor or "improve" code that wasn't part of the task.
- **Do not mix refactors with features.** Separate commits.
- **Follow existing patterns.** `alerts.ts` is the template for cached API fetches. `image.ts` is the template for image pipelines.
- **Graceful degradation.** External API failures should return `null` or `[]`, never crash the page.

### TypeScript/Workers Specific

- Use `Env` type from `src/types.ts` for all bindings
- Always coerce LLM responses: `typeof raw === "string" ? raw : JSON.stringify(raw)`
- Chunk large arrays for `String.fromCharCode` (8192-byte slices) to avoid stack overflow
- SDXL does NOT support `negative_prompt` — embed negatives in positive prompt
- FLUX.2 requires multipart FormData, not JSON
- KV cache dates use America/Chicago timezone
- All external fetches must use `fetchWithTimeout()` from `src/fetch-timeout.ts`
- All KV `.put()` calls must include `expirationTtl` (86400 for ephemeral, 604800 for daily) — see DECISIONS.md #24 for why ephemeral must be >>soft TTL

---

## Testing Expectations

For visual changes (weather page, fact page):
- Test in browser at exactly 800x480 viewport
- Test all states: with/without device data, with/without alerts, with/without rain warning
- Test params: `?test-device`, `?test-alert=tornado|winter|flood`, `?test-rain`, `?test-temp=N`

For image pipeline changes:
- Use `/test.png?m=MM&d=DD` and `/test1.png?m=MM&d=DD` to test arbitrary dates
- Use `/test-birthday.png?name=KEY&style=N` for birthday portraits
- Verify both pipelines independently

For API/cache changes:
- Test with fresh dates to bypass KV cache
- Remember local KV persists between `wrangler dev` restarts

---

## Git Practices

- **Commit messages**: Short summary line, blank line, body explaining why (not what). End with `Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>`
- **Commit often**: One logical change per commit. Don't batch unrelated changes.
- **Never force push** to main.
- **Push after committing** unless told otherwise.
- **Version bumps**: Only when the user explicitly requests or approves.
- **Do not delete or rewrite history** in documentation files.

---

## Change Summary (mandatory output)

After completing any work, output a change summary:

```
## Change Summary
- **What changed**: (files and what was modified)
- **Why**: (reason for the change)
- **How to test**: (exact steps to verify)
- **Docs updated**: (list of docs updated)
- **Risks / follow-ups**: (anything that needs attention)
```

---

## Hard "Do Not" List

- Do not claim something is implemented unless it builds and works.
- Do not delete or rewrite history in documentation.
- Do not mix large refactors with feature work in one commit.
- Do not propose changes to code you haven't read.
- Do not commit code that doesn't compile (`--dry-run` first).
- Do not skip documentation updates.
- Do not cross-contaminate Pipeline A and Pipeline B.
- Do not deploy without testing visual changes at 800x480.
- Do not use grays, emoji, or JavaScript in HTML pages (e-ink constraints).
- Do not forget to bump cache key versions after pipeline changes.
- Do not leave dev servers running at end of session.

---

## Credential & Secret Protection

The SenseCraft API key is intentionally hardcoded (shared platform key, single-device personal project — documented in `DECISIONS.md`). For any other credentials:

1. **REFUSE credentials.** If the user shares passwords, private keys, or auth tokens, STOP and warn them.
2. **NEVER write credentials to any file** — not code, not documentation, not commit messages.
3. **NEVER commit credential files** (`.env`, `*.key`, `*.pem`, `*.secret`).

---

## File Structure

```
eink-dashboard/
  src/
    index.ts              — Main router, cron handler, VERSION constant
    types.ts              — All TypeScript interfaces
    date-utils.ts         — Chicago timezone date helpers
    weather.ts            — Open-Meteo weather fetch + KV cache
    weather-codes.ts      — WMO code → label/icon mapping, day/night overrides
    alerts.ts             — NWS weather alerts fetch + KV cache
    device.ts             — SenseCraft device data fetch + KV cache
    fact.ts               — Wikipedia "On This Day" fetch + KV cache
    moment.ts             — LLM event selection + scene prompt generation
    image.ts              — Pipeline A (FLUX.2 4-level) + Pipeline B (SDXL 1-bit)
    image-color.ts        — RGB crop/resize + AI-to-RGB decode helpers
    convert-1bit.ts       — 1-bit conversion engine (Bayer + threshold)
    styles-1bit.ts        — Pipeline B style table, picker, hash
    birthday.ts           — Birthday data + detection
    birthday-image.ts     — Birthday portrait generation (FLUX.2 + R2 photos)
    escape.ts             — HTML escaping utility (escapeHTML)
    fetch-timeout.ts      — fetchWithTimeout() utility (AbortController-based)
    validate.ts           — Input validation (parseMonth, parseDay, parseStyleIdx)
    response.ts           — htmlResponse() with security headers
    headlines.ts          — Steel/trade RSS + LLM summarizer
    apod.ts               — NASA APOD fetcher + Spectra 6 image processor
    spectra6.ts           — Spectra 6 palette constants + CSS variables
    dither-spectra6.ts    — Floyd-Steinberg dithering engine
    png.ts                — Pure JS PNG encoder (8-bit, 1-bit, indexed)
    png-decode.ts         — PNG decoder (RGB, RGBA, Gray, GrayAlpha)
    font.ts               — 8x8 bitmap font (CP437)
    pages/
      weather2.ts         — /weather HTML page (E1001 mono)
      fact.ts             — /fact HTML wrapper for fact.png
      color-weather.ts    — /color/weather HTML page (E1002 Spectra 6)
      color-moment.ts     — /color/moment + color birthday + test endpoints
      color-apod.ts       — /color/apod HTML page
      color-headlines.ts  — /color/headlines HTML page
  photos/                 — Birthday reference photos source
  scripts/                — Upload scripts
  CLAUDE.md               — This file
  DECISIONS.md            — Architecture & design decisions
  README.md               — Project documentation
  wrangler.toml           — Cloudflare Worker config + bindings
  package.json            — Dependencies + version
  tsconfig.json           — TypeScript config
```
