CREATE TABLE IF NOT EXISTS oauth_states (
  state_hash TEXT PRIMARY KEY,
  code_verifier TEXT NOT NULL,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS google_sessions (
  session_hash TEXT PRIMARY KEY,
  google_sub TEXT NOT NULL,
  refresh_cipher TEXT NOT NULL,
  refresh_iv TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS google_sessions_expiry ON google_sessions(expires_at);
CREATE INDEX IF NOT EXISTS google_sessions_subject ON google_sessions(google_sub);
