-- Kansas: ksoutdoors.gov blocks automated checks (even Apify's normal proxy). The owner's Apify task
-- (residential proxy) watches the deer page and KDWP newsroom for leftover-permit posts; each new post
-- becomes an alert. Daily, every 3 hours in the June-July leftover window.
UPDATE sources SET parser = 'apify', format = 'json',
  name = 'Kansas leftover deer permits (deer page and KDWP news)',
  url = 'https://www.ksoutdoors.gov/outdoor-activities/hunting-in-kansas/what-to-hunt/big-game/deer',
  link_url = 'https://www.ksoutdoors.gov/outdoor-activities/hunting-in-kansas/what-to-hunt/big-game/deer',
  parser_config = '{"task":"1DfQJSN28pRXglphm","items":"mentions","key":"id","quantity":"count","label":"{text}","species":"deer","defaults":{"residency":"nonresident"}}',
  notes = 'Leftover nonresident deer permits sell first come for a short window each summer. Watched through an Apify task that looks for leftover-permit posts on the deer page and KDWP newsroom.',
  check_minutes = 1440, rush = '[{"start":"06-01","end":"07-31","minutes":180}]', season_start = NULL, season_end = NULL,
  active = 1, last_hash = NULL, fail_count = 0, last_error = NULL
WHERE id = 'ks-deer';
