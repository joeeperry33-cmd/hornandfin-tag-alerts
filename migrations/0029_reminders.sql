-- Free deadline and draw-result reminders (Horn & Fin tools package).
-- Only verified dates from the state agency go in here (admin load). Never guess a date.
CREATE TABLE IF NOT EXISTS deadlines (
  id TEXT PRIMARY KEY,                 -- e.g. "co-2027-primary-close"
  state TEXT NOT NULL,                 -- two-letter code
  species TEXT,                        -- comma list from SPECIES, NULL = every species in the state
  kind TEXT NOT NULL CHECK (kind IN ('apply_open', 'apply_close', 'results', 'leftover_sale', 'points_only')),
  date TEXT NOT NULL,                  -- YYYY-MM-DD, the agency's date
  time_note TEXT,                      -- e.g. "11:59 p.m. Mountain time"
  title TEXT NOT NULL,                 -- "Colorado big game draw applications close"
  link_url TEXT NOT NULL,              -- the agency page that states the date
  source TEXT NOT NULL,                -- where the date was confirmed, e.g. "CPW 2027 Big Game Brochure p. 6"
  verified_at TEXT NOT NULL,
  active INTEGER NOT NULL DEFAULT 1
);
CREATE INDEX IF NOT EXISTS deadlines_date ON deadlines (date);

CREATE TABLE IF NOT EXISTS reminder_deliveries (
  deadline_id TEXT NOT NULL,
  subscriber_id TEXT NOT NULL,
  offset_days INTEGER NOT NULL,
  channel TEXT NOT NULL,               -- 'email' | 'sms'
  sent_at TEXT NOT NULL,
  PRIMARY KEY (deadline_id, subscriber_id, offset_days, channel)
);
CREATE INDEX IF NOT EXISTS reminder_deliveries_sub ON reminder_deliveries (subscriber_id, channel, sent_at);

-- Everyone gets reminders unless they turn them off on the settings page.
ALTER TABLE subscribers ADD COLUMN deadline_reminders INTEGER NOT NULL DEFAULT 1;
