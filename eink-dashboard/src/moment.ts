/**
 * "Moment Before" scene engine.
 *
 * Given today's Wikipedia events, uses an LLM to:
 *   1. Pick the most visually dramatic event
 *   2. Describe the EVENT ITSELF at its most iconic moment
 *   3. Craft a scene-only image-generation prompt (style applied separately)
 *
 * Despite the "Moment Before" brand name, the prompt now depicts the event
 * during its defining action — dramatic, recognizable, unmistakable.
 */

import type { Env, MomentBeforeData, CachedValue } from "./types";

const LLM_MODEL = "@cf/meta/llama-3.3-70b-instruct-fp8-fast" as const;

const SYSTEM_PROMPT = `You are a creative historian who depicts famous events at their most iconic, dramatic moment.

You will receive a numbered list of events that happened on today's date in history.

Your job:
1. Pick the ONE event that would make the most visually striking, dramatic image.
   Prefer events that are widely known, have a clear physical setting, and produce an instantly recognizable scene.
2. Write a short event title (2-5 words) that names the event. Examples: "Sinking of the Titanic", "Kasparov vs Deep Blue", "Moon Landing".
3. Describe the scene of the EVENT ITSELF at its defining moment of action.
   Depict the event during its defining action — not the calm before and not the aftermath.
   Examples:
   - Dresden bombing → aircraft overhead, searchlights crossing the sky, explosions lighting up the city below
   - Moon landing → an astronaut stepping onto the lunar surface, Earth hanging in the black sky
   - Titanic → the ocean liner tilted at a steep angle, lifeboats in the water, people on the slanting deck
   Avoid graphic injury, bodies, blood, or close-up suffering; focus on the iconic scene and scale.
4. Extract the geographic location where the event took place.
5. Write an image-generation prompt describing ONLY the scene — subject, setting, composition, lighting, mood.
   The scene MUST be historically accurate to the period: architecture, vehicles, clothing, and technology
   should match the era (e.g., 1945 Dresden has baroque churches and half-timbered houses, not skyscrapers).
   Do NOT include any art style or rendering technique (no "woodcut", "pencil", "charcoal", etc.).
   The style will be applied separately.
   The prompt MUST include: cinematic composition, strong silhouette separation,
   simple background, dramatic lighting.
   No text or lettering, no pens, no pencils, no drawing tools, no art supplies, no hands.

Reply with ONLY valid JSON, no markdown fences, no explanation:
{"year":1912,"title":"Sinking of the Titanic","location":"North Atlantic Ocean","scene":"The great ocean liner lists steeply to one side, its stern rising from the black water. Lifeboats dot the sea below as tiny figures cling to the tilting deck.","prompt":"A massive ocean liner tilting steeply into dark ocean water at night, stern rising, lifeboats scattered on the sea below, tiny figures on the slanting deck. Strong silhouette separation, dramatic lighting, cinematic wide-angle composition."}`;

/**
 * Build the user message listing today's events for the LLM.
 */
function formatEventsForLLM(events: Array<{ year: number; text: string }>): string {
  const lines = events.map((e, i) => `${i + 1}. ${e.year} — ${e.text}`);
  return `Today's events:\n${lines.join("\n")}\n\nPick the best one and reply with JSON only.`;
}

/**
 * Try to extract a JSON object from the LLM's response text.
 * The model sometimes wraps it in markdown fences or adds commentary.
 */
function extractJSON(raw: string): MomentBeforeData | null {
  // Try direct parse first
  try {
    return validateMoment(JSON.parse(raw));
  } catch { /* continue */ }

  // Try to find JSON in the string
  const match = raw.match(/\{[\s\S]*?\}(?=[^}]*$)/);
  if (match) {
    try {
      return validateMoment(JSON.parse(match[0]));
    } catch { /* continue */ }
  }

  // Greedy: find first { to last }
  const first = raw.indexOf("{");
  const last = raw.lastIndexOf("}");
  if (first !== -1 && last > first) {
    try {
      return validateMoment(JSON.parse(raw.slice(first, last + 1)));
    } catch { /* continue */ }
  }

  return null;
}

function validateMoment(obj: any): MomentBeforeData | null {
  if (
    typeof obj.year === "number" &&
    typeof obj.location === "string" &&
    typeof obj.prompt === "string" &&
    obj.location.length > 0 &&
    obj.prompt.length > 0
  ) {
    return {
      year: obj.year,
      location: obj.location,
      title: obj.title ?? "",
      scene: obj.scene ?? "",
      imagePrompt: obj.prompt,
    };
  }
  return null;
}

/**
 * Use the LLM to select an event and generate a "Moment Before" scene.
 * Falls back gracefully if the LLM call fails.
 */
export async function generateMomentBefore(
  env: Env,
  events: Array<{ year: number; text: string }>,
): Promise<MomentBeforeData> {
  if (events.length === 0) {
    return fallback();
  }

  // Pre-filter to a manageable list: prefer 1800–2000, cap at 20
  const preferred = events.filter((e) => e.year >= 1800 && e.year <= 2000);
  const pool = preferred.length >= 5 ? preferred : events;
  const capped = pool.slice(0, 20);

  const userMessage = formatEventsForLLM(capped);

  try {
    const response: any = await env.AI.run(LLM_MODEL, {
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        { role: "user", content: userMessage },
      ],
      max_tokens: 600,
      temperature: 0.7,
    });

    const raw = response?.response ?? response?.result?.response ?? "";
    const text = typeof raw === "string" ? raw : JSON.stringify(raw);
    const parsed = extractJSON(text);
    if (parsed) {
      return parsed;
    }

    console.error("Moment LLM: could not parse response:", text.slice(0, 300));
  } catch (err) {
    console.error("Moment LLM error:", err);
  }

  // Fallback: pick the first event and build a generic prompt
  return fallbackFromEvent(capped[0]);
}

function fallbackFromEvent(event: { year: number; text: string }): MomentBeforeData {
  return {
    year: event.year,
    location: "Unknown",
    title: "",
    scene: event.text,
    imagePrompt:
      `A dramatic depiction of a historical event from ${event.year}. ` +
      `Strong silhouette separation, dramatic lighting, cinematic composition.`,
  };
}

function fallback(): MomentBeforeData {
  return {
    year: 1969,
    location: "Cape Canaveral, Florida",
    title: "Apollo 11 Launch",
    scene: "A Saturn V rocket lifts off in a torrent of flame and smoke, rising above the launch tower.",
    imagePrompt:
      "A Saturn V rocket lifting off from the launch pad, enormous plume of fire and smoke billowing outward, " +
      "the rocket clearing the launch tower against a bright sky. " +
      "Strong silhouette separation, dramatic lighting, cinematic composition.",
  };
}

const MOMENT_CACHE_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours

/**
 * Get or generate the shared Moment Before data for a given date.
 * Caches in KV so all pipelines (A, B, color) share the same event per day.
 */
export async function getOrGenerateMoment(
  env: Env,
  events: Array<{ year: number; text: string }>,
  dateStr: string,
): Promise<MomentBeforeData> {
  const cacheKey = `moment:v1:${dateStr}`;

  const cached = await env.CACHE.get<CachedValue<MomentBeforeData>>(cacheKey, "json");
  if (cached && Date.now() - cached.timestamp < MOMENT_CACHE_TTL_MS) {
    console.log("Moment: cache hit");
    return cached.data;
  }

  const moment = await generateMomentBefore(env, events);
  await env.CACHE.put(cacheKey, JSON.stringify({ data: moment, timestamp: Date.now() }), { expirationTtl: 604800 });
  return moment;
}
