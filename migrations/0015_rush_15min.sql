-- Busy first-come weeks for Wyoming, Iowa and Pennsylvania: check every 15 minutes (was 30).
-- Matches the ads and site wording "checked as often as every 15 minutes".
UPDATE sources SET rush = REPLACE(rush, '"minutes":30', '"minutes":15')
WHERE id IN ('wy-leftover', 'ia-quotas') OR id LIKE 'pa-%';
