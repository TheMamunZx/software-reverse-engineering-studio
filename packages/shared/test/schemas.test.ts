import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createAjv } from '../src/utils.js';

const schemasDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../src/schemas');

interface SchemaFile {
  relative: string;
  schema: Record<string, unknown>;
}

function collectSchemaFiles(dir: string, prefix = ''): SchemaFile[] {
  const entries = readdirSync(dir, { withFileTypes: true });
  const files: SchemaFile[] = [];
  for (const entry of entries) {
    if (entry.isDirectory()) {
      files.push(...collectSchemaFiles(path.join(dir, entry.name), path.join(prefix, entry.name)));
      continue;
    }
    if (entry.isFile() && entry.name.endsWith('.json')) {
      const relative = path.join(prefix, entry.name);
      const parsed = JSON.parse(readFileSync(path.join(dir, entry.name), 'utf-8')) as Record<string, unknown>;
      files.push({ relative, schema: parsed });
    }
  }
  return files;
}

const schemaFiles = collectSchemaFiles(schemasDir);

describe('versioned JSON Schema registry', () => {
  it('contains schemas for the four data models and the sixteen MCP tools', () => {
    expect(schemaFiles.length).toBe(20);
  });

  it('declares JSON Schema draft 2020-12, a unique $id and an explicit version in every schema', () => {
    const ids = new Set<string>();
    for (const { relative, schema } of schemaFiles) {
      expect(schema.$schema, relative).toBe('https://json-schema.org/draft/2020-12/schema');
      expect(typeof schema.$id, relative).toBe('string');
      expect((schema.$id as string).length, relative).toBeGreaterThan(0);
      expect(typeof schema.version, relative).toBe('string');
      expect(schema.version as string, relative).toMatch(/^\d+\.\d+\.\d+$/);
      expect(ids.has(schema.$id as string), `duplicate $id in ${relative}`).toBe(false);
      ids.add(schema.$id as string);
    }
  });

  it('compiles every schema with the central draft 2020-12 factory', () => {
    const ajv = createAjv();
    for (const { relative, schema } of schemaFiles) {
      expect(() => ajv.compile(schema), `compile failed: ${relative}`).not.toThrow();
    }
  });

  it('exposes per-package data model schemas', () => {
    const names = schemaFiles.filter(f => !f.relative.startsWith('mcp-tools')).map(f => f.relative);
    expect(names.sort()).toEqual(['evidence.json', 'investigation.json', 'provider.json', 'target.json']);
  });

  it('exposes paired input/result schemas for each MCP tool', () => {
    const toolSchemas = schemaFiles.filter(f => f.relative.startsWith('mcp-tools'));
    const baseNames = new Set(toolSchemas.map(f => path.basename(f.relative, '.json')));
    for (const tool of ['investigation.start', 'investigation.status', 'investigation.close', 'target.register', 'target.list', 'analysis.run', 'analysis.capabilities', 'evidence.query']) {
      expect(baseNames.has(tool), `missing input schema for ${tool}`).toBe(true);
      expect(baseNames.has(`${tool}.result`), `missing result schema for ${tool}`).toBe(true);
    }
    expect(toolSchemas.length).toBe(16);
  });
});
