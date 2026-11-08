import type { ValidateFunction } from 'ajv/dist/2020.js';
import { loadSchema, getMcpToolSchemasDir, createAjv } from '@sre-studio/shared';
import { promises as fs } from 'node:fs';
import path from 'node:path';

// Central Ajv factory from @sre-studio/shared: JSON Schema draft 2020-12,
// strict mode, formats, and the `version` annotation keyword.
const ajv = createAjv();

const validators = new Map<string, ValidateFunction>();

export async function loadValidators(): Promise<void> {
  const schemasDir = getMcpToolSchemasDir();
  const files = await fs.readdir(schemasDir);

  for (const file of files) {
    if (file.endsWith('.json')) {
      const schemaPath = path.join(schemasDir, file);
      const schema = await loadSchema(schemaPath);
      const validate = ajv.compile(schema);
      validators.set(file.replace('.json', ''), validate);
    }
  }
}

export function getValidator(name: string): ValidateFunction | undefined {
  return validators.get(name);
}

export function validateInput(toolName: string, data: unknown): void {
  const validator = validators.get(toolName);
  if (!validator) {
    throw new Error(`No validator found for tool: ${toolName}`);
  }
  const valid = validator(data);
  if (!valid) {
    throw new Error(`Validation failed for ${toolName}: ${ajv.errorsText(validator.errors)}`);
  }
}

export function validateOutput(toolName: string, data: unknown): void {
  const validator = validators.get(`${toolName}.result`);
  if (!validator) {
    throw new Error(`No result validator found for tool: ${toolName}`);
  }
  const valid = validator(data);
  if (!valid) {
    throw new Error(`Output validation failed for ${toolName}: ${ajv.errorsText(validator.errors)}`);
  }
}

export { ajv };
