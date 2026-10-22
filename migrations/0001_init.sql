-- Horn & Fin tag alerts schema (Cloudflare D1 / SQLite)

-- One row per state page we watch.
CREATE TABLE IF NOT EXISTS sources (
  id            TEXT PRIMARY KEY,          -- e.g. 'ut-remaining-elk'
  state         TEXT NOT NULL,             -- two-letter code
  name          TEXT NOT NULL,             -- shown to subscribers
  url           TEXT NOT NULL,             -- page or file we fetch
  link_url      TEXT,                      -- where to send the hunter to buy (defaults to url)
  format        TEXT NOT NULL,             -- html | pdf | csv | json
  parser        TEXT NOT NULL DEFAULT 'change', -- change | table
  parser_config TEXT,                      -- JSON, parser-specific
  species       TEXT,                      -- comma list: elk,deer,pronghorn,moose,sheep,goat,bear,turkey
  check_minutes INTEGER NOT NULL DEFAULT 60,
  season_start  TEXT,                      -- MM-DD; outside the window we check once a day
  season_end    TEXT,
  notes         TEXT,
  active        INTEGER NOT NULL DEFAULT 1,
  last_hash     TEXT,
  last_checked  TEXT,
  last_changed  TEXT,
  last_status   INTEGER,
  fail_count    INTEGER NOT NULL DEFAULT 0
);

-- Individual hunts found on a structured page (table parser).
CREATE TABLE IF NOT EXISTS listings (
  id          TEXT PRIMARY KEY,            -- source_id + ':' + hunt key
  source_id   TEXT NOT NULL REFERENCES sources(id),
  hunt_key    TEXT NOT NULL,
  label       TEXT NOT NULL,
  species     TEXT,
  quantity    INTEGER,                     -- null when the page shows no count
  first_seen  TEXT NOT NULL,
  last_seen   TEXT NOT NULL,
  gone_at     TEXT
);
CREATE INDEX IF NOT EXISTS listings_source ON listings(source_id);

-- Something an alert can be sent about.
CREATE TABLE IF NOT EXISTS events (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  source_id   TEXT NOT NULL REFERENCES sources(id),
  kind        TEXT NOT NULL,               -- new_listing | quantity_up | page_changed
  state       TEXT NOT NULL,
  species     TEXT,
  title       TEXT NOT NULL,
  detail      TEXT,
  link_url    TEXT NOT NULL,
  created_at  TEXT NOT NULL,
  digested    INTEGER NOT NULL DEFAULT 0   -- included in a free daily digest
);
CREATE INDEX IF NOT EXISTS events_created ON events(created_at);

CREATE TABLE IF NOT EXISTS subscribers (
  id               TEXT PRIMARY KEY,
  email            TEXT NOT NULL UNIQUE,
  phone            TEXT,                   -- E.164, paid tier only
  sms_consent_at   TEXT,                   -- when they checked the text consent box
  tier             TEXT NOT NULL DEFAULT 'free', -- free | paid
  states           TEXT NOT NULL DEFAULT '*',    -- comma list or *
  species          TEXT NOT NULL DEFAULT '*',
  verified_at      TEXT,
  verify_token     TEXT NOT NULL,
  manage_token     TEXT NOT NULL,
  stripe_customer  TEXT,
  stripe_sub       TEXT,
  sms_stopped      INTEGER NOT NULL DEFAULT 0,
  unsubscribed_at  TEXT,
  created_at       TEXT NOT NULL
);

-- Which subscriber got which event, on which channel (prevents double sends).
CREATE TABLE IF NOT EXISTS deliveries (
  event_id      INTEGER NOT NULL REFERENCES events(id),
  subscriber_id TEXT NOT NULL REFERENCES subscribers(id),
  channel       TEXT NOT NULL,             -- email | sms | digest
  sent_at       TEXT NOT NULL,
  PRIMARY KEY (event_id, subscriber_id, channel)
);

-- Rate limit sign-ups by IP.
CREATE TABLE IF NOT EXISTS signup_log (
  ip         TEXT NOT NULL,
  created_at TEXT NOT NULL
);
