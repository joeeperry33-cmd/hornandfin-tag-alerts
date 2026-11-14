-- Maine: maine.gov blocks automated checks. The owner's Apify task reads the antlerless deer permit
-- page's "Extra antlerless deer permits are still available ... for WMDs 21-25 and 29" notice; each
-- district named becomes a listing, so a district added to the notice is an alert.
UPDATE sources SET parser = 'apify', format = 'json', name = 'Maine extra antlerless deer permits',
  url = 'https://www.maine.gov/ifw/hunting-trapping/hunting/species/deer/antlerless-deer-permit.html',
  link_url = 'https://www.maine.gov/ifw/hunting-trapping/hunting/species/deer/antlerless-deer-permit.html',
  parser_config = '{"task":"SrxTIHqOelWXD4GoI","items":"permits","key":"wmd","quantity":"count","label":"Extra antlerless deer permit, WMD {wmd}","species":"deer","defaults":{"sex":"antlerless"}}',
  notes = 'Extra antlerless deer permits left after the lottery sell online, first come. Read through an Apify task from the "still available ... for WMDs" notice.',
  check_minutes = 180, season_start = '08-15', season_end = '12-15', active = 1, last_hash = NULL, fail_count = 0, last_error = NULL
WHERE id = 'me-antlerless';
