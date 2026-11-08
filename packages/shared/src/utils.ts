import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { type ValidateFunction } from 'ajv/dist/2020.js';
import Ajv2020Module from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';
import { ValidationError } from './errors.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export type { ValidateFunction } from 'ajv/dist/2020.js';

/**
 * Structural type for the Ajv draft 2020-12 instances created by this module.
 *
 * Kept structural (instead of importing the package class) because ajv ships
 * ESM-shaped CJS typings whose default import resolves to the module
 * namespace under NodeNext.
 */
export interface AjvLike {
  compile(schema: object): ValidateFunction;
  errorsText(errors?: unknown): string;
  addKeyword(keyword: string): AjvLike;
}

/**
 * Creates a shared Ajv (JSON Schema draft 2020-12) validator instance.
 *
 * All SRE Studio schemas declare `"$schema": "https://json-schema.org/draft/2020-12/schema"`,
 * which the default Ajv class (draft-07) cannot compile, so the draft 2020-12
 * class is used everywhere.
 *
 * The versioned schema infrastructure adds a custom root `version` field to
 * every schema; it is registered as an annotation keyword so strict mode
 * accepts it without validating it.
 */
export function createAjv(options?: { allErrors?: boolean }): AjvLike {
  // ajv ships an ESM-shaped CJS build; the constructible class is reachable
  // through the runtime default (the compiled CJS assigns both
  // `module.exports = Ajv2020` and `exports.default = Ajv2020`).
  const Ajv2020: any = (Ajv2020Module as any).default ?? Ajv2020Module;
  const ajv = new Ajv2020({ strict: true, allErrors: options?.allErrors ?? true });
  (addFormats as any)(ajv);
  ajv.addKeyword('version');
  return ajv as AjvLike;
}

export interface SchemaValidator<T = unknown> {
  validate(data: unknown): T;
  validateOrThrow(data: unknown): T;
}

export function createValidator<T>(schema: object): SchemaValidator<T> {
  const ajv = createAjv();

  const validate: ValidateFunction = ajv.compile(schema);

  return {
    validate(data: unknown): T {
      const valid = validate(data);
      if (!valid) {
        throw new ValidationError('Validation failed', undefined, { errors: ajv.errorsText(validate.errors) });
      }
      return data as T;
    },
    validateOrThrow(data: unknown): T {
      return this.validate(data);
    }
  };
}

export async function loadSchema(schemaPath: string): Promise<object> {
  return JSON.parse(await fs.readFile(schemaPath, 'utf-8'));
}

export function getSchemasDir(): string {
  return path.join(__dirname, 'schemas');
}

export function getMcpToolSchemasDir(): string {
  return path.join(__dirname, 'schemas', 'mcp-tools');
}
