-- Michigan: michigan.gov blocks automated checks. The owner's Apify task reads every hunt code's
-- "Leftover Licenses" from the bear drawing statistics DataTable (all pages, not just the 10 shown).
UPDATE sources SET parser = 'apify', format = 'json', name = 'Michigan bear leftover licenses',
  link_url = 'https://www.michigan.gov/dnr/things-to-do/hunting/bear/drawing-statistics',
  parser_config = '{"task":"ymtRJjwK3XP4qfh4I","items":"hunts","key":"hunt","quantity":"leftover","label":"Bear, hunt {hunt} {name} ({start} to {end})","species":"bear"}',
  notes = 'Leftover bear licenses after the drawing sell first come. Read through an Apify task from the drawing statistics table.',
  check_minutes = 180, season_start = '06-15', season_end = '09-30', active = 1, last_hash = NULL, fail_count = 0, last_error = NULL
WHERE id = 'mi-bear';
