/**
 * Minimal PNG decoder for Cloudflare Workers.
 *
 * Handles 8-bit RGB (color type 2) and RGBA (color type 6) with no interlacing.
 * Returns grayscale pixel values (0-255) in a flat Uint8Array, row-major.
 *
 * Uses DecompressionStream("deflate-raw") available in the Workers runtime.
 */

export interface DecodedImage {
  width: number;
  height: number;
  /** Grayscale 0-255, row-major: pixels[y * width + x] */
  gray: Uint8Array;
  /** RGB 0-255, row-major: rgb[(y * width + x) * 3 + channel]. Only for color types 2/6. */
  rgb?: Uint8Array;
}

// --- PNG chunk parsing ---

function readU32BE(buf: Uint8Array, off: number): number {
  return ((buf[off] << 24) | (buf[off + 1] << 16) | (buf[off + 2] << 8) | buf[off + 3]) >>> 0;
}

interface PNGChunk {
  type: string;
  data: Uint8Array;
}

function parseChunks(png: Uint8Array): PNGChunk[] {
  // Skip 8-byte PNG signature
  let offset = 8;
  const chunks: PNGChunk[] = [];

  while (offset + 8 <= png.length) {
    const length = readU32BE(png, offset);
    const type = String.fromCharCode(png[offset + 4], png[offset + 5], png[offset + 6], png[offset + 7]);
    const data = png.subarray(offset + 8, offset + 8 + length);
    chunks.push({ type, data });
    offset += 8 + length + 4; // length + type + data + crc
  }

  return chunks;
}

// --- Zlib / Deflate decompression ---

async function inflateRaw(data: Uint8Array): Promise<Uint8Array> {
  const ds = new DecompressionStream("deflate-raw");
  const writer = ds.writable.getWriter();
  const reader = ds.readable.getReader();

  writer.write(data);
  writer.close();

  const chunks: Uint8Array[] = [];
  let total = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    total += value.length;
  }

  const result = new Uint8Array(total);
  let off = 0;
  for (const c of chunks) {
    result.set(c, off);
    off += c.length;
  }
  return result;
}

// --- PNG scanline unfiltering ---

function unfilterScanlines(
  raw: Uint8Array,
  width: number,
  height: number,
  bytesPerPixel: number
): Uint8Array {
  const stride = width * bytesPerPixel;
  const out = new Uint8Array(height * stride);

  for (let y = 0; y < height; y++) {
    const filterType = raw[y * (stride + 1)];
    const srcOff = y * (stride + 1) + 1;
    const dstOff = y * stride;
    const prevOff = (y - 1) * stride;

    for (let x = 0; x < stride; x++) {
      const rawByte = raw[srcOff + x];

      // Neighboring bytes for prediction filters
      const a = x >= bytesPerPixel ? out[dstOff + x - bytesPerPixel] : 0; // left
      const b = y > 0 ? out[prevOff + x] : 0;                             // above
      const c = (x >= bytesPerPixel && y > 0) ? out[prevOff + x - bytesPerPixel] : 0; // upper-left

      switch (filterType) {
        case 0: // None
          out[dstOff + x] = rawByte;
          break;
        case 1: // Sub
          out[dstOff + x] = (rawByte + a) & 0xff;
          break;
        case 2: // Up
          out[dstOff + x] = (rawByte + b) & 0xff;
          break;
        case 3: // Average
          out[dstOff + x] = (rawByte + ((a + b) >> 1)) & 0xff;
          break;
        case 4: // Paeth
          out[dstOff + x] = (rawByte + paethPredictor(a, b, c)) & 0xff;
          break;
        default:
          out[dstOff + x] = rawByte;
      }
    }
  }

  return out;
}

function paethPredictor(a: number, b: number, c: number): number {
  const p = a + b - c;
  const pa = Math.abs(p - a);
  const pb = Math.abs(p - b);
  const pc = Math.abs(p - c);
  if (pa <= pb && pa <= pc) return a;
  if (pb <= pc) return b;
  return c;
}

// --- RGB(A) to grayscale ---

function toGrayscale(
  pixels: Uint8Array,
  width: number,
  height: number,
  channels: number
): Uint8Array {
  const gray = new Uint8Array(width * height);
  for (let i = 0; i < width * height; i++) {
    const off = i * channels;
    const r = pixels[off];
    const g = pixels[off + 1];
    const b = pixels[off + 2];
    // ITU-R BT.601 luminance
    gray[i] = (r * 77 + g * 150 + b * 29) >> 8;
  }
  return gray;
}

// --- Public API ---

export async function decodePNG(png: Uint8Array): Promise<DecodedImage> {
  const chunks = parseChunks(png);

  // Parse IHDR
  const ihdr = chunks.find((c) => c.type === "IHDR");
  if (!ihdr) throw new Error("PNG: missing IHDR");

  const width = readU32BE(ihdr.data, 0);
  const height = readU32BE(ihdr.data, 4);
  const bitDepth = ihdr.data[8];
  const colorType = ihdr.data[9];
  const interlace = ihdr.data[12];

  if (bitDepth !== 8) throw new Error(`PNG: unsupported bit depth ${bitDepth}`);
  if (interlace !== 0) throw new Error("PNG: interlaced images not supported");

  let channels: number;
  if (colorType === 2) channels = 3;       // RGB
  else if (colorType === 6) channels = 4;  // RGBA
  else if (colorType === 0) channels = 1;  // Grayscale
  else if (colorType === 4) channels = 2;  // Grayscale + Alpha
  else throw new Error(`PNG: unsupported color type ${colorType}`);

  // Concatenate all IDAT data
  const idatChunks = chunks.filter((c) => c.type === "IDAT");
  let totalIDAT = 0;
  for (const c of idatChunks) totalIDAT += c.data.length;
  const zlibData = new Uint8Array(totalIDAT);
  let off = 0;
  for (const c of idatChunks) {
    zlibData.set(c.data, off);
    off += c.data.length;
  }

  // Strip zlib header (2 bytes) and adler32 footer (4 bytes)
  const deflateData = zlibData.subarray(2, zlibData.length - 4);
  const rawScanlines = await inflateRaw(deflateData);

  // Unfilter
  const pixels = unfilterScanlines(rawScanlines, width, height, channels);

  // Extract RGB for color types (before grayscale conversion)
  let rgb: Uint8Array | undefined;
  if (channels === 3) {
    // RGB: pixels are already 3 bytes/pixel
    rgb = new Uint8Array(pixels);
  } else if (channels === 4) {
    // RGBA: strip alpha to produce 3-byte RGB
    rgb = new Uint8Array(width * height * 3);
    for (let i = 0; i < width * height; i++) {
      rgb[i * 3] = pixels[i * 4];
      rgb[i * 3 + 1] = pixels[i * 4 + 1];
      rgb[i * 3 + 2] = pixels[i * 4 + 2];
    }
  }

  // Convert to grayscale
  let gray: Uint8Array;
  if (channels === 1) {
    gray = pixels;
  } else if (channels === 2) {
    // Grayscale + alpha: just take the grayscale channel
    gray = new Uint8Array(width * height);
    for (let i = 0; i < width * height; i++) {
      gray[i] = pixels[i * 2];
    }
  } else {
    gray = toGrayscale(pixels, width, height, channels);
  }

  return { width, height, gray, rgb };
}
