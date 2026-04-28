const assert = require("node:assert/strict");
const path = require("node:path");
const test = require("node:test");

const buildDir = process.env.EINK_TEST_BUILD_DIR || "/tmp/eink-dashboard-tests";
const fromBuild = (p) => require(path.join(buildDir, p));

const { parseMonth, parseDay, parseStyleIdx } = fromBuild("src/validate.js");
const { thresholdFromHistogram } = fromBuild("src/convert-1bit.js");
const { moonPhaseHTML } = fromBuild("src/weather-ui.js");
const {
  parseDateParts,
  pickSkylineCity,
  pickSkylineStyle,
  DEFAULT_ROTATE_MIN,
} = fromBuild("src/skyline.js");
const {
  fact4CacheKey,
  fact1CacheKey,
  colorMomentCacheKey,
  skylineCacheKey,
  generationLockKey,
} = fromBuild("src/cache-keys.js");

test("query param validators clamp to safe defaults", () => {
  assert.equal(parseMonth("12"), 12);
  assert.equal(parseMonth("0"), 1);
  assert.equal(parseMonth("abc"), 1);
  assert.equal(parseDay("31"), 31);
  assert.equal(parseDay("99"), 1);
  assert.equal(parseStyleIdx("9"), 9);
  assert.equal(parseStyleIdx("99"), 0);
  assert.equal(parseStyleIdx(null), undefined);
});

test("skyline date and picker behavior is deterministic", () => {
  const parts = parseDateParts("2026-06-01");
  const opts = { mode: "daily", rotateMin: DEFAULT_ROTATE_MIN, bucket: 0 };
  assert.equal(parts.dayOfYear, 152);
  assert.equal(pickSkylineCity(parts, opts).key, "chicago");
  assert.equal(pickSkylineStyle(parts, opts).key, pickSkylineStyle(parts, opts).key);
});

test("moon phase override is bounded in rendered HTML", () => {
  assert.match(
    moonPhaseHTML("#fff", "#000", 22, new Date("2026-01-01T12:00:00Z"), 99),
    /Waning Crescent/,
  );
});

test("histogram threshold and cache keys stay stable", () => {
  const ramp = Uint8Array.from({ length: 256 }, (_, i) => i);
  assert.equal(thresholdFromHistogram(ramp, 0.5), 127);
  assert.equal(fact4CacheKey("2026-04-27"), "fact4:v4:2026-04-27");
  assert.equal(fact1CacheKey("2026-04-27"), "fact1:v7:2026-04-27");
  assert.equal(colorMomentCacheKey("2026-04-27", "gouache"), "color-moment:v2:2026-04-27:gouache");
  assert.equal(skylineCacheKey("2026-04-27", "daily", 15, 0, true), "skyline:v3:2026-04-27:daily:bw");
  assert.equal(generationLockKey("fact4:v4:2026-04-27"), "gen-lock:v1:fact4:v4:2026-04-27");
});
