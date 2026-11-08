import { SqliteAdapter } from '../sqlite-adapter.js';
import { initialSchema } from './001_initial_schema.js';
import { auditLogsSchema } from './002_audit_logs.js';

export interface Migration {
  version: number;
  description: string;
  sql: string;
}

const migrations: Migration[] = [
  {
    version: 1,
    description: 'Initial schema with sessions, targets, findings, environments',
    sql: initialSchema
  },
  {
    version: 2,
    description: 'Add audit_logs table for authorization decision tracking',
    sql: auditLogsSchema
  }
];

/**
 * Runs pending migrations against the SQLite adapter.
 *
 * better-sqlite3 is synchronous, so this function runs all DDL
 * synchronously and returns void. The Repository constructor calls it
 * directly (no await required).
 */
export function migrate(adapter: SqliteAdapter): void {
  // Ensure schema_version table exists
  adapter.exec(`
    CREATE TABLE IF NOT EXISTS schema_version (
      version INTEGER PRIMARY KEY,
      applied_at TEXT NOT NULL DEFAULT (datetime('now')),
      description TEXT
    );
  `);

  const currentVersion = getCurrentVersion(adapter);

  for (const migration of migrations) {
    if (migration.version > currentVersion) {
      adapter.transaction(() => {
        adapter.exec(migration.sql);
        setVersion(adapter, migration.version, migration.description);
      });
    }
  }
}

export { migrations };

function getCurrentVersion(adapter: SqliteAdapter): number {
  try {
    const row = adapter.prepare('SELECT MAX(version) as v FROM schema_version').get() as { v: number } | undefined;
    return row?.v ?? 0;
  } catch {
    return 0;
  }
}

function setVersion(adapter: SqliteAdapter, version: number, description: string): void {
  adapter.prepare('INSERT INTO schema_version (version, description) VALUES (?, ?)').run(version, description);
}
