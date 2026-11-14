-- New Jersey's permit feed only answers a real browser session, so read it through the owner's Apify task
-- "New Jersey Leftover Tag Alerts" (Web Scraper, residential proxy), which loads the report page and calls the feed from inside it.
UPDATE sources SET parser = 'apify', format = 'json',
  parser_config = '{"task":"Ebn7EdO3Bu0tF4Vdk","items":"rows","key":"key","quantity":"available","label":"{season}, {zone} {period}","speciesField":"species"}',
  check_minutes = 180, active = 1, last_checked = NULL, last_hash = NULL, fail_count = 0, last_error = NULL,
  notes = 'Zone permits still for sale, first come, online or at license agents. Read through the owner''s Apify task (New Jersey blocks direct checks). Spring turkey leftovers appear after the claim period (late March).'
WHERE id = 'nj-none';
