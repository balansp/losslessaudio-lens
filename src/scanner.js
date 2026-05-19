import fs from 'fs';
import path from 'path';

const AUDIO_EXTENSIONS = new Set([
  '.flac', '.wav', '.m4a', '.mp3', '.aac',
  '.ogg', '.wma', '.aiff', '.aif', '.ape',
  '.dsf', '.dff', '.opus', '.wv',
]);

function isAudioFile(name) {
  return AUDIO_EXTENSIONS.has(path.extname(name).toLowerCase());
}

function getSubdirs(dir) {
  return fs.readdirSync(dir, { withFileTypes: true })
    .filter(e => e.isDirectory() && !e.name.startsWith('.'))
    .map(e => path.join(dir, e.name));
}

function getDirectAudioFiles(dir) {
  return fs.readdirSync(dir)
    .filter(f => isAudioFile(f))
    .map(f => {
      const filePath = path.join(dir, f);
      return { name: f, path: filePath, size: fs.statSync(filePath).size };
    });
}

function collectAudioRecursive(dir) {
  const files = getDirectAudioFiles(dir);
  for (const subdir of getSubdirs(dir)) {
    files.push(...collectAudioRecursive(subdir));
  }
  return files;
}

function hasAudioInSubtree(dir) {
  if (getDirectAudioFiles(dir).length > 0) return true;
  return getSubdirs(dir).some(subdir => hasAudioInSubtree(subdir));
}

function albumDisplayName(songsDir, albumDir) {
  const relative = path.relative(songsDir, albumDir);
  if (!relative || relative === '.') return path.basename(songsDir);
  return relative;
}

/** True when folder name looks like a CD/disc (multi-disc album layout). */
function isDiscFolder(dirPath) {
  const name = path.basename(dirPath);
  return /^(cd|disc)\b/i.test(name) || /^disc\.?\s*[\dIVX]+/i.test(name);
}

function findAlbumRoots(dir, songsDir) {
  const directAudio = getDirectAudioFiles(dir);
  const audioChildren = getSubdirs(dir).filter(subdir => hasAudioInSubtree(subdir));

  if (directAudio.length > 0) {
    const audioFiles = collectAudioRecursive(dir)
      .sort((a, b) => a.path.localeCompare(b.path));
    return [{
      name: albumDisplayName(songsDir, dir),
      sampleFile: null,
      totalTracks: audioFiles.length,
      _audioFiles: audioFiles,
    }];
  }

  if (audioChildren.length === 0) return [];

  if (audioChildren.length > 1 && audioChildren.every(isDiscFolder)) {
    const audioFiles = collectAudioRecursive(dir)
      .sort((a, b) => a.path.localeCompare(b.path));
    return [{
      name: albumDisplayName(songsDir, dir),
      sampleFile: null,
      totalTracks: audioFiles.length,
      _audioFiles: audioFiles,
    }];
  }

  return audioChildren.flatMap(child => findAlbumRoots(child, songsDir));
}

function pickSampleFile(audioFiles) {
  return [...audioFiles].sort((a, b) => b.size - a.size)[0];
}

export async function scanFolders(songsDir, { allTracks = false } = {}) {
  if (!fs.existsSync(songsDir)) {
    throw new Error(`Directory not found: ${songsDir}`);
  }

  const albums = findAlbumRoots(songsDir, songsDir);
  const movies = [];

  for (const album of albums) {
    const audioFiles = album._audioFiles;
    delete album._audioFiles;

    if (allTracks) {
      for (const f of audioFiles) {
        movies.push({
          name: album.name,
          sampleFile: f.path,
          totalTracks: album.totalTracks,
        });
      }
    } else {
      const sampleFile = pickSampleFile(audioFiles);
      movies.push({
        name: album.name,
        sampleFile: sampleFile.path,
        totalTracks: album.totalTracks,
      });
    }
  }

  return movies.sort((a, b) => a.name.localeCompare(b.name) || a.sampleFile.localeCompare(b.sampleFile));
}
