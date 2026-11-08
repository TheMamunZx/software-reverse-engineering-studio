export const initialSchema = `
-- Enable foreign keys and WAL mode
PRAGMA foreign_keys = ON;
PRAGMA journal_mode = WAL;

-- Schema version tracking
CREATE TABLE IF NOT EXISTS schema_version (
  version INTEGER PRIMARY KEY,
  applied_at TEXT NOT NULL DEFAULT (datetime('now')),
  description TEXT
);

-- Sessions
CREATE TABLE IF NOT EXISTS sessions (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  name TEXT NOT NULL,
  description TEXT,
  status TEXT NOT NULL CHECK (status IN ('initialized','running','paused','completed','failed','archived')),
  config_json TEXT NOT NULL,
  authorization_json TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  created_by TEXT NOT NULL,
  tags_json TEXT
);

-- Targets
CREATE TABLE IF NOT EXISTS targets (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  type TEXT NOT NULL CHECK (type IN ('binary','android','web','js','dotnet','network')),
  path TEXT NOT NULL,
  metadata_json TEXT NOT NULL,
  hashes_json TEXT NOT NULL,
  authorization_json TEXT NOT NULL,
  added_at TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('primary','secondary','reference')),
  UNIQUE(session_id, path)
);

-- Environments (normalized, shared across findings)
CREATE TABLE IF NOT EXISTS environments (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  os TEXT NOT NULL,
  arch TEXT NOT NULL,
  tools_json TEXT NOT NULL,
  provider_versions_json TEXT NOT NULL,
  target_hash TEXT NOT NULL,
  captured_at TEXT NOT NULL
);

-- Findings (Evidence) - queryable confidence fields
CREATE TABLE IF NOT EXISTS findings (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  target_id TEXT NOT NULL REFERENCES targets(id) ON DELETE CASCADE,
  provider_id TEXT NOT NULL,
  capability_id TEXT NOT NULL,
  category TEXT NOT NULL,
  severity TEXT NOT NULL CHECK (severity IN ('critical','high','medium','low','info')),
  title TEXT NOT NULL,
  observation TEXT NOT NULL,
  inference TEXT,
  evidence_json TEXT NOT NULL,
  confidence_level TEXT NOT NULL CHECK (confidence_level IN ('high','medium','low','none')),
  confidence_value REAL NOT NULL CHECK (confidence_value >= 0.0 AND confidence_value <= 1.0),
  confidence_justification TEXT NOT NULL,
  limitations_json TEXT NOT NULL,
  unknowns_json TEXT NOT NULL,
  provenance_json TEXT NOT NULL,
  reproducibility_json TEXT NOT NULL,
  tags_json TEXT,
  environment_id TEXT REFERENCES environments(id),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  created_by TEXT NOT NULL,
  version INTEGER NOT NULL DEFAULT 1
);

-- Indexes for common queries
CREATE INDEX IF NOT EXISTS idx_findings_session ON findings(session_id);
CREATE INDEX IF NOT EXISTS idx_findings_target ON findings(target_id);
CREATE INDEX IF NOT EXISTS idx_findings_category ON findings(category);
CREATE INDEX IF NOT EXISTS idx_findings_confidence ON findings(confidence_level, confidence_value);
CREATE INDEX IF NOT EXISTS idx_findings_capability ON findings(capability_id);
CREATE INDEX IF NOT EXISTS idx_findings_created ON findings(created_at);
CREATE INDEX IF NOT EXISTS idx_targets_session ON targets(session_id);
CREATE INDEX IF NOT EXISTS idx_environments_session ON environments(session_id);
`;