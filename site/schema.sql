CREATE TABLE IF NOT EXISTS subscribers (
  email TEXT NOT NULL UNIQUE,
  source TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
