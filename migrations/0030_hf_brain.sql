-- Horn & Fin tools: listings copy, rulebook passages, stocking alerts, points tracker, usage limits.

-- Public listing facts copied nightly from hornandfin.com (/wp-json/hf/v1/listings-public).
CREATE TABLE IF NOT EXISTS hf_listings (
  id INTEGER PRIMARY KEY,              -- WordPress post id
  title TEXT NOT NULL,
  url TEXT NOT NULL,
  directory TEXT,                      -- e.g. "Hunting Outfitters", "Fishing Charters"
  category TEXT,
  state TEXT,                          -- two-letter code
  city TEXT,
  county TEXT,
  species TEXT,                        -- comma list, lowercase
  summary TEXT,                        -- short public description
  featured INTEGER NOT NULL DEFAULT 0,
  claimed INTEGER NOT NULL DEFAULT 0,
  lat REAL,
  lng REAL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS hf_listings_state ON hf_listings (state, directory);

-- Rulebook text, one row per page (or part of a page), for cited regulation answers.
CREATE TABLE IF NOT EXISTS hf_reg_passages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  state TEXT NOT NULL,
  year TEXT NOT NULL,                  -- "2026" or "2026-27"
  book TEXT NOT NULL,                  -- "Colorado Big Game Brochure"
  page INTEGER,
  url TEXT NOT NULL,
  text TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS hf_reg_state ON hf_reg_passages (state, year);
CREATE VIRTUAL TABLE IF NOT EXISTS hf_reg_fts USING fts5(text, content='hf_reg_passages', content_rowid='id');
CREATE TRIGGER IF NOT EXISTS hf_reg_ai AFTER INSERT ON hf_reg_passages BEGIN
  INSERT INTO hf_reg_fts(rowid, text) VALUES (new.id, new.text);
END;
CREATE TRIGGER IF NOT EXISTS hf_reg_ad AFTER DELETE ON hf_reg_passages BEGIN
  INSERT INTO hf_reg_fts(hf_reg_fts, rowid, text) VALUES ('delete', old.id, old.text);
END;

-- Trout stocking: where each state posts its stocking report, and every stocking found.
CREATE TABLE IF NOT EXISTS stocking_sources (
  id TEXT PRIMARY KEY,                 -- "ut-stocking"
  state TEXT NOT NULL,
  name TEXT NOT NULL,
  url TEXT NOT NULL,                   -- the report we read (html table, csv or json)
  link_url TEXT NOT NULL,              -- the page hunters/anglers should open
  format TEXT NOT NULL CHECK (format IN ('html', 'csv', 'json')),
  config TEXT NOT NULL,                -- JSON: which columns hold water, county, species, date, count
  check_minutes INTEGER NOT NULL DEFAULT 720,
  active INTEGER NOT NULL DEFAULT 0,   -- turned on only after a test read looks right
  last_checked TEXT,
  last_status INTEGER,
  last_error TEXT,
  fail_count INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS stocking_reports (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  source_id TEXT NOT NULL,
  state TEXT NOT NULL,
  water TEXT NOT NULL,
  water_key TEXT NOT NULL,             -- lowercase, punctuation removed
  county TEXT,
  species TEXT,
  quantity INTEGER,
  stocked_on TEXT,                     -- YYYY-MM-DD when the report says
  first_seen TEXT NOT NULL,
  baseline INTEGER NOT NULL DEFAULT 0, -- 1 = already on the report the first time we read it (never alerted)
  UNIQUE (source_id, water_key, species, stocked_on)
);
CREATE INDEX IF NOT EXISTS stocking_reports_seen ON stocking_reports (first_seen);
CREATE INDEX IF NOT EXISTS stocking_reports_water ON stocking_reports (state, water_key);

-- Waters (or whole counties) an angler follows. water_key '*' with a county = every water in that county.
CREATE TABLE IF NOT EXISTS stocking_follows (
  subscriber_id TEXT NOT NULL,
  state TEXT NOT NULL,
  water_key TEXT NOT NULL,
  water TEXT NOT NULL,
  county TEXT NOT NULL DEFAULT '',
  confirm_token TEXT,                  -- set until the email owner confirms a follow added from a public form
  created_at TEXT NOT NULL,
  PRIMARY KEY (subscriber_id, state, water_key, county)
);
CREATE TABLE IF NOT EXISTS stocking_deliveries (
  report_id INTEGER NOT NULL,
  subscriber_id TEXT NOT NULL,
  channel TEXT NOT NULL,
  sent_at TEXT NOT NULL,
  PRIMARY KEY (report_id, subscriber_id, channel)
);

-- Points Tracker: the points a hunter says they hold.
CREATE TABLE IF NOT EXISTS hf_points (
  subscriber_id TEXT NOT NULL,
  state TEXT NOT NULL,
  species TEXT NOT NULL,
  residency TEXT NOT NULL DEFAULT 'nr',  -- 'res' | 'nr'
  points INTEGER NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (subscriber_id, state, species)
);

-- Per-visitor daily limits for the planner and Ask, plus a site-wide daily total.
CREATE TABLE IF NOT EXISTS hf_usage (
  day TEXT NOT NULL,
  who TEXT NOT NULL,                   -- hashed IP, or '*' for the site total
  calls INTEGER NOT NULL DEFAULT 0,
  input_tokens INTEGER NOT NULL DEFAULT 0,
  output_tokens INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (day, who)
);
