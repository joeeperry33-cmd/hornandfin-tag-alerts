-- Page-change alerts (no hunt-level counts) are opt-in; off for everyone by default.
ALTER TABLE subscribers ADD COLUMN page_alerts INTEGER NOT NULL DEFAULT 0;
