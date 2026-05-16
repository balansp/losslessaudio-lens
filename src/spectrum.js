const FFT_SIZE = 32768; // 2^15 — good balance of freq resolution vs speed

// Cooley-Tukey radix-2 in-place FFT (operates on Float64Arrays)
function fft(re, im) {
  const n = re.length;

  // Bit-reverse permutation
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) {
      [re[i], re[j]] = [re[j], re[i]];
      [im[i], im[j]] = [im[j], im[i]];
    }
  }

  // Butterfly operations
  for (let len = 2; len <= n; len <<= 1) {
    const ang = (2 * Math.PI) / len;
    const wBaseRe = Math.cos(ang);
    const wBaseIm = Math.sin(ang);
    for (let i = 0; i < n; i += len) {
      let curRe = 1, curIm = 0;
      const half = len >> 1;
      for (let j = 0; j < half; j++) {
        const uRe = re[i + j];
        const uIm = im[i + j];
        const vRe = re[i + j + half] * curRe - im[i + j + half] * curIm;
        const vIm = re[i + j + half] * curIm + im[i + j + half] * curRe;
        re[i + j] = uRe + vRe;
        im[i + j] = uIm + vIm;
        re[i + j + half] = uRe - vRe;
        im[i + j + half] = uIm - vIm;
        const nextRe = curRe * wBaseRe - curIm * wBaseIm;
        curIm = curRe * wBaseIm + curIm * wBaseRe;
        curRe = nextRe;
      }
    }
  }
}

function buildHannWindow(n) {
  const w = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    w[i] = 0.5 * (1 - Math.cos((2 * Math.PI * i) / (n - 1)));
  }
  return w;
}

const hannWindow = buildHannWindow(FFT_SIZE);

/**
 * Compute an averaged power spectrum from a mono f32 sample buffer.
 * Returns { powerSpectrum: Float64Array (dBFS per bin), binSize: Hz }
 */
export function computeSpectrum(samples, sampleRate) {
  const numBins = FFT_SIZE / 2;
  const binSize = sampleRate / FFT_SIZE;
  const accumulated = new Float64Array(numBins);
  let windowCount = 0;

  const hopSize = FFT_SIZE / 2; // 50% overlap

  for (let offset = 0; offset + FFT_SIZE <= samples.length; offset += hopSize) {
    const re = new Float64Array(FFT_SIZE);
    const im = new Float64Array(FFT_SIZE);

    for (let i = 0; i < FFT_SIZE; i++) {
      re[i] = samples[offset + i] * hannWindow[i];
    }

    fft(re, im);

    for (let i = 0; i < numBins; i++) {
      accumulated[i] += re[i] * re[i] + im[i] * im[i];
    }
    windowCount++;
  }

  if (windowCount === 0) {
    return { powerSpectrum: new Float64Array(numBins).fill(-200), binSize };
  }

  const powerSpectrum = new Float64Array(numBins);
  // Hann window coherent gain is 0.5, so power correction factor is 1/4.
  // Combined with single-sided spectrum (×2), the net normFactor is N²/8.
  const normFactor = windowCount * (FFT_SIZE * FFT_SIZE / 8);

  for (let i = 0; i < numBins; i++) {
    const power = accumulated[i] / normFactor;
    powerSpectrum[i] = power > 1e-20 ? 10 * Math.log10(power) : -200;
  }

  return { powerSpectrum, binSize };
}

/**
 * Find the highest frequency where musical content is present.
 * Uses a smoothed threshold relative to the in-band peak.
 */
export function findSpectralCutoff(powerSpectrum, binSize, sampleRate) {
  const numBins = powerSpectrum.length;

  // Find peak power in 200Hz–20kHz (musical content band)
  const loMusicBin = Math.max(1, Math.floor(200 / binSize));
  const hiMusicBin = Math.min(Math.floor(20000 / binSize), numBins - 1);
  let peakPower = -200;
  for (let i = loMusicBin; i <= hiMusicBin; i++) {
    if (powerSpectrum[i] > peakPower) peakPower = powerSpectrum[i];
  }

  // Cutoff threshold: 65dB below the in-band peak.
  // Floor at -120 so we don't falsely reject gradual high-freq rolloff (e.g. pink noise / real music).
  const threshold = Math.max(peakPower - 65, -120);

  // Walk from Nyquist downward; find first bin (smoothed over ±5 bins) above threshold
  const smoothSpan = 5;
  for (let i = numBins - 1; i >= loMusicBin; i--) {
    let avg = 0, count = 0;
    for (let j = Math.max(0, i - smoothSpan); j <= Math.min(numBins - 1, i + smoothSpan); j++) {
      avg += powerSpectrum[j];
      count++;
    }
    avg /= count;
    if (avg > threshold) {
      return i * binSize;
    }
  }

  return loMusicBin * binSize;
}

/**
 * Estimate the noise floor by measuring average power in the upper-frequency band.
 * For genuine hi-res this band has natural room/instrument noise at very low levels.
 * For 16→24-bit upscaled files the noise floor here reveals the true bit depth (~−96 dBFS).
 */
export function estimateNoiseFloor(powerSpectrum, binSize, sampleRate) {
  const nyquist = sampleRate / 2;

  // Measure the top 70–92% of the Nyquist range (avoids the very edge)
  const measureStart = nyquist * 0.70;
  const measureEnd = nyquist * 0.92;

  const startBin = Math.floor(measureStart / binSize);
  const endBin = Math.min(Math.floor(measureEnd / binSize), powerSpectrum.length - 1);

  if (startBin >= endBin) return -90;

  let powerSum = 0;
  for (let i = startBin; i <= endBin; i++) {
    powerSum += Math.pow(10, powerSpectrum[i] / 10);
  }

  const avgPower = powerSum / (endBin - startBin + 1);
  return 10 * Math.log10(Math.max(avgPower, 1e-20));
}
