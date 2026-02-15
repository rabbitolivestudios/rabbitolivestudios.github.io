/**
 * Birthday detection and art style rotation.
 *
 * On family birthday dates, /fact.png generates a portrait instead of
 * the regular "Moment Before" historical event.
 */

export interface BirthdayPerson {
  name: string;       // Display name (with accents)
  key: string;        // R2 photo key (ascii, lowercase)
  month: number;      // 1-12
  day: number;        // 1-31
  birthYear: number;
}

const BIRTHDAYS: BirthdayPerson[] = [
  { name: "Thiago",     key: "thiago",   month: 10, day: 20, birthYear: 1977 },
  { name: "Gilmara",    key: "gilmara",  month:  7, day: 26, birthYear: 1979 },
  { name: "João Pedro", key: "joaopedro", month: 10, day:  2, birthYear: 2012 },
  { name: "Lucas",      key: "lucas",    month: 10, day: 10, birthYear: 2014 },
  { name: "Sônia",      key: "sonia",    month: 10, day: 13, birthYear: 1953 },
  { name: "Álvaro",     key: "alvaro",   month: 10, day: 31, birthYear: 1948 },
  { name: "Mariana",    key: "mariana",  month:  1, day:  7, birthYear: 1981 },
  { name: "Theo",       key: "theo",     month:  1, day: 10, birthYear: 2013 },
  { name: "Teteu",      key: "teteu",    month:  9, day:  4, birthYear: 2015 },
];

export function getBirthdayToday(month: number, day: number): BirthdayPerson | null {
  return BIRTHDAYS.find(p => p.month === month && p.day === day) ?? null;
}

export function getBirthdayByKey(key: string): BirthdayPerson | null {
  return BIRTHDAYS.find(p => p.key === key) ?? null;
}

export interface ArtStyle {
  name: string;
  prompt: string;
}

const ART_STYLES: ArtStyle[] = [
  { name: "Woodcut",       prompt: "hand-carved woodcut print, bold U-gouge marks, high contrast black and white" },
  { name: "Watercolor",    prompt: "bold watercolor painting, rich saturated washes, strong tonal contrast, wet-on-wet technique" },
  { name: "Art Nouveau",   prompt: "Art Nouveau portrait, flowing organic lines, Mucha-inspired decorative border" },
  { name: "Pop Art",       prompt: "bold Pop Art portrait, Warhol-inspired, flat vivid colors, halftone dots" },
  { name: "Impressionist", prompt: "Impressionist oil painting, visible brushstrokes, dappled light, Monet-inspired" },
  { name: "Ukiyo-e",       prompt: "Japanese ukiyo-e woodblock print, flat color planes, bold outlines" },
  { name: "Art Deco",      prompt: "Art Deco portrait, geometric patterns, gold and black, elegant symmetry" },
  { name: "Pointillist",   prompt: "Pointillist painting, tiny dots of color, Seurat-inspired, luminous" },
  { name: "Pencil Sketch", prompt: "detailed graphite pencil sketch, fine cross-hatching, full tonal range, on white paper" },
  { name: "Charcoal",      prompt: "dramatic charcoal drawing, expressive strokes, deep shadows, textured paper" },
];

export function getArtStyle(year: number): ArtStyle {
  return ART_STYLES[year % 10];
}
