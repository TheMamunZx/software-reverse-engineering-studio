/**
 * Copies the versioned JSON Schemas from src/schemas into dist/schemas.
 *
 * The compiled validators resolve schemas relative to the build output
 * (dist/index.js), so every build or rebuild must ship the schema files
 * alongside the JavaScript. Replaces the previous cp/xcopy shell mix,
 * which was not reliably Windows-compatible.
 *
 * Usage: node ./scripts/copy-schemas.mjs
 */
import { cp, mkdtemp, rm, readFile, access } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { constants } from 'node:fs';
import { tmpdir } from 'node:os';

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const source = path.join(packageRoot, 'src', 'schemas');
const target = path.join(packageRoot, 'dist', 'schemas');

async function assertSourceExists() {
  try {
    await access(source, constants.F_OK);
  } catch {
    throw new Error(`schemas source directory not found: ${source}. Run this from @sre-studio/shared.`);
  }
}

/** Sanity check: every schema file must carry an explicit version for the versioned pipeline. */
async function assertVersions() {
  const { readdir } = await import('node:fs/promises');
  const files = (await readdir(source, { recursive: true, encoding: 'utf-8' })).filter(f => f.endsWith('.json'));
  for (const file of files) {
    const full = path.join(source, file);
    const schema = JSON.parse(await readFile(full, 'utf-8'));
    if (typeof schema.version !== 'string' || schema.version.length === 0) {
      throw new Error(`schema missing explicit version: ${file}`);
    }
    if (typeof schema.$id !== 'string' || schema.$id.length === 0) {
      throw new Error(`schema missing $id: ${file}`);
    }
  }
  return files.length;
}

await assertSourceExists();
const count = await assertVersions();

// Stale artifacts (e.g. removed schema files) would keep being validated,
// so rebuild the folder from scratch inside a temp dir then swap.
const staged = await mkdtemp(path.join(tmpdir(), 'sre-schemas-'));
await cp(source, path.join(staged, 'schemas'), { recursive: true });
await rm(target, { recursive: true, force: true });
await cp(path.join(staged, 'schemas'), target, { recursive: true });
await rm(staged, { recursive: true, force: true });

console.log(`copied ${count} schema files to ${target}`);
