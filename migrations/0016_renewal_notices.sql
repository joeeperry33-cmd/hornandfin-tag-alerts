-- Yearly renewal reminders (California auto-renewal law: notice before a yearly plan renews,
-- and before a sale price ends). renews_at mirrors PayPal's next billing time.
ALTER TABLE subscribers ADD COLUMN renews_at TEXT;
ALTER TABLE subscribers ADD COLUMN renewal_notice_for TEXT;
