#!/usr/bin/env node
/**
 * Windows-compatible cleanup helper used by package "clean" scripts.
 *
 * Usage: node scripts/clean.mjs <path> [<path> ...]
 * Removes each target recursively and ignores missing paths.
 * Cross-platform replacement for `rm -rf` / `rimraf`.
 */
import { rmSync } from 'node:fs';
import path from 'node:path';
import process from 'node:process';

const targets = process.argv.slice(2);

if (targets.length === 0) {
  console.error('usage: node clean.mjs <path> [<path> ...]');
  process.exit(1);
}

for (const target of targets) {
  const resolved = path.resolve(process.cwd(), target);
  try {
    rmSync(resolved, { recursive: true, force: true });
    console.log(`removed ${resolved}`);
  } catch (error) {
    console.error(`failed to remove ${resolved}:`, error instanceof Error ? error.message : error);
    process.exitCode = 1;
  }
}
