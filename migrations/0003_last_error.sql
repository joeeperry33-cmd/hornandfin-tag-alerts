-- Keep the most recent error message per source so failures can be diagnosed from the database.
ALTER TABLE sources ADD COLUMN last_error TEXT;
