import { parseFile } from 'music-metadata';
import { execFileSync } from 'child_process';
import { computeSpectrum, findSpectralCutoff, estimateNoiseFloor } from './spectrum.js';

// Codecs that are inherently lossy — their presence means the file is not lossless
const LOSSY_CODECS = new Set(['MP3', 'MP2', 'MP1', 'AAC', 'OGG', 'OPUS', 'VORBIS', 'WMA', 'AC3', 'EAC3']);

export async function analyzeFile(filePath) {
  const metadata = await parseFile(filePath, { duration: true });
  const fmt = metadata.format;

  const sampleRate = fmt.sampleRate || 44100;
  const bitsPerSample = fmt.bitsPerSample || 16;
  const duration = fmt.duration || 0;
  const codec = (fmt.codec || 'unknown').toUpperCase().replace(/\s+/g, '_');

  // Extract 60s from 20% into the file (skip intros/silences)
  const startTime = duration > 90 ? Math.floor(duration * 0.2) : Math.min(10, duration * 0.1);
  const extractDuration = Math.min(60, Math.max(5, duration - startTime - 2));

  const pcmBuffer = extractPCM(filePath, startTime, extractDuration, sampleRate);

  // Buffer is raw f32le: 4 bytes per sample, mono
  const samples = new Float32Array(
    pcmBuffer.buffer,
    pcmBuffer.byteOffset,
    Math.floor(pcmBuffer.byteLength / 4),
  );

  const { powerSpectrum, binSize } = computeSpectrum(samples, sampleRate);
  const cutoffHz = findSpectralCutoff(powerSpectrum, binSize, sampleRate);
  const noiseFloorDb = estimateNoiseFloor(powerSpectrum, binSize, sampleRate);

  const { verdict, reason } = determineVerdict({
    sampleRate,
    bitsPerSample,
    codec,
    cutoffHz,
    noiseFloorDb,
  });

  return {
    sampleRate,
    bitDepth: bitsPerSample,
    codec,
    durationSec: Math.round(duration),
    spectralCutoffKhz: (cutoffHz / 1000).toFixed(2),
    noiseFloorDb: noiseFloorDb.toFixed(1),
    verdict,
    reason,
  };
}

function extractPCM(filePath, startTime, duration, sampleRate) {
  const args = [
    '-hide_banner', '-loglevel', 'error',
    '-ss', String(startTime),
    '-t', String(duration),
    '-i', filePath,
    '-ac', '1',                  // mono
    '-ar', String(sampleRate),   // keep native sample rate
    '-f', 'f32le',
    '-acodec', 'pcm_f32le',
    'pipe:1',
  ];

  return execFileSync('ffmpeg', args, {
    maxBuffer: 300 * 1024 * 1024, // 300 MB — covers ~60s at 192kHz/32-bit
  });
}

function determineVerdict({ sampleRate, bitsPerSample, codec, cutoffHz, noiseFloorDb }) {
  const cutoffKhz = cutoffHz / 1000;
  const nyquistKhz = sampleRate / 2000;
  const isHiResClaimed = sampleRate > 48000 || bitsPerSample > 16;

  // 1. Container codec is inherently lossy
  if (LOSSY_CODECS.has(codec)) {
    return {
      verdict: 'LOSSY',
      reason: `Container codec is lossy (${codec}) — not a lossless file`,
    };
  }

  // 2. Brick-wall cutoff below 18kHz → classic MP3/AAC transcode
  if (cutoffKhz < 18) {
    return {
      verdict: 'FAKE_TRANSCODED',
      reason: `Spectral cutoff at ${cutoffKhz.toFixed(1)} kHz — typical of low-bitrate MP3/AAC source`,
    };
  }

  // 3. Cutoff 18–21.5kHz — high-bitrate lossy source possible
  if (cutoffKhz < 21.5) {
    return {
      verdict: 'LIKELY_FAKE',
      reason: `Spectral cutoff at ${cutoffKhz.toFixed(1)} kHz — consistent with high-bitrate MP3/AAC (320 kbps) source`,
    };
  }

  // 4. Claims hi-res sample rate but spectral content doesn't reach near Nyquist.
  //    A quality SRC upsampler applies a steep anti-imaging filter above the original Nyquist,
  //    so a 44.1→96kHz upscale has content only to ~22kHz, not to 48kHz.
  if (sampleRate > 48000 && cutoffKhz < nyquistKhz * 0.55) {
    return {
      verdict: 'LIKELY_UPSCALED',
      reason: `${(sampleRate / 1000).toFixed(0)} kHz claimed but spectral content only reaches ${cutoffKhz.toFixed(1)} kHz (Nyquist: ${nyquistKhz.toFixed(0)} kHz)`,
    };
  }

  // 5. Passes all checks
  return {
    verdict: 'GENUINE',
    reason: `Spectral content to ${cutoffKhz.toFixed(1)} kHz; noise floor ${noiseFloorDb.toFixed(0)} dBFS — consistent with ${(sampleRate / 1000).toFixed(1)} kHz/${bitsPerSample}-bit source`,
  };
}
