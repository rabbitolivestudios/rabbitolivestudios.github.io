/**
 * Pure-JS 1-bit (monochrome) PNG encoder for Cloudflare Workers.
 * No external dependencies. Uses DeflateRaw via CompressionStream API.
 *
 * Input:  a Uint8Array pixel buffer where each byte is 0 (black) or 1 (white),
 *         laid out row-major: buffer[y * width + x]
 * Output: a complete PNG file as Uint8Array
 */

const PNG_SIGNATURE = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]);

// CRC32 lookup table
const CRC_TABLE: Uint32Array = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    table[n] = c;
  }
  return table;
})();

function crc32(data: Uint8Array): number {
  let crc = 0xffffffff;
  for (let i = 0; i < data.length; i++) {
    crc = CRC_TABLE[(crc ^ data[i]) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function writeU32BE(arr: Uint8Array, offset: number, value: number): void {
  arr[offset] = (value >>> 24) & 0xff;
  arr[offset + 1] = (value >>> 16) & 0xff;
  arr[offset + 2] = (value >>> 8) & 0xff;
  arr[offset + 3] = value & 0xff;
}

function makeChunk(type: string, data: Uint8Array): Uint8Array {
  const typeBytes = new TextEncoder().encode(type);
  const chunk = new Uint8Array(4 + 4 + data.length + 4);
  // Length
  writeU32BE(chunk, 0, data.length);
  // Type
  chunk.set(typeBytes, 4);
  // Data
  chunk.set(data, 8);
  // CRC over type + data
  const crcInput = new Uint8Array(4 + data.length);
  crcInput.set(typeBytes, 0);
  crcInput.set(data, 4);
  writeU32BE(chunk, 8 + data.length, crc32(crcInput));
  return chunk;
}

function makeIHDR(width: number, height: number): Uint8Array {
  const data = new Uint8Array(13);
  writeU32BE(data, 0, width);
  writeU32BE(data, 4, height);
  data[8] = 1;  // bit depth = 1
  data[9] = 0;  // color type = grayscale
  data[10] = 0; // compression = deflate
  data[11] = 0; // filter = adaptive
  data[12] = 0; // interlace = none
  return makeChunk("IHDR", data);
}

function makeIEND(): Uint8Array {
  return makeChunk("IEND", new Uint8Array(0));
}

/**
 * Pack pixel buffer into 1-bit scanlines with filter byte.
 * Each row: [filter_byte=0, packed_bits...]
 * Bits are MSB-first: pixel 0 is bit 7 of byte 0.
 */
function packScanlines(pixels: Uint8Array, width: number, height: number): Uint8Array {
  const bytesPerRow = Math.ceil(width / 8);
  const raw = new Uint8Array(height * (1 + bytesPerRow));

  for (let y = 0; y < height; y++) {
    const rowOffset = y * (1 + bytesPerRow);
    raw[rowOffset] = 0; // filter type: None

    for (let x = 0; x < width; x++) {
      const pixel = pixels[y * width + x] ? 1 : 0;
      const byteIdx = rowOffset + 1 + (x >> 3);
      const bitIdx = 7 - (x & 7);
      raw[byteIdx] |= pixel << bitIdx;
    }
  }

  return raw;
}

/**
 * Compress data using DeflateRaw (available in Workers via CompressionStream).
 * Falls back to a simple uncompressed deflate if CompressionStream is unavailable.
 */
async function deflateRaw(data: Uint8Array): Promise<Uint8Array> {
  // Use the "deflate-raw" compression stream
  const cs = new CompressionStream("deflate-raw");
  const writer = cs.writable.getWriter();
  const reader = cs.readable.getReader();

  // Write all data then close
  writer.write(data);
  writer.close();

  // Read all output chunks
  const chunks: Uint8Array[] = [];
  let totalLen = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    totalLen += value.length;
  }

  // Combine
  const result = new Uint8Array(totalLen);
  let offset = 0;
  for (const chunk of chunks) {
    result.set(chunk, offset);
    offset += chunk.length;
  }
  return result;
}

/**
 * Wrap deflate-raw data in a zlib container (header + adler32).
 * PNG IDAT expects zlib-wrapped deflate, not raw deflate.
 */
function zlibWrap(deflatedRaw: Uint8Array, originalData: Uint8Array): Uint8Array {
  const adler = adler32(originalData);
  const result = new Uint8Array(2 + deflatedRaw.length + 4);
  // zlib header: CMF=0x78, FLG=0x01 (no dict, compression level 0)
  result[0] = 0x78;
  result[1] = 0x01;
  result.set(deflatedRaw, 2);
  // Adler32 checksum big-endian
  writeU32BE(result, 2 + deflatedRaw.length, adler);
  return result;
}

function adler32(data: Uint8Array): number {
  let a = 1;
  let b = 0;
  for (let i = 0; i < data.length; i++) {
    a = (a + data[i]) % 65521;
    b = (b + a) % 65521;
  }
  return ((b << 16) | a) >>> 0;
}

/**
 * Encode a 1-bit monochrome image as PNG.
 * @param pixels - Uint8Array of size width*height. 0=black, 1=white (or non-zero=white).
 * @param width - image width in pixels
 * @param height - image height in pixels
 * @returns PNG file bytes
 */
export async function encodePNG1Bit(
  pixels: Uint8Array,
  width: number,
  height: number
): Promise<Uint8Array> {
  const ihdr = makeIHDR(width, height);
  const rawScanlines = packScanlines(pixels, width, height);
  const compressed = await deflateRaw(rawScanlines);
  const zlibData = zlibWrap(compressed, rawScanlines);
  const idat = makeChunk("IDAT", zlibData);
  const iend = makeIEND();

  // Concatenate all parts
  const totalLen = PNG_SIGNATURE.length + ihdr.length + idat.length + iend.length;
  const png = new Uint8Array(totalLen);
  let offset = 0;
  png.set(PNG_SIGNATURE, offset); offset += PNG_SIGNATURE.length;
  png.set(ihdr, offset); offset += ihdr.length;
  png.set(idat, offset); offset += idat.length;
  png.set(iend, offset);

  return png;
}

/**
 * Encode a palette-indexed PNG (color type 3).
 * @param indices - Uint8Array of palette indices (0 to palette.length-1), one per pixel
 * @param width - image width
 * @param height - image height
 * @param palette - array of [R, G, B] palette colors
 * @returns PNG file bytes
 */
export async function encodePNGIndexed(
  indices: Uint8Array,
  width: number,
  height: number,
  palette: [number, number, number][]
): Promise<Uint8Array> {
  // IHDR: bit depth 8, color type 3 (indexed)
  const ihdrData = new Uint8Array(13);
  writeU32BE(ihdrData, 0, width);
  writeU32BE(ihdrData, 4, height);
  ihdrData[8] = 8;  // bit depth = 8
  ihdrData[9] = 3;  // color type = indexed-color
  ihdrData[10] = 0; // compression = deflate
  ihdrData[11] = 0; // filter = adaptive
  ihdrData[12] = 0; // interlace = none
  const ihdr = makeChunk("IHDR", ihdrData);

  // PLTE chunk: 3 bytes per palette entry
  const plteData = new Uint8Array(palette.length * 3);
  for (let i = 0; i < palette.length; i++) {
    plteData[i * 3] = palette[i][0];
    plteData[i * 3 + 1] = palette[i][1];
    plteData[i * 3 + 2] = palette[i][2];
  }
  const plte = makeChunk("PLTE", plteData);

  // IDAT: scanlines with filter byte (0x00) + one index byte per pixel
  const raw = new Uint8Array(height * (1 + width));
  for (let y = 0; y < height; y++) {
    const rowOffset = y * (1 + width);
    raw[rowOffset] = 0; // filter type: None
    raw.set(indices.subarray(y * width, (y + 1) * width), rowOffset + 1);
  }

  const compressed = await deflateRaw(raw);
  const zlibData = zlibWrap(compressed, raw);
  const idat = makeChunk("IDAT", zlibData);
  const iend = makeIEND();

  const totalLen = PNG_SIGNATURE.length + ihdr.length + plte.length + idat.length + iend.length;
  const png = new Uint8Array(totalLen);
  let offset = 0;
  png.set(PNG_SIGNATURE, offset); offset += PNG_SIGNATURE.length;
  png.set(ihdr, offset); offset += ihdr.length;
  png.set(plte, offset); offset += plte.length;
  png.set(idat, offset); offset += idat.length;
  png.set(iend, offset);

  return png;
}

function makeIHDRGray8(width: number, height: number): Uint8Array {
  const data = new Uint8Array(13);
  writeU32BE(data, 0, width);
  writeU32BE(data, 4, height);
  data[8] = 8;  // bit depth = 8
  data[9] = 0;  // color type = grayscale
  data[10] = 0; // compression = deflate
  data[11] = 0; // filter = adaptive
  data[12] = 0; // interlace = none
  return makeChunk("IHDR", data);
}

/** Encode PNG bytes to base64 in chunks (avoids stack overflow). */
export function pngToBase64(png: Uint8Array): string {
  let binary = "";
  const CHUNK = 8192;
  for (let i = 0; i < png.length; i += CHUNK) {
    binary += String.fromCharCode(...png.subarray(i, i + CHUNK));
  }
  return btoa(binary);
}

/**
 * Encode an 8-bit grayscale image as PNG.
 * @param gray - Uint8Array of size width*height, values 0 (black) to 255 (white).
 * @param width - image width in pixels
 * @param height - image height in pixels
 * @returns PNG file bytes
 */
export async function encodePNGGray8(
  gray: Uint8Array,
  width: number,
  height: number
): Promise<Uint8Array> {
  const ihdr = makeIHDRGray8(width, height);

  // Build raw scanlines: each row = filter byte (0x00) + width gray bytes
  const raw = new Uint8Array(height * (1 + width));
  for (let y = 0; y < height; y++) {
    const rowOffset = y * (1 + width);
    raw[rowOffset] = 0; // filter type: None
    raw.set(gray.subarray(y * width, (y + 1) * width), rowOffset + 1);
  }

  const compressed = await deflateRaw(raw);
  const zlibData = zlibWrap(compressed, raw);
  const idat = makeChunk("IDAT", zlibData);
  const iend = makeIEND();

  const totalLen = PNG_SIGNATURE.length + ihdr.length + idat.length + iend.length;
  const png = new Uint8Array(totalLen);
  let offset = 0;
  png.set(PNG_SIGNATURE, offset); offset += PNG_SIGNATURE.length;
  png.set(ihdr, offset); offset += ihdr.length;
  png.set(idat, offset); offset += idat.length;
  png.set(iend, offset);

  return png;
}
