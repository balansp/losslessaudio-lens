import fs from 'fs';

const HEADERS = [
  'movie',
  'song_analyzed',
  'verdict',
  'reason',
  'codec',
  'sample_rate_hz',
  'bit_depth',
  'duration_sec',
  'spectral_cutoff_khz',
  'noise_floor_db',
  'total_tracks',
];

function escapeCsv(value) {
  if (value === undefined || value === null) return '';
  const str = String(value);
  if (str.includes(',') || str.includes('"') || str.includes('\n') || str.includes('\r')) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

function rowFor(r) {
  return [
    r.movie,
    r.file,
    r.verdict ?? '',
    r.reason ?? '',
    r.codec ?? '',
    r.sampleRate ?? '',
    r.bitDepth ?? '',
    r.durationSec ?? '',
    r.spectralCutoffKhz ?? '',
    r.noiseFloorDb ?? '',
    r.totalTracks ?? '',
  ].map(escapeCsv).join(',');
}

export function writeCSV(results, outputPath) {
  const lines = [HEADERS.join(','), ...results.map(rowFor)];
  fs.writeFileSync(outputPath, lines.join('\n') + '\n', 'utf8');
}
