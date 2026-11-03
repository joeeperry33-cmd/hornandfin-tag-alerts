-- PayPal Subscriptions (Horn & Fin PayPal account) replace Stripe.
CREATE TABLE IF NOT EXISTS settings (
  key        TEXT PRIMARY KEY,
  value      TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
ALTER TABLE subscribers ADD COLUMN paypal_sub TEXT;
ALTER TABLE subscribers ADD COLUMN paid_until TEXT;
CREATE INDEX IF NOT EXISTS subscribers_paypal ON subscribers(paypal_sub);
