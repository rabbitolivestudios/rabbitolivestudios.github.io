/**
 * "Moment Before" engine.
 *
 * Given today's Wikipedia events, uses an LLM to:
 *   1. Pick the most visually dramatic event
 *   2. Describe the scene from the MOMENT JUST BEFORE it happened
 *   3. Craft an image-generation prompt in wood-carving style
 *
 * The viewer sees the date, year, and location — but NOT what's about
 * to happen.  Sometimes it's obvious, sometimes it's a guessing game.
 */

import type { Env, MomentBeforeData } from "./types";

const LLM_MODEL = "@cf/meta/llama-3.3-70b-instruct-fp8-fast" as const;

const SYSTEM_PROMPT = `You are "Moment Before" — a creative mind that imagines the scene just BEFORE a famous historical event.

You will receive a numbered list of events that happened on today's date in history.

Your job:
1. Pick the ONE event that would make the most visually striking, dramatic, or mysterious image.
   Prefer events that are widely known, have a clear physical setting, and where the "moment before" creates suspense.
2. Write a short event title (2-5 words) that names the event. Examples: "Sinking of the Titanic", "Kasparov vs Deep Blue", "Moon Landing".
3. Describe the scene from the moment JUST BEFORE the event.  Do NOT show the event itself.
   Example: Titanic → show the ship sailing calmly, iceberg barely visible on the horizon.
4. Extract the geographic location where the event took place.
5. Write an image-generation prompt for an illustration of that scene.
   The prompt MUST specify: hand-carved woodcut print, linocut relief print,
   vintage newspaper woodcut illustration,
   visible U-gouge and V-gouge carving marks,
   sweeping curved gouge strokes (not straight line hatching),
   raised inked ridges (peaks) and carved channels (valleys),
   large solid black ink areas with minimal midtones,
   two to three tonal regions only,
   simple background with strong silhouette separation.
   AVOID: stippling, halftone dots, fine crosshatching, pencil shading,
   airbrush gradients, repetitive horizontal line-banding in the sky, photorealism.
   Cinematic composition, no text or lettering,
   no pens, no pencils, no drawing tools, no art supplies, no hands.

Reply with ONLY valid JSON, no markdown fences, no explanation:
{"year":1912,"title":"Sinking of the Titanic","location":"North Atlantic Ocean","scene":"A massive ocean liner cuts through calm waters under a starlit sky. On the distant horizon, a pale shape rises from the dark sea.","prompt":"1960s newspaper editorial illustration, woodcut etching scratchboard style. A grand ocean liner sailing through calm waters at night under stars, a faint iceberg shape on the far horizon. High contrast black and white, clean hatching detail. Detailed realistic drawing, cinematic wide-angle composition. No text or lettering. No pens, no pencils, no drawing tools."}`;

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
      `1960s newspaper editorial illustration, woodcut etching scratchboard style. ` +
      `A dramatic historical scene from ${event.year}. ` +
      `High contrast with gentle midtones, clean hatching detail, smooth grayscale shading allowed. ` +
      `Cinematic composition. No text or lettering. No pens, no pencils, no drawing tools.`,
  };
}

function fallback(): MomentBeforeData {
  return {
    year: 1969,
    location: "Cape Canaveral, Florida",
    title: "Apollo 11 Launch",
    scene: "A towering rocket stands on the launch pad, wreathed in vapor, under a pale dawn sky.",
    imagePrompt:
      "1960s newspaper editorial illustration, woodcut etching scratchboard style. " +
      "A towering Saturn V rocket standing on a launch pad at dawn, " +
      "wreathed in wisps of vapor, with flat Florida marshland stretching to the horizon. " +
      "High contrast with gentle midtones, clean hatching detail. Cinematic composition. No text or lettering. No pens, no pencils, no drawing tools.",
  };
}
