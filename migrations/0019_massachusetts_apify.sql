-- Massachusetts: mass.gov blocks automated checks, so the owner's Apify task (Web Scraper) reads the
-- surplus antlerless deer permit table and the "ZONES ... ARE SOLD OUT." notice. Needs APIFY_TOKEN.
UPDATE sources SET
  parser = 'apify',
  format = 'json',
  url = 'https://www.mass.gov/how-to/buy-a-surplus-antlerless-deer-permit',
  link_url = 'https://www.mass.gov/how-to/buy-a-surplus-antlerless-deer-permit',
  parser_config = '{"task":"62DjK8vXUoxSb8dyj","items":"zones","key":"zone","quantity":"availablePermits","label":"Surplus antlerless deer permit, zone {zone}","species":"deer","defaults":{"sex":"antlerless"},"soldOutField":"soldOutNotice"}',
  notes = 'Surplus antlerless deer permits sell first come, online or at license agents. Read through an Apify task.',
  check_minutes = 60,
  active = 1,
  last_hash = NULL,
  fail_count = 0,
  last_error = NULL
WHERE id = 'ma-surplus';
