#!/usr/bin/env node
import { Command } from 'commander';
import path from 'path';
import { scanFolders } from './src/scanner.js';
import { analyzeFile } from './src/analyzer.js';
import { writeCSV } from './src/reporter.js';

const program = new Command();

program
  .name('losslessaudio-lens')
  .description('Detect genuine vs fake hi-res lossless audio files')
  .argument('<songsDir>', 'Path to root folder (albums may be nested in subfolders)')
  .option('-o, --output <file>', 'Output CSV file path', 'report.csv')
  .action(async (songsDir, options) => {
    const absDir = path.resolve(songsDir);
    console.log(`Scanning: ${absDir}\n`);

    let movies;
    try {
      movies = await scanFolders(absDir);
    } catch (err) {
      console.error(`Error scanning directory: ${err.message}`);
      process.exit(1);
    }

    if (movies.length === 0) {
      console.log('No album folders with audio files found.');
      process.exit(0);
    }

    console.log(`Found ${movies.length} album folder(s). Analysing one sample per folder...\n`);

    const results = [];
    for (const movie of movies) {
      process.stdout.write(
        `  [${results.length + 1}/${movies.length}] ${movie.name} → ${path.basename(movie.sampleFile)} ... `,
      );

      try {
        const analysis = await analyzeFile(movie.sampleFile);
        results.push({
          movie: movie.name,
          file: path.basename(movie.sampleFile),
          totalTracks: movie.totalTracks,
          ...analysis,
        });
        const verdictLabel = {
          GENUINE: '\x1b[32mGENUINE\x1b[0m',
          LIKELY_UPSCALED: '\x1b[33mLIKELY_UPSCALED\x1b[0m',
          FAKE_TRANSCODED: '\x1b[31mFAKE_TRANSCODED\x1b[0m',
          LIKELY_FAKE: '\x1b[31mLIKELY_FAKE\x1b[0m',
          LOSSY: '\x1b[31mLOSSY\x1b[0m',
        }[analysis.verdict] ?? analysis.verdict;
        console.log(verdictLabel);
      } catch (err) {
        console.log('\x1b[31mERROR\x1b[0m');
        console.error(`    ${err.message}`);
        results.push({
          movie: movie.name,
          file: path.basename(movie.sampleFile),
          totalTracks: movie.totalTracks,
          verdict: 'ERROR',
          reason: err.message,
        });
      }
    }

    writeCSV(results, options.output);

    const outputPath = path.resolve(options.output);
    console.log(`\nReport saved → ${outputPath}`);

    const summary = results.reduce((acc, r) => {
      acc[r.verdict] = (acc[r.verdict] || 0) + 1;
      return acc;
    }, {});
    console.log('\nSummary:');
    for (const [verdict, count] of Object.entries(summary)) {
      console.log(`  ${verdict}: ${count}`);
    }
  });

program.parse();
