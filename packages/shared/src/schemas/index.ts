import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Schema path exports for MCP tools and data models
// These JSON files are loaded at runtime by the validation system

export const schemaPaths = {
  mcpTools: {
    'investigation.start': './schemas/mcp-tools/investigation.start.json',
    'investigation.start.result': './schemas/mcp-tools/investigation.start.result.json',
    'investigation.status': './schemas/mcp-tools/investigation.status.json',
    'investigation.status.result': './schemas/mcp-tools/investigation.status.result.json',
    'investigation.close': './schemas/mcp-tools/investigation.close.json',
    'investigation.close.result': './schemas/mcp-tools/investigation.close.result.json',
    'target.register': './schemas/mcp-tools/target.register.json',
    'target.register.result': './schemas/mcp-tools/target.register.result.json',
    'target.list': './schemas/mcp-tools/target.list.json',
    'target.list.result': './schemas/mcp-tools/target.list.result.json',
    'analysis.run': './schemas/mcp-tools/analysis.run.json',
    'analysis.run.result': './schemas/mcp-tools/analysis.run.result.json',
    'analysis.capabilities': './schemas/mcp-tools/analysis.capabilities.json',
    'analysis.capabilities.result': './schemas/mcp-tools/analysis.capabilities.result.json',
    'evidence.query': './schemas/mcp-tools/evidence.query.json',
    'evidence.query.result': './schemas/mcp-tools/evidence.query.result.json'
  },
  dataModels: {
    investigation: './schemas/investigation.json',
    target: './schemas/target.json',
    evidence: './schemas/evidence.json',
    provider: './schemas/provider.json'
  }
};

export function getSchemaPath(category: 'mcpTools' | 'dataModels', name: string): string {
  const map = schemaPaths[category];
  if (!map || !(name in map)) {
    throw new Error(`Schema not found: ${category}.${name}`);
  }
  return map[name as keyof typeof map];
}

export async function loadSchemaFile(category: 'mcpTools' | 'dataModels', name: string): Promise<any> {
  const relative = getSchemaPath(category, name);
  // The relative schema paths are anchored at the package root of the module:
  // - source layout: src/schemas/index.ts  -> anchors at src/
  // - dist   layout: dist/index.js         -> anchors at dist/
  // Node's fetch cannot read file:// URLs, so plain filesystem access is used.
  const moduleDir = path.dirname(fileURLToPath(import.meta.url));
  const baseDir = path.basename(moduleDir) === 'schemas' ? path.dirname(moduleDir) : moduleDir;
  const absolute = path.resolve(baseDir, relative);
  return JSON.parse(await fs.readFile(absolute, 'utf-8'));
}