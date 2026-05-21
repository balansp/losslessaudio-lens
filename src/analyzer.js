import { parseFile } from 'music-metadata';
import { execFileSync } from 'child_process';
import {
  computeSpectrum,
  findSpectralCutoff,
  estimateNoiseFloor,
  measureBrickWall,
} from './spectrum.js';

const LOSSY_CODECS = new Set(['MP3', 'MP2', 'MP1', 'AAC', 'OGG', 'OPUS', 'VORBIS', 'WMA', 'AC3', 'EAC3']);

const BRICK_WALL_STRONG_DB = 38;
const BRICK_WALL_MODERATE_DB = 28;
const SEGMENT_DURATION_SEC = 30;

export async function analyzeFile(filePath) {
  const metadata = await parseFile(filePath, { duration: true });
  const fmt = metadata.format;

  const sampleRate = fmt.sampleRate || 44100;
  const bitsPerSample = fmt.bitsPerSample || 16;
  const duration = fmt.duration || 0;
  const codec = (fmt.codec || 'unknown').toUpperCase().replace(/\s+/g, '_');

  const segments = buildAnalysisSegments(duration);
  const segmentResults = [];

  for (const { startTime, extractDuration } of segments) {
    const pcmBuffer = extractPCM(filePath, startTime, extractDuration, sampleRate);
    const samples = new Float32Array(
      pcmBuffer.buffer,
      pcmBuffer.byteOffset,
      Math.floor(pcmBuffer.byteLength / 4),
    );

    const { powerSpectrum, binSize } = computeSpectrum(samples, sampleRate);
    const cutoffHz = findSpectralCutoff(powerSpectrum, binSize, sampleRate);
    const { maxDropDb, wallHz } = measureBrickWall(powerSpectrum, binSize, sampleRate);
    const noiseFloorDb = estimateNoiseFloor(powerSpectrum, binSize, sampleRate);

    segmentResults.push({ cutoffHz, maxDropDb, wallHz, noiseFloorDb });
  }

  const cutoffHz = median(segmentResults.map(s => s.cutoffHz));
  const brickWallDb = Math.max(...segmentResults.map(s => s.maxDropDb));
  const wallHz = median(segmentResults.map(s => s.wallHz));
  const noiseFloorDb = median(segmentResults.map(s => s.noiseFloorDb));
  const cutoffSpreadKhz = spreadKhz(segmentResults.map(s => s.cutoffHz));

  const { verdict, reason, confidence } = determineVerdict({
    sampleRate,
    bitsPerSample,
    codec,
    cutoffHz,
    brickWallDb,
    wallHz,
    noiseFloorDb,
    cutoffSpreadKhz,
    segmentCount: segmentResults.length,
  });

  return {
    sampleRate,
    bitDepth: bitsPerSample,
    codec,
    durationSec: Math.round(duration),
    spectralCutoffKhz: (cutoffHz / 1000).toFixed(2),
    noiseFloorDb: noiseFloorDb.toFixed(1),
    brickWallDb: brickWallDb.toFixed(1),
    confidence,
    verdict,
    reason,
  };
}

/** Pick 1–3 windows across the track for more stable readings than a single slice. */
function buildAnalysisSegments(duration) {
  if (duration < 20) {
    const start = Math.min(2, Math.max(0, duration * 0.1));
    return [{ startTime: start, extractDuration: Math.max(5, duration - start - 0.5) }];
  }

  if (duration < 75) {
    const extractDuration = Math.min(SEGMENT_DURATION_SEC, Math.max(10, duration * 0.4));
    return [
      { startTime: duration * 0.2, extractDuration },
      { startTime: duration * 0.55, extractDuration },
    ];
  }

  const extractDuration = Math.min(SEGMENT_DURATION_SEC, duration * 0.35);
  return [
    { startTime: duration * 0.25, extractDuration },
    { startTime: duration * 0.5, extractDuration },
    { startTime: duration * 0.72, extractDuration },
  ];
}

function extractPCM(filePath, startTime, duration, sampleRate) {
  const args = [
    '-hide_banner', '-loglevel', 'error',
    '-ss', String(startTime),
    '-t', String(duration),
    '-i', filePath,
    '-ac', '1',
    '-ar', String(sampleRate),
    '-f', 'f32le',
    '-acodec', 'pcm_f32le',
    'pipe:1',
  ];

  return execFileSync('ffmpeg', args, {
    maxBuffer: 300 * 1024 * 1024,
  });
}

function median(values) {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? (sorted[mid - 1] + sorted[mid]) / 2
    : sorted[mid];
}

function spreadKhz(hzValues) {
  if (hzValues.length < 2) return 0;
  const khz = hzValues.map(h => h / 1000);
  return Math.max(...khz) - Math.min(...khz);
}

