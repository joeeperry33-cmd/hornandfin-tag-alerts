-- Lists a state serves only through a browser viewer (Colorado's leftover/reissue PDFs on Widen).
-- A scheduled task on the owner's computer opens the list in a real browser and saves the text here;
-- the checker reads the latest snapshot like any other list.
CREATE TABLE IF NOT EXISTS snapshots (
  source_id   TEXT PRIMARY KEY REFERENCES sources(id),
  body        TEXT NOT NULL,
  captured_at TEXT NOT NULL
);
UPDATE sources SET parser = 'snapshot', format = 'html', active = 1, check_minutes = 15, last_hash = NULL, last_error = NULL, last_checked = NULL, fail_count = 0,
  parser_config = '{"format":"colorado","staleHours":14}', link_url = 'https://cpw.state.co.us/Documents/Leftover.pdf',
  notes = 'Leftovers need no preference points. Read from CPW''s list viewer by a browser on the owner''s computer; updated hourly by CPW.'
  WHERE id = 'co-leftover';
