/**
 * DCT-based perceptual hash (pHash).
 *
 * The algorithm is a port of the perceptual-hash design used by Loopifi
 * (https://github.com/nyavramov/loopifi, see `loopifi/loops/__init__.py`, which delegates to the
 * `imagehash.phash` implementation): downscale to a small grayscale thumbnail, take a separable 2D
 * DCT, keep the low-frequency top-left block and set one bit per coefficient = "above the block
 * median".
 *
 * Pipeline: low-res RGB frame → 32×32 grayscale (box average) → separable DCT → top-left 16×16
 * block → 256 bits (8× Uint32 words, Hamming distance via a 16-bit popcount lookup table).
 *
 * A pHash is robust to tiny shifts / noise, so two frames that look the same but differ in a
 * handful of pixels still hash close together — exactly the property a wallpaper-loop seam needs.
 */

export const PHASH_SIZE = 16; // output hash grid (16×16 = 256 bits)
export const HASH_WORDS = (PHASH_SIZE * PHASH_SIZE) >> 5; // 8 × Uint32
const DCT_INPUT_SIZE = 32; // grayscale thumbnail fed to the DCT

// 16-bit popcount lookup table, built once on first use.
const POPCNT16 = new Uint8Array(1 << 16);
for (let i = 1; i < POPCNT16.length; i++) {
  POPCNT16[i] = (i & 1) + POPCNT16[i >> 1];
}

let dctBasisCache: Float64Array[] | null = null;

/** 1D DCT-II basis vectors for size N, computed once and reused. */
function getDctBasis(): Float64Array[] {
  if (dctBasisCache) return dctBasisCache;
  const n = DCT_INPUT_SIZE;
  const basis: Float64Array[] = [];
  for (let u = 0; u < n; u++) {
    const row = new Float64Array(n);
    const a = u === 0 ? Math.sqrt(1 / n) : Math.sqrt(2 / n);
    for (let x = 0; x < n; x++) {
      row[x] = a * Math.cos(((2 * x + 1) * u * Math.PI) / (2 * n));
    }
    basis.push(row);
  }
  dctBasisCache = basis;
  return basis;
}

/**
 * Convert a low-res rgb24 frame into a 32×32 grayscale thumbnail using box averaging (area-average
 * over the source block each output pixel covers).
 */
export function rgbToGrayThumb(rgb: Uint8Array, width: number, height: number): Float64Array {
  const out = new Float64Array(DCT_INPUT_SIZE * DCT_INPUT_SIZE);
  const sw = width / DCT_INPUT_SIZE;
  const sh = height / DCT_INPUT_SIZE;
  for (let oy = 0; oy < DCT_INPUT_SIZE; oy++) {
    const y0 = Math.min(height - 1, Math.floor(oy * sh));
    const y1 = Math.max(y0 + 1, Math.min(height, Math.ceil((oy + 1) * sh)));
    for (let ox = 0; ox < DCT_INPUT_SIZE; ox++) {
      const x0 = Math.min(width - 1, Math.floor(ox * sw));
      const x1 = Math.max(x0 + 1, Math.min(width, Math.ceil((ox + 1) * sw)));
      let sum = 0;
      let count = 0;
      for (let y = y0; y < y1; y++) {
        for (let x = x0; x < x1; x++) {
          const p = (y * width + x) * 3;
          sum += 0.299 * rgb[p] + 0.587 * rgb[p + 1] + 0.114 * rgb[p + 2];
          count++;
        }
      }
      out[oy * DCT_INPUT_SIZE + ox] = sum / count;
    }
  }
  return out;
}

/**
 * Compute the 256-bit pHash of a 32×32 grayscale thumbnail. Returns HASH_WORDS (8) Uint32 words;
 * bit i of the flattened 16×16 block.
 */
export function phashFromGray(gray: Float64Array): Uint32Array {
  const n = DCT_INPUT_SIZE;
  const basis = getDctBasis();

  // R = top PHASH_SIZE rows of (C · M): R[u][x] = Σ_m C[u][m]·M[m][x].
  const R = new Float64Array(PHASH_SIZE * n);
  for (let u = 0; u < PHASH_SIZE; u++) {
    const cu = basis[u];
    for (let x = 0; x < n; x++) {
      let acc = 0;
      for (let m = 0; m < n; m++) acc += cu[m] * gray[m * n + x];
      R[u * n + x] = acc;
    }
  }

  // D[u][v] = Σ_x R[u][x]·C[v][x], only the top-left PHASH_SIZE² block.
  const dct = new Float64Array(PHASH_SIZE * PHASH_SIZE);
  for (let u = 0; u < PHASH_SIZE; u++) {
    for (let v = 0; v < PHASH_SIZE; v++) {
      const cv = basis[v];
      let acc = 0;
      for (let x = 0; x < n; x++) acc += R[u * n + x] * cv[x];
      dct[u * PHASH_SIZE + v] = acc;
    }
  }

  // Bit = coefficient above the block median (DC included, like imagehash).
  const sorted = Array.from(dct).sort((a, b) => a - b);
  const mid = sorted.length >> 1;
  const median = (sorted[mid - 1] + sorted[mid]) / 2;

  const words = new Uint32Array(HASH_WORDS);
  for (let i = 0; i < PHASH_SIZE * PHASH_SIZE; i++) {
    if (dct[i] > median) words[i >> 5] |= 1 << (i & 31);
  }
  return words;
}

/** Hamming distance between two pHash words. */
export function hammingDistance(a: Uint32Array, b: Uint32Array): number {
  let d = 0;
  for (let w = 0; w < a.length; w++) {
    const x = a[w] ^ b[w];
    d += POPCNT16[x & 0xffff] + POPCNT16[x >>> 16];
  }
  return d;
}

/** Hamming distance normalized to [0, 1] (1 = completely different frames). */
export function normalizedDistance(a: Uint32Array, b: Uint32Array): number {
  return hammingDistance(a, b) / (HASH_WORDS * 32);
}
