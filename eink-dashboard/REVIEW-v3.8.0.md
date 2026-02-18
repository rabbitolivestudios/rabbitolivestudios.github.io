# E-Ink Dashboard v3.8.0 — Full Codebase Analysis

**Date**: 2026-02-17
**Status**: Pending discussion — review findings and decide on action plan

---

## Executive Summary

Four parallel analysis agents reviewed the entire codebase (~5,700 lines of TypeScript). Key findings:

- **Security**: 3 critical, 5 high, 5 medium, 6 low issues identified
- **Bugs**: 1 documentation bug confirmed; 3 "missing await" flags are false positives
- **Performance**: Cron handler runs image pipelines serially (~50s); parallelizing would cut to ~30s
- **Code health**: ~470 lines of duplicate code across 4 patterns; `pngToBase64` duplicated 3x, `normalize()` duplicated 2x, SVG icons duplicated across weather pages
- **Features**: 16 ideas proposed, top 3: personal dashboard, moon phase widget, AQI badge

---

## 1. SECURITY FINDINGS

### Critical

| # | Finding | File | Lines | Risk |
|---|---------|------|-------|------|
| S1 | **Unvalidated `m`/`d` URL params** in test endpoints — injected directly into Wikipedia API URL | `index.ts`, `color-moment.ts` | 354-356, 305-308 | SSRF, path traversal |
| S2 | **Hardcoded SenseCraft API key** in source code | `device.ts` | 10 | Credential exposure if repo goes public |
| S3 | **APOD API key fallback to DEMO_KEY** without explicit logging | `apod.ts` | 32 | Silent misconfiguration |

**Recommended fixes:**
- S1: Validate `m` as integer [1-12], `d` as integer [1-31] before interpolation
- S2: Move to `env.SENSECRAFT_API_KEY` (already documented as intentional in DECISIONS.md, but still a risk)
- S3: Add `console.warn` when falling back to DEMO_KEY

### High

| # | Finding | File | Lines |
|---|---------|------|-------|
| S4 | Unescaped `nameParam` in error responses | `index.ts:408`, `color-moment.ts:335` | 405, 332 |
| S5 | `parseInt(style)` with no bounds check — could be `9999999999` | `index.ts:411`, `color-moment.ts:338` | 411, 338 |
| S6 | `months[parseInt(m) - 1]` — array out-of-bounds if m > 12 | `color-moment.ts` | 318-319 |
| S7 | Inline CSS `style="color:${tColor}"` — safe now but fragile pattern | `color-weather.ts` | 213-227 |
| S8 | Plain text error response with unescaped user input | `color-moment.ts` | 335 |

### Medium

| # | Finding | Notes |
|---|---------|-------|
| S9 | No rate limiting on test endpoints beyond auth key | Wikipedia could be DoS'd |
| S10 | Unconstrained response sizes from external APIs | No body size limit |
| S11 | Regex-based RSS/XML parsing | ReDoS risk (low probability) |
| S12 | LLM response failures are silent | No logging of problematic responses |
| S13 | Cache key constructed with user-controlled date parts | Potential cache poisoning |

### Low

- Missing Content-Type on error responses
- IP-based rate limiter resets on isolate restart
- Verbose error messages leak status codes
- Missing security headers (X-Frame-Options, CSP)
- Hardcoded coordinates
- Overly permissive CORS (`*`)

---

## 2. BUG FINDINGS

### False Positives (NOT bugs)

The bug hunt agent flagged 3 "missing await" issues in `image.ts:476`, `image.ts:506`, and `birthday-image.ts:94` as CRITICAL. These are **false positives**: returning a Promise from an `async` function without `await` behaves identically for the caller — the outer async function always returns a Promise, and the caller's `await` unwraps it correctly.

### Confirmed Issues

| # | Finding | File | Severity |
|---|---------|------|----------|
| B1 | **Outdated comment**: says "floor 140" but code uses `100` | `convert-1bit.ts:54` | Trivial (documentation) |
| B2 | Silent cache corruption handling — no logging when `JSON.parse` fails on cached data | `color-moment.ts:261` | Low |
| B3 | No runtime validation of `CachedValue<MomentBeforeData>` fields from KV | `moment.ts:185-189` | Low |

---

## 3. PERFORMANCE & ARCHITECTURE

### Cron Handler Serialization (Biggest Win)

**Current**: `handleScheduled` runs all operations sequentially — ~45-60s total.

**Opportunity**: Parallelize independent operations:

