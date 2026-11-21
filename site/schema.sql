CREATE TABLE IF NOT EXISTS subscribers (
  email TEXT NOT NULL UNIQUE,
  source TEXT NOT NULL,
  token TEXT UNIQUE, -- unsubscribe link: /unsubscribe?t=<token>
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
