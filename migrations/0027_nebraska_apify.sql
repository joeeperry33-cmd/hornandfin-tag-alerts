-- Nebraska's news feed refuses our checker (and Apify's datacenter proxy), so read it through the owner's
-- Apify task "Nebraska Leftover Tag Alerts" (residential proxy, about $0.12 a run). Only checked Jul 1 to Aug 31,
-- twice a day; paused the rest of the year to keep the cost down (the release comes out in late July).
UPDATE sources SET parser = 'apify', format = 'json',
  url = 'https://outdoornebraska.gov/about/press-events/news/',
  parser_config = '{"task":"dwemR5dW5NFtgjF9B","items":"rows","key":"link","quantity":"none","label":"Nebraska Game and Parks: {title}","skipZero":false,"offSeason":"pause"}',
  check_minutes = 720, season_start = '07-01', season_end = '08-31', active = 1,
  last_checked = NULL, last_hash = NULL, fail_count = 0, last_error = NULL,
  notes = 'Nebraska posts one news release a year (late July) listing leftover deer, antelope and elk permits, then sells them first come on gooutdoorsne.com in early August. Leftover deer are nonresident only. Read through the owner''s Apify task; paused outside July and August.'
WHERE id = 'ne-leftover';
