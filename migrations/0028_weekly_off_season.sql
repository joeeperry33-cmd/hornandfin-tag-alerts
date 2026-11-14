-- Paid scrapers: check weekly outside their selling seasons, just to confirm the Apify task still works.
-- Kansas: leftover nonresident deer permits sell in June-July (every 3 hours then).
UPDATE sources SET check_minutes = 180, season_start = '06-01', season_end = '07-31', rush = NULL,
  parser_config = '{"task":"1DfQJSN28pRXglphm","items":"mentions","key":"id","quantity":"count","label":"{text}","species":"deer","defaults":{"residency":"nonresident"},"offSeason":10080}'
WHERE id = 'ks-deer';
-- New Jersey: deer and bear zone permits Aug to mid-Feb; spring turkey leftovers mid-March to May.
UPDATE sources SET check_minutes = 180, season_start = '08-01', season_end = '02-15',
  rush = '[{"start":"03-15","end":"05-25","minutes":180}]',
  parser_config = '{"task":"Ebn7EdO3Bu0tF4Vdk","items":"rows","key":"key","quantity":"available","label":"{season}, {zone} {period}","speciesField":"species","offSeason":10080}'
WHERE id = 'nj-none';
