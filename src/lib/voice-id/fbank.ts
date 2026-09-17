/**
 * Kaldi-compatible log-mel filterbank features for the WeSpeaker speaker-embedding model.
 * Mirrors the model's preprocessor: 16 kHz, 25 ms frames / 10 ms hop, Hamming window, DC offset
 * removal, pre-emphasis 0.97, 512-point FFT power spectrum, 80 Kaldi mel bins (20 Hz–8 kHz,
 * triangles in mel space), natural log with floor, then per-bin mean centering.
 */

export const SAMPLE_RATE = 16_000;
export const NUM_MEL_BINS = 80;
const FRAME_LENGTH = 400;
const HOP_LENGTH = 160;
const FFT_LENGTH = 512;
const NUM_FFT_BINS = FFT_LENGTH / 2 + 1;
const PREEMPHASIS = 0.97;
const MEL_FLOOR = 1.192092955078125e-7;

const kaldiMel = (hz: number) => 1127 * Math.log(1 + hz / 700);

let cachedFilters: Float64Array[] | null = null;
function melFilters(): Float64Array[] {
  if (cachedFilters) return cachedFilters;
  const melMin = kaldiMel(20);
  const melMax = kaldiMel(SAMPLE_RATE / 2);
  const edges = Array.from({ length: NUM_MEL_BINS + 2 }, (_, i) => melMin + ((melMax - melMin) * i) / (NUM_MEL_BINS + 1));
  const binWidth = SAMPLE_RATE / FFT_LENGTH;
  const fftMels = Array.from({ length: NUM_FFT_BINS }, (_, j) => kaldiMel(j * binWidth));
  cachedFilters = Array.from({ length: NUM_MEL_BINS }, (_, i) => {
    const row = new Float64Array(NUM_FFT_BINS);
    for (let j = 0; j < NUM_FFT_BINS; j++) {
      const down = (fftMels[j] - edges[i]) / (edges[i + 1] - edges[i]);
      const up = (edges[i + 2] - fftMels[j]) / (edges[i + 2] - edges[i + 1]);
      row[j] = Math.max(0, Math.min(down, up));
    }
    return row;
  });
  return cachedFilters;
}

const HAMMING = Float64Array.from({ length: FRAME_LENGTH }, (_, n) => 0.54 - 0.46 * Math.cos((2 * Math.PI * n) / (FRAME_LENGTH - 1)));

/** In-place iterative radix-2 FFT. */
function fft(re: Float64Array, im: Float64Array) {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) {
      [re[i], re[j]] = [re[j], re[i]];
      [im[i], im[j]] = [im[j], im[i]];
    }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const angle = (-2 * Math.PI) / len;
    const wr = Math.cos(angle);
    const wi = Math.sin(angle);
    for (let i = 0; i < n; i += len) {
      let cr = 1;
      let ci = 0;
      for (let j = 0; j < len / 2; j++) {
        const a = i + j;
        const b = a + len / 2;
        const tr = re[b] * cr - im[b] * ci;
        const ti = re[b] * ci + im[b] * cr;
        re[b] = re[a] - tr;
        im[b] = im[a] - ti;
        re[a] += tr;
        im[a] += ti;
        const nr = cr * wr - ci * wi;
        ci = cr * wi + ci * wr;
        cr = nr;
      }
    }
  }
}

export interface Fbank {
  data: Float32Array; // frames × 80, row-major
  frames: number;
}

/** @param samples mono audio at 16 kHz in the range [-1, 1] */
export function computeFbank(samples: Float32Array): Fbank {
  const frames = samples.length < FRAME_LENGTH ? 0 : 1 + Math.floor((samples.length - FRAME_LENGTH) / HOP_LENGTH);
  const data = new Float32Array(frames * NUM_MEL_BINS);
  const filters = melFilters();
  const re = new Float64Array(FFT_LENGTH);
  const im = new Float64Array(FFT_LENGTH);
  const power = new Float64Array(NUM_FFT_BINS);

  for (let f = 0; f < frames; f++) {
    re.fill(0);
    im.fill(0);
    const offset = f * HOP_LENGTH;
    let mean = 0;
    for (let j = 0; j < FRAME_LENGTH; j++) {
      re[j] = samples[offset + j] * 32768; // Kaldi works on 16-bit sample values
      mean += re[j];
    }
    mean /= FRAME_LENGTH;
    for (let j = 0; j < FRAME_LENGTH; j++) re[j] -= mean;
    for (let j = FRAME_LENGTH - 1; j >= 1; j--) re[j] -= PREEMPHASIS * re[j - 1];
    re[0] *= 1 - PREEMPHASIS;
    for (let j = 0; j < FRAME_LENGTH; j++) re[j] *= HAMMING[j];

    fft(re, im);
    for (let j = 0; j < NUM_FFT_BINS; j++) power[j] = re[j] * re[j] + im[j] * im[j];

    for (let m = 0; m < NUM_MEL_BINS; m++) {
      const filter = filters[m];
      let energy = 0;
      for (let j = 0; j < NUM_FFT_BINS; j++) energy += filter[j] * power[j];
      data[f * NUM_MEL_BINS + m] = Math.log(Math.max(MEL_FLOOR, energy));
    }
  }

  // Mean-center each mel bin over time.
  for (let m = 0; m < NUM_MEL_BINS; m++) {
    let sum = 0;
    for (let f = 0; f < frames; f++) sum += data[f * NUM_MEL_BINS + m];
    const avg = frames ? sum / frames : 0;
    for (let f = 0; f < frames; f++) data[f * NUM_MEL_BINS + m] -= avg;
  }
  return { data, frames };
}

export function cosineSimilarity(a: ArrayLike<number>, b: ArrayLike<number>): number {
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  return na && nb ? dot / Math.sqrt(na * nb) : 0;
}

/** Averages L2-normalized embeddings into one speaker profile. */
export function averageEmbedding(embeddings: ArrayLike<number>[]): Float32Array {
  const dim = embeddings[0]?.length ?? 0;
  const out = new Float32Array(dim);
  for (const e of embeddings) {
    let norm = 0;
    for (let i = 0; i < dim; i++) norm += e[i] * e[i];
    norm = Math.sqrt(norm) || 1;
    for (let i = 0; i < dim; i++) out[i] += e[i] / norm;
  }
  return out;
}

/** Downsamples mono audio to 16 kHz with a simple averaging low-pass (adequate for speaker embeddings). */
export function resampleTo16k(input: Float32Array, fromRate: number): Float32Array {
  if (fromRate === SAMPLE_RATE) return input;
  const ratio = fromRate / SAMPLE_RATE;
  const out = new Float32Array(Math.floor(input.length / ratio));
  const span = Math.max(1, Math.round(ratio));
  for (let i = 0; i < out.length; i++) {
    const center = Math.floor(i * ratio);
    let sum = 0;
    let count = 0;
    for (let k = center; k < center + span && k < input.length; k++) {
      sum += input[k];
      count++;
    }
    out[i] = count ? sum / count : 0;
  }
  return out;
}
