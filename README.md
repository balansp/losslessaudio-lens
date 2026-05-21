# Lossless Audio Lens 🎵🔍

A command-line tool that analyses your hi-res audio library and tells you whether each file is a **genuine lossless** recording or a **fake / transcoded** one masquerading as hi-res.

---

## How It Works

Lossless Audio Lens extracts **2–3 short PCM windows** from different points in each track (via ffmpeg), runs **FFT spectral analysis** on each, and combines:

- **Median spectral cutoff** — highest frequency with meaningful musical energy
- **Brick-wall detection** — sharp dB drop typical of MP3/AAC encoders (not gradual mastering rolloff)
- **Segment agreement** — inconsistent cutoffs across the track lower confidence

Verdicts use cutoff **and** wall shape, which reduces false "fake" labels on genuinely rolled-off CD masters.

| Verdict | Meaning |
|---|---|
| `GENUINE` | Spectral content reaches near the Nyquist frequency — consistent with a true lossless source |
| `LIKELY_UPSCALED` | Hi-res sample rate claimed but content only reaches ~22 kHz — looks like an SRC upscale from CD quality |
| `LIKELY_FAKE` | Brick-wall cutoff at 18–21.5 kHz — consistent with a high-bitrate MP3/AAC (320 kbps) source |
| `FAKE_TRANSCODED` | Cutoff below 18 kHz — typical of a low-bitrate MP3/AAC transcode |
| `LOSSY` | Container codec is inherently lossy (MP3, AAC, OGG, etc.) |

---

## Prerequisites

| Requirement | Version |
|---|---|
| [Node.js](https://nodejs.org/) | ≥ 18 |
| [ffmpeg](https://ffmpeg.org/) | any recent version, must be in `PATH` |

### Install ffmpeg

```bash
# macOS
brew install ffmpeg

# Ubuntu / Debian
sudo apt install ffmpeg

# Windows (via Chocolatey)
choco install ffmpeg
```

---

## Installation

### Option 1 — Global npm install (recommended)

```bash
npm install -g lossless-audio-lens
```

After installation the `losslessaudio-lens` command is available globally.

### Option 2 — Run from source

```bash
git clone https://github.com/balansp/losslessaudio-lens
cd lossless-audio-lens
npm install
node index.js <songsDir>
```

---

## Usage

```
losslessaudio-lens <songsDir> [options]
```

### Arguments

| Argument | Description |
|---|---|
| `<songsDir>` | Path to your library root. Album folders are discovered at any depth (see folder structure below) |

### Options

| Flag | Default | Description |
|---|---|---|
| `-o, --output <file>` | `report.csv` | Path for the output CSV report |
| `-a, --all` | off | Analyze and report **every** audio file in each folder (one CSV row per file) |
| `-h, --help` | | Show help |

### Example

```bash
# Scan ~/Music/Movies and save report to ~/Desktop/report.csv
losslessaudio-lens ~/Music/Movies -o ~/Desktop/report.csv

# Analyze every track (not just one sample per album)
losslessaudio-lens ~/Music/Movies --all -o ~/Desktop/report-all.csv
```

### Expected folder structure

Albums can sit directly under the root, inside nested categories, or split across disc subfolders:

```
Songs/
├── Interstellar/
│   ├── 01 - Main Theme.flac
│   └── 02 - Docking.flac
├── Sci-Fi/
│   └── Dune/
│       └── 01 - Arrakis.flac
└── Inception/
    ├── Disc 1/
    │   └── 01 - Opening.flac
    └── Disc 2/
        └── 05 - Ending.flac
```

The scanner walks the tree recursively:

- **Top-level siblings** with audio (e.g. `Interstellar`, `Dune`) are separate albums.
- **Single wrapper folders** (e.g. `Sci-Fi/Dune`) are descended into until tracks are found.
- **Category folders** (`90s/Baasha`, `ARR/Bombay`) — each child album is scanned separately.
- **Multi-disc layouts** (`Inception/Disc 1`, `Disc 2`) — folders named like `Disc 1` / `CD 2` are grouped as one album.

By default, one file per album folder is sampled and the verdict is applied to all tracks in that folder. Use `--all` to analyse and list every file individually in the console output and CSV report.

---

## Output

**Console** — colour-coded verdict per folder printed in real time:

```
Scanning: /Users/you/Music/Movies

Found 3 album folder(s). Analysing one sample per folder...

  [1/3] Interstellar → 01 - Main Theme.flac ... GENUINE
  [2/3] Dune         → 01 - Arrakis.flac    ... LIKELY_UPSCALED
  [3/3] Avatar       → 01 - Opening.flac    ... FAKE_TRANSCODED

Report saved → /Users/you/Desktop/report.csv

Summary:
  GENUINE: 1
  LIKELY_UPSCALED: 1
  FAKE_TRANSCODED: 1
```

**CSV report** — one row per folder with full details:

| Column | Description |
|---|---|
| `movie` | Folder (movie/album) name |
| `file` | Sampled file name |
| `totalTracks` | Total audio files in the folder |
| `sampleRate` | Sample rate in Hz |
| `bitDepth` | Bit depth |
| `codec` | Audio codec detected |
| `durationSec` | Track duration in seconds |
| `spectral_cutoff_khz` | Median detected frequency cutoff in kHz (across segments) |
| `brick_wall_db` | Sharpest high-frequency drop in dB (encoder wall strength) |
| `confidence` | `high` / `medium` / `low` — agreement between segments and wall clarity |
| `noise_floor_db` | Estimated noise floor in dBFS |
| `verdict` | Final verdict |
| `reason` | Human-readable explanation |

---

## Project Structure

```
lossless-audio-lens/
├── index.js          # CLI entry point (Commander)
├── src/
│   ├── scanner.js    # Walks the Songs directory tree
│   ├── analyzer.js   # Extracts PCM via ffmpeg, runs verdict logic
│   ├── spectrum.js   # FFT, spectral cutoff & noise floor helpers
│   └── reporter.js   # Writes the CSV report
├── package.json
└── README.md
```

---

## Limitations

- **One file sampled per folder (default)** — if the sampled file is atypical, the verdict may not represent all tracks. Use `--all` for per-file results.
- **Requires ffmpeg** — the tool shells out to `ffmpeg` for PCM extraction; it must be installed and available in `PATH`.
- **Heuristic analysis** — not bit-exact proof of source. Brick-wall + multi-segment logic improves accuracy but cannot catch every upscale or lossless re-encode. Check `confidence` in the CSV when borderline.
- **Slower per file** — up to 3 ffmpeg extractions per track for stability (use default single-album mode for large libraries).

---

## License

MIT
