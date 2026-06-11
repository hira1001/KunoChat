export const INITIAL_SQLITE_SCHEMA = `
CREATE TABLE IF NOT EXISTS messages (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL,
  sender_id TEXT NOT NULL,
  sender_name TEXT,
  created_at INTEGER NOT NULL,
  status TEXT NOT NULL,
  text TEXT,
  payload_json TEXT,
  deleted_at INTEGER
);

CREATE TABLE IF NOT EXISTS assets (
  id TEXT PRIMARY KEY,
  message_id TEXT NOT NULL,
  transfer_id TEXT NOT NULL,
  kind TEXT NOT NULL,
  name TEXT NOT NULL,
  extension TEXT,
  mime TEXT,
  size INTEGER NOT NULL,
  sha256 TEXT,
  local_path TEXT,
  thumbnail_path TEXT,
  status TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
`;
