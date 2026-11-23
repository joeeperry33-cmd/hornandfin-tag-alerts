-- Rulebooks waiting to be read. The scheduled run imports one per run, then marks it done (or records the error).
CREATE TABLE IF NOT EXISTS hf_rulebook_queue (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  state TEXT NOT NULL,
  year TEXT NOT NULL,
  book TEXT NOT NULL,
  url TEXT NOT NULL,
  page_offset INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'waiting',  -- waiting | done | failed
  result TEXT,
  updated_at TEXT
);
