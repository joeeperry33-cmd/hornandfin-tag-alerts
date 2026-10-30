-- Busy first-come windows: check more often while tags are selling fast.
ALTER TABLE sources ADD COLUMN rush TEXT;
UPDATE sources SET rush = '[{"start":"07-16","end":"07-31","minutes":30}]' WHERE id = 'wy-leftover';   -- first-come sales open July 16, 8am
UPDATE sources SET rush = '[{"start":"07-25","end":"08-08","minutes":30}]' WHERE id = 'ia-quotas';     -- nonresident leftover deer, July 25 6am CT
UPDATE sources SET rush = '[{"start":"07-01","end":"07-14","minutes":60}]' WHERE id = 'or-leftover';   -- online sale opens July 1, 10am
UPDATE sources SET rush = '[{"start":"07-22","end":"08-05","minutes":60}]' WHERE id = 'ar-wma';        -- WMA permit sale opened July 22 in 2026
UPDATE sources SET rush = '[{"start":"11-01","end":"11-14","minutes":60}]' WHERE id = 'ny-dmp';        -- leftover DMPs from about Nov 1
UPDATE sources SET rush = '[{"start":"04-21","end":"04-30","minutes":60},{"start":"06-23","end":"07-02","minutes":60},{"start":"09-15","end":"09-24","minutes":60}]'
  WHERE id = 'id-returned';                                                                           -- 2026 resale dates Apr 23, Jun 25, Sep 17 (update yearly)
UPDATE sources SET rush = '[{"start":"06-01","end":"07-31","minutes":60}]' WHERE id = 'ks-deer';       -- nonresident whitetail leftovers, June–July
