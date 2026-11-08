import Database from 'better-sqlite3';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createLogger } from '@sre-studio/shared';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const logger = createLogger('sqlite-adapter');

export interface DatabaseConfig {
  path: string;
  readonly?: boolean;
  walMode?: boolean;
}

export class SqliteAdapter {
  private db: Database.Database;
  private config: DatabaseConfig;

  constructor(config: DatabaseConfig) {
    this.config = config;
    this.db = new Database(config.path, { readonly: config.readonly ?? false });

    if (config.walMode !== false) {
      this.db.pragma('journal_mode = WAL');
    }
    this.db.pragma('foreign_keys = ON');

    logger.info({ path: config.path }, 'SQLite database opened');
  }

  getDatabase(): Database.Database {
    return this.db;
  }

  close(): void {
    this.db.close();
    logger.info('SQLite database closed');
  }

  exec(sql: string): void {
    this.db.exec(sql);
  }

  prepare(sql: string): Database.Statement {
    return this.db.prepare(sql);
  }

  transaction<T>(fn: () => T): T {
    const tx = this.db.transaction(fn);
    return tx();
  }

  migrate(migrations: Array<{ version: number; sql: string }>): void {
    const currentVersion = this.getCurrentVersion();

    for (const migration of migrations) {
      if (migration.version > currentVersion) {
        logger.info({ version: migration.version }, 'Applying migration');
        this.transaction(() => {
          this.db.exec(migration.sql);
          this.setVersion(migration.version);
        });
      }
    }
  }

  private getCurrentVersion(): number {
    try {
      const row = this.db.prepare('SELECT MAX(version) as v FROM schema_version').get() as { v: number } | undefined;
      return row?.v ?? 0;
    } catch {
      return 0;
    }
  }

  private setVersion(version: number): void {
    this.db.prepare('INSERT INTO schema_version (version, description) VALUES (?, ?)').run(version, `Migration ${version}`);
  }
}

export function createSqliteAdapter(config: DatabaseConfig): SqliteAdapter {
  return new SqliteAdapter(config);
}