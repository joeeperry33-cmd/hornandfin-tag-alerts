-- Pennsylvania: the WMU table is drawn from a public JSON feed; read it directly. Busy windows follow PA's license rounds.
UPDATE sources SET parser = 'json', format = 'json', check_minutes = 60, last_hash = NULL, last_error = NULL, last_checked = NULL, fail_count = 0,
  season_start = '06-15', season_end = '01-24', rush = '[{"start":"06-15","end":"06-29","minutes":30},{"start":"07-13","end":"07-20","minutes":30},{"start":"07-27","end":"08-03","minutes":30},{"start":"08-10","end":"08-17","minutes":30},{"start":"08-24","end":"08-31","minutes":30}]',
  notes = 'First-come rounds: June 15 landowners, June 22 residents, July 13 nonresidents, then July 27, Aug 10, Aug 24 (2026).',
  parser_config = '{"discover": "seasonList=''\\[\\{[^}]*?\"Value\":\"([0-9a-f-]{36})\"", "dataUrl": "/pa/antlerlesswmu/getseasonwmulist?seasonid={1}", "items": "RemainingWMUs", "key": "Name", "quantity": "Remaining", "label": "Antlerless deer, WMU {Name}", "species": "deer", "defaults": {"sex": "antlerless", "residency": "both"}}'
  WHERE id = 'pa-antlerless';
DELETE FROM listings WHERE source_id = 'pa-antlerless';
