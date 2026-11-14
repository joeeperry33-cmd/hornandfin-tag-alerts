-- New Jersey, Wisconsin and Illinois: public permit-availability feeds found in the Nov 2026 survey.

-- New Jersey: Zone/Period Availability Report data feed (deer zones by bow/muzzleloader/shotgun, bear zones,
-- spring turkey leftovers). Needs a visitor session cookie from the report page.
UPDATE sources SET name = 'New Jersey permits available by zone', format = 'json', parser = 'json',
  url = 'https://nj.aspirafocus.com/internetsales/Home/AvailablePermits',
  link_url = 'https://nj.aspirafocus.com/internetsales/Home/AvailablePermits',
  parser_config = '{"dataUrl":"https://nj.aspirafocus.com/internetsales/HomeApi/GetAvailablePermits?speciesID=0","items":"Data","key":"{HuntCode}|{Season}|{Period}","quantity":"LeftoverAvailable","label":"{Season}, zone {HuntZoneName} {Period}","speciesField":"SpeciesName","session":true}',
  species = 'deer,bear,turkey', check_minutes = 180, season_start = NULL, season_end = NULL,
  notes = 'Zone permits still for sale, first come, online or at agents. Spring turkey leftovers appear after the claim period (late March).',
  last_hash = NULL, fail_count = 0, last_error = NULL
WHERE id = 'nj-none';

-- Wisconsin: bonus antlerless harvest authorizations remaining by county/DMU, public and private land.
UPDATE sources SET name = 'Wisconsin bonus antlerless, public land', format = 'html', parser = 'table',
  url = 'https://apps.dnr.wi.gov/gowildpermits/PermitAvailability.aspx?s=1',
  link_url = 'https://dnr.wisconsin.gov/permits/bonusavailability.html',
  parser_config = '{"headerMatch":"remaining","keyColumns":["county"],"quantityColumn":"public","species":"deer","defaults":{"sex":"antlerless"},"requireQuantity":true,"keyPrefix":"public","labelPrefix":"Bonus antlerless deer, public land:","titleCase":true}',
  species = 'deer', check_minutes = 60, season_start = '08-10', season_end = '01-31',
  notes = 'Bonus antlerless authorizations sell first come by county and land type until sold out. Wisconsin updates the counts about every 15 minutes.',
  last_hash = NULL, fail_count = 0, last_error = NULL
WHERE id = 'wi-bonus';
INSERT OR IGNORE INTO sources (id, state, name, url, link_url, format, parser, parser_config, species, check_minutes, season_start, season_end, notes, active, opening)
VALUES ('wi-bonus-private', 'WI', 'Wisconsin bonus antlerless, private land',
  'https://apps.dnr.wi.gov/gowildpermits/PermitAvailability.aspx?s=1', 'https://dnr.wisconsin.gov/permits/bonusavailability.html', 'html', 'table',
  '{"headerMatch":"remaining","keyColumns":["county"],"quantityColumn":"private","species":"deer","defaults":{"sex":"antlerless"},"requireQuantity":true,"keyPrefix":"private","labelPrefix":"Bonus antlerless deer, private land:","titleCase":true}',
  'deer', 60, '08-10', '01-31', 'Bonus antlerless authorizations for private land, by county.', 0, 'leftover');

-- Illinois: leftover county firearm and muzzleloader deer permits (sold at license agents from Oct 20).
UPDATE sources SET name = 'Illinois leftover county deer permits (either sex)', format = 'json', parser = 'json',
  url = 'https://dnr.illinois.gov/hunting/deer/onlinedeerpermitinquirysystem.html',
  link_url = 'https://dnr.illinois.gov/hunting/deer/onlinedeerpermitinquirysystem.html',
  parser_config = '{"dataUrl":"https://dnr.illinois.gov/content/soi/dnr/en/hunting/deer/onlinedeerpermitinquirysystem/jcr:content/responsivegrid/container/container_293684588/container/data_table.datatablejson.json","items":"data","key":"{0}|{1}","quantity":"2","label":"Leftover {0} deer permit, {1} County, either sex","requireQuantity":true,"species":"deer","defaults":{"sex":"either"},"titleCase":true}',
  species = 'deer', check_minutes = 360, season_start = '08-15', season_end = '01-20',
  notes = 'Leftover county permits sell over the counter at license agents (not online), first come, from Oct 20. Illinois posts the counts once after the last lottery.',
  last_hash = NULL, fail_count = 0, last_error = NULL
WHERE id = 'il-quotas';
INSERT OR IGNORE INTO sources (id, state, name, url, link_url, format, parser, parser_config, species, check_minutes, season_start, season_end, notes, active, opening)
VALUES ('il-quotas-antlerless', 'IL', 'Illinois leftover county deer permits (antlerless)',
  'https://dnr.illinois.gov/hunting/deer/onlinedeerpermitinquirysystem.html', 'https://dnr.illinois.gov/hunting/deer/onlinedeerpermitinquirysystem.html', 'json', 'json',
  '{"dataUrl":"https://dnr.illinois.gov/content/soi/dnr/en/hunting/deer/onlinedeerpermitinquirysystem/jcr:content/responsivegrid/container/container_293684588/container/data_table.datatablejson.json","items":"data","key":"{0}|{1}","quantity":"3","label":"Leftover {0} deer permit, {1} County, antlerless only","requireQuantity":true,"species":"deer","defaults":{"sex":"antlerless"},"titleCase":true}',
  'deer', 360, '08-15', '01-20', 'Antlerless-only leftover county permits, sold at license agents.', 0, 'leftover');