```
Phase 1 (parallel):  headlines + weather x2 + device x2     -> ~5s
Phase 2 (serial):    getTodayEvents + getOrGenerateMoment    -> ~4s
Phase 3 (parallel):  Pipeline A + B + D + APOD               -> ~5s (was ~16s serial)
Phase 4 (parallel):  All KV puts                             -> ~0.1s (was ~0.5s)
```

**Estimated savings**: 40% faster cron (50s -> 30s). Risk is minimal — all operations are idempotent.

### Code Duplication Summary

| Pattern | Files | Duplicated Lines | Fix Effort |
|---------|-------|------------------|------------|
| `pngToBase64()` x 3 | index.ts, apod.ts, color-moment.ts | ~30 | 30 min |
| `normalize()` x 2 | weather.ts | ~160 | 1 hour |
| SVG icon library x 2 | weather2.ts, color-weather.ts | ~200 | 1.5 hours |
| Style rotation logic x 3 | image.ts, color-moment.ts, birthday-image.ts | ~80 | 1.5 hours |
| **Total** | | **~470 lines** | **~4.5 hours** |

### Bundle Size

Current: ~156 KB / gzip: ~35 KB. Deduplication could save 10-15% (~5 KB gzipped). Not urgent.

### KV Cache Inconsistency

Some modules wrap data in `{ data, timestamp }` (weather, headlines), others store raw strings (APOD color image). Standardizing would improve maintainability but isn't breaking.

---

## 4. FEATURE IDEAS (Top 10)

| # | Idea | Impact | Effort | Notes |
|---|------|--------|--------|-------|
| F1 | **Personal Dashboard** (`/dashboard`) | HIGH | 2-3h | Read-only gallery of recent images + device status + cache health |
| F2 | **Moon Phase Widget** on weather pages | MEDIUM | 1-1.5h | Pure calculation (no API), 8 SVG icons |
| F3 | **AQI Badge** on weather pages | MEDIUM | 1-1.5h | Free API (waqi.info), 1h cache |
| F4 | **Random Historical Moment** (`/color/random-moment`) | MEDIUM | 2-3h | Pick random date, generate Moment Before — infinite content |
| F5 | **Health Check** endpoint (`/health-detailed`) | MEDIUM | 1.5-2h | Verify cron ran, KV is fresh, devices online |
| F6 | **Sunrise/Sunset Golden Hour** times on weather | LOW | 30 min | Pure math from existing sunrise/sunset data |
| F7 | **Pollen Forecast** badges on weather | LOW | 1h | Google Pollen API, 24h cache |
| F8 | **Sports Scores** page for E1002 | MEDIUM | 3-4h | ESPN RSS, hardcoded teams |
| F9 | **Image Quality Metrics** (brightness histogram, contrast) | LOW | 2-3h | Diagnostic tool for pipeline regression detection |
| F10 | **Weekly Calendar** page for E1002 | MEDIUM | 4-6h | Requires iCal feed or Google Calendar OAuth |

### Recommended Starting Points

If picking 3: **Dashboard (F1)** + **Moon Phase (F2)** + **AQI (F3)** = ~5 hours total, immediately useful.

---

## 5. PRIORITIZED ACTION PLAN

### Phase 1: Security Hardening (1-2 hours)
1. Validate `m`/`d` params as integers [1-12] and [1-31] in all test endpoints
2. Escape `nameParam` in error responses with `escapeHTML()`
3. Clamp `style` param to [0-9]
4. Add security headers to all HTML responses
5. Log warning when APOD_API_KEY falls back to DEMO_KEY

### Phase 2: Performance (2-3 hours)
1. Parallelize `handleScheduled` cron handler (biggest single win)
2. Batch KV writes with `Promise.all()`

### Phase 3: Code Health (4-5 hours)
1. Extract `pngToBase64()` to shared utility
2. Merge `normalize()` / `normalizeForLocation()` in weather.ts
3. Extract SVG icons to shared module
4. Fix outdated comment in convert-1bit.ts

### Phase 4: New Features (5+ hours)
1. Personal dashboard page
2. Moon phase widget
3. AQI badge
4. Health check endpoint

---

## What NOT to Do

- Don't add user auth (single-user project, adds complexity without value)
- Don't switch to a proper XML parser for RSS (regex works, bundle size matters)
- Don't try dynamic color palette expansion (Spectra 6 hardware is fixed at 6 colors)
- Don't add social sharing / Instagram bot (separate project, not here)
- Don't over-engineer the rate limiter (Cloudflare's built-in is fine for this scale)
