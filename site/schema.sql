CREATE TABLE IF NOT EXISTS subscribers (
  email TEXT NOT NULL UNIQUE,
  source TEXT NOT NULL,
  token TEXT UNIQUE, -- unsubscribe link: /unsubscribe?t=<token>
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Site downloads per day (no IPs): kind = install.sh | mac-app
CREATE TABLE IF NOT EXISTS downloads (
  day TEXT NOT NULL,
  kind TEXT NOT NULL,
  count INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (day, kind)
);
