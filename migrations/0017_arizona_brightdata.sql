-- Arizona: azgfd.com blocks automated checks, so the owner's Bright Data scraper finds the current
-- leftover permit-tag PDF links on the big game draw page, and the site downloads and reads the PDFs
-- (hosted on Amazon S3). Needs the BRIGHTDATA_API_KEY secret in Cloudflare.
UPDATE sources SET
  parser = 'brightdata_pdf',
  format = 'pdf',
  url = 'https://www.azgfd.com/hunting/hunt-draw-and-licenses/big-game-draw/',
  link_url = 'https://www.azgfd.com/hunting/hunt-draw-and-licenses/big-game-draw/',
  name = 'Arizona leftover permit-tags (first come)',
  species = 'elk,deer,pronghorn,bear,turkey,sheep,other',
  parser_config = '{"collector":"c_mwfrxouz6gamipvxx","input":{"url":"https://www.azgfd.com/hunting/hunt-draw-and-licenses/big-game-draw/"},"reader":"arizona","staleHours":72}',
  notes = 'Leftover hunts are applied for by U.S. Mail, first come. Read from Arizona''s leftover PDFs, found on the big game draw page by a Bright Data scraper.',
  check_minutes = 180,
  active = 1,
  last_hash = NULL,
  fail_count = 0,
  last_error = NULL
WHERE id = 'az-leftover';
