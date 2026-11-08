export const auditLogsSchema = `
-- Audit log: records every authorization decision made by the Core Engine
CREATE TABLE IF NOT EXISTS audit_logs (
  id TEXT PRIMARY KEY,
  session_id TEXT,
  target_id TEXT,
  capability_id TEXT,
  operation TEXT NOT NULL,
  decision TEXT NOT NULL CHECK (decision IN ('allow', 'deny')),
  reason TEXT,
  approval_needed_json TEXT,
  timestamp TEXT NOT NULL,
  details_json TEXT
);

CREATE INDEX IF NOT EXISTS idx_audit_logs_session ON audit_logs(session_id);
CREATE INDEX IF NOT EXISTS idx_audit_logs_timestamp ON audit_logs(timestamp);
CREATE INDEX IF NOT EXISTS idx_audit_logs_decision ON audit_logs(decision);
`;
