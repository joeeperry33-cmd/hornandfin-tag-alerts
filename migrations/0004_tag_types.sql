-- Tag types on alerts: how the tag opened up, weapon, antlered/antlerless, who can buy it.
ALTER TABLE sources ADD COLUMN opening TEXT NOT NULL DEFAULT 'leftover';
ALTER TABLE listings ADD COLUMN weapon TEXT;
ALTER TABLE listings ADD COLUMN sex TEXT;
ALTER TABLE listings ADD COLUMN residency TEXT;
ALTER TABLE events ADD COLUMN opening TEXT;
ALTER TABLE events ADD COLUMN weapon TEXT;
ALTER TABLE events ADD COLUMN sex TEXT;
ALTER TABLE events ADD COLUMN residency TEXT;
ALTER TABLE subscribers ADD COLUMN openings TEXT NOT NULL DEFAULT '*';
ALTER TABLE subscribers ADD COLUMN weapons TEXT NOT NULL DEFAULT '*';
ALTER TABLE subscribers ADD COLUMN sexes TEXT NOT NULL DEFAULT '*';
ALTER TABLE subscribers ADD COLUMN home_state TEXT;

CREATE TABLE IF NOT EXISTS event_items (
  event_id      INTEGER NOT NULL REFERENCES events(id),
  label         TEXT NOT NULL,
  species       TEXT,
  quantity      INTEGER,
  prev_quantity INTEGER,
  weapon        TEXT,
  sex           TEXT,
  residency     TEXT
);
CREATE INDEX IF NOT EXISTS event_items_event ON event_items(event_id);

-- How each list's tags became available.
UPDATE sources SET opening = 'reissue' WHERE id = 'co-reissue';
UPDATE sources SET opening = 'returned' WHERE id = 'id-returned';

-- Lists where every hunt shares a tag type (used when the page has no per-hunt rows).
UPDATE sources SET parser_config = json_set(COALESCE(parser_config, '{}'), '$.defaults', json('{"sex":"antlerless"}'))
  WHERE id IN ('pa-antlerless', 'ma-surplus', 'vt-antlerless', 'me-antlerless', 'ny-dmp');
UPDATE sources SET parser_config = json_set(COALESCE(parser_config, '{}'), '$.defaults', json('{"residency":"nonresident"}'))
  WHERE id = 'ks-deer';