function determineVerdict({
  sampleRate,
  bitsPerSample,
  codec,
  cutoffHz,
  brickWallDb,
  wallHz,
  noiseFloorDb,
  cutoffSpreadKhz,
  segmentCount,
}) {
  const cutoffKhz = cutoffHz / 1000;
  const wallKhz = wallHz / 1000;
  const nyquistKhz = sampleRate / 2000;
  const strongWall = brickWallDb >= BRICK_WALL_STRONG_DB;
  const moderateWall = brickWallDb >= BRICK_WALL_MODERATE_DB;
  const gradualRolloff = !moderateWall;
  const segmentsAgree = cutoffSpreadKhz < 2.5;

  let confidence = 'high';
  if (!segmentsAgree) confidence = 'low';
  else if (gradualRolloff && cutoffKhz < 22) confidence = 'medium';

  if (LOSSY_CODECS.has(codec)) {
    return {
      verdict: 'LOSSY',
      confidence: 'high',
      reason: `Container codec is lossy (${codec}) — not a lossless file`,
    };
  }

  if (cutoffKhz < 18) {
    if (strongWall || moderateWall) {
      return {
        verdict: 'FAKE_TRANSCODED',
        confidence: segmentsAgree ? 'high' : 'medium',
        reason: `Sharp ${brickWallDb.toFixed(0)} dB wall near ${wallKhz.toFixed(1)} kHz; cutoff ${cutoffKhz.toFixed(1)} kHz (${segmentCount} segments) — low-bitrate MP3/AAC source`,
      };
    }
    return {
      verdict: 'FAKE_TRANSCODED',
      confidence: 'medium',
      reason: `Spectral cutoff at ${cutoffKhz.toFixed(1)} kHz — typical of low-bitrate lossy source`,
    };
  }

  if (cutoffKhz < 21.5) {
    if (strongWall) {
      return {
        verdict: 'LIKELY_FAKE',
        confidence: segmentsAgree ? 'high' : 'medium',
        reason: `Sharp ${brickWallDb.toFixed(0)} dB wall at ${wallKhz.toFixed(1)} kHz; cutoff ${cutoffKhz.toFixed(1)} kHz — high-bitrate MP3/AAC source`,
      };
    }
    if (moderateWall) {
      return {
        verdict: 'LIKELY_FAKE',
        confidence: 'medium',
        reason: `Spectral wall (${brickWallDb.toFixed(0)} dB) at ${cutoffKhz.toFixed(1)} kHz — likely lossy transcode`,
      };
    }
    if (sampleRate <= 48000 && bitsPerSample <= 16) {
      return {
        verdict: 'GENUINE',
        confidence: 'medium',
        reason: `Gentle high-frequency rolloff to ${cutoffKhz.toFixed(1)} kHz (no encoder brick wall) — likely CD-quality mastering`,
      };
    }
  }

  if (sampleRate > 48000 && cutoffKhz < nyquistKhz * 0.55) {
    const cdBand = cutoffKhz >= 19.5 && cutoffKhz <= 22.5;
    if (cdBand && (strongWall || moderateWall)) {
      return {
        verdict: 'LIKELY_UPSCALED',
        confidence: segmentsAgree ? 'high' : 'medium',
        reason: `${(sampleRate / 1000).toFixed(0)} kHz claimed; wall at ${wallKhz.toFixed(1)} kHz with content to ${cutoffKhz.toFixed(1)} kHz — CD source upsampled`,
      };
    }
    if (cdBand && gradualRolloff) {
      return {
        verdict: 'LIKELY_UPSCALED',
        confidence: 'medium',
        reason: `${(sampleRate / 1000).toFixed(0)} kHz claimed but content only to ${cutoffKhz.toFixed(1)} kHz — possible SRC upscale from ~44.1 kHz`,
      };
    }
    if (!gradualRolloff) {
      return {
        verdict: 'LIKELY_UPSCALED',
        confidence: 'medium',
        reason: `${(sampleRate / 1000).toFixed(0)} kHz claimed; spectral content to ${cutoffKhz.toFixed(1)} kHz (Nyquist ${nyquistKhz.toFixed(0)} kHz)`,
      };
    }
  }

  if (bitsPerSample >= 24 && sampleRate >= 96000 && cutoffKhz < 40 && noiseFloorDb > -75) {
    return {
      verdict: 'LIKELY_UPSCALED',
      confidence: 'low',
      reason: `Hi-res ${bitsPerSample}-bit/${(sampleRate / 1000).toFixed(0)} kHz but limited bandwidth to ${cutoffKhz.toFixed(1)} kHz and elevated HF noise (${noiseFloorDb.toFixed(0)} dBFS)`,
    };
  }

  return {
    verdict: 'GENUINE',
    confidence: segmentsAgree ? 'high' : 'medium',
    reason: `Spectral content to ${cutoffKhz.toFixed(1)} kHz; ${brickWallDb.toFixed(0)} dB max wall; noise ${noiseFloorDb.toFixed(0)} dBFS — consistent with ${(sampleRate / 1000).toFixed(1)} kHz/${bitsPerSample}-bit source`,
  };
}
