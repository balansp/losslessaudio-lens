import fs from 'fs';
import path from 'path';

const AUDIO_EXTENSIONS = new Set([
  '.flac', '.wav', '.m4a', '.mp3', '.aac',
  '.ogg', '.wma', '.aiff', '.aif', '.ape',
  '.dsf', '.dff', '.opus', '.wv',
]);

function getAudioFiles(dir) {
  return fs.readdirSync(dir)
    .filter(f => AUDIO_EXTENSIONS.has(path.extname(f).toLowerCase()))
    .map(f => {
      const filePath = path.join(dir, f);
      return { name: f, path: filePath, size: fs.statSync(filePath).size };
    });
}

export async function scanFolders(songsDir, { allTracks = false } = {}) {
  if (!fs.existsSync(songsDir)) {
    throw new Error(`Directory not found: ${songsDir}`);
  }

  const entries = fs.readdirSync(songsDir, { withFileTypes: true });
  const movies = [];

  for (const entry of entries) {
    if (!entry.isDirectory()) continue;

    const movieDir = path.join(songsDir, entry.name);
    const audioFiles = getAudioFiles(movieDir).sort((a, b) => a.name.localeCompare(b.name));

    if (audioFiles.length === 0) continue;

    if (allTracks) {
      for (const f of audioFiles) {
        movies.push({ name: entry.name, sampleFile: f.path, totalTracks: audioFiles.length });
      }
    } else {
      // Pick the largest file — more audio data = better FFT accuracy
      const sampleFile = [...audioFiles].sort((a, b) => b.size - a.size)[0];
      movies.push({ name: entry.name, sampleFile: sampleFile.path, totalTracks: audioFiles.length });
    }
  }

  return movies.sort((a, b) => a.name.localeCompare(b.name) || a.sampleFile.localeCompare(b.sampleFile));
}
