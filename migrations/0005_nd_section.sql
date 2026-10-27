-- North Dakota: watch only the "Available Licenses" box, not the whole page (news and banners were triggering alerts).
UPDATE sources SET parser_config = json_set(COALESCE(parser_config, '{}'), '$.start', 'Available Licenses', '$.end', 'More Lottery Information')
  WHERE id = 'nd-deer';
UPDATE sources SET last_hash = NULL WHERE id = 'nd-deer';
