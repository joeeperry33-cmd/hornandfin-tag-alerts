-- Gentler schedule: lists with live hunt counts every hour, page-change lists every 3 hours.
UPDATE sources SET check_minutes = 60 WHERE parser IN ('table', 'form');
UPDATE sources SET check_minutes = 180 WHERE parser = 'change';
