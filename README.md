# Horn & Fin Tag Alerts

Watches state wildlife agency pages for **leftover, returned and reissued big game tags** and alerts Horn & Fin subscribers.

- **Free tier:** one email each morning with everything that opened up in the last day.
- **Paid tier ($4.99/mo):** an email and a text within about 15 minutes of a change.

Runs on Cloudflare Workers + D1, same setup as Nabdrops. The sign-up form embeds on hornandfin.com.

## How it works

1. Every 15 minutes the worker checks the state pages that are due (`sources` table). Each source has its own interval and an in-season window; out of season it checks once a day. Failing sources back off.
2. Before fetching, it checks the site's `robots.txt` and skips anything disallowed.
3. Two kinds of parser:
   - **table** — reads hunt rows and counts (Utah, Idaho, Iowa, South Dakota, Pennsylvania, Massachusetts). Alerts name the exact hunt: "EB3010 – Book Cliffs (3 available) just opened up", or "more tags returned for…". One alert per species, so an elk-only subscriber never sees deer hunts.
   - **change** — fingerprints the meaningful part of a page or PDF (ignoring timestamps, scripts, PDF metadata) and alerts when it changes: "Colorado: the weekly reissue preview list was just updated".
   - If a table page's layout changes, it falls back to change detection, so alerts never silently stop.
4. The first check of any source records a baseline quietly — no alert storm on launch.
5. Paid subscribers get instant alerts; free subscribers get the digest at 14:30 UTC (7:30am Pacific in summer, 6:30am in winter).
6. The public feed (`/api/feed`) lags 12 hours so paid alerts keep their head start.

## Coverage (Oct 2026)

**Watching now (20 sources, 18 states):** CO (leftover list + weekly reissue list), UT, ID (leftovers + returned tags), WY, AZ, OR, CA (deer), IA, SD, ND, KS, MI (bear), AR, PA, MA, NY, VT, ME.

**Documented but off (17)** — see `notes` on each row in `migrations/0002_sources.sql`:
- *Needs a data URL found first (page loads by JavaScript):* FL, WI, IL
- *URL changes every year:* NM, NE, TN — update before each season, then set `active = 1`
- *Not watchable (login-only, alternates, or nothing published):* MT, NV, AK, MN, TX, NJ, CT, NC, KY, HI
- *Blocked by robots.txt for automated agents:* WA
- *OTC deer only, nothing to watch:* OH, IN, MO, OK, RI, DE, VA, WV, SC, AL, MS, GA, LA, MD, NH (no rows)

## Deploy

Already done: the D1 database `hornandfin-tag-alerts` exists on the Cloudflare account, with tables created and all sources loaded. Its ID is in `wrangler.toml`.

### 1. Accounts and keys

| Service | What for | Set as secret |
| --- | --- | --- |
| [Resend](https://resend.com) | Sending email. Verify the `hornandfin.com` domain (adds DNS records in Cloudflare). | `RESEND_API_KEY` |
| [Twilio](https://twilio.com) | Texts. Buy a number and complete **A2P 10DLC** registration (US carriers require it for business texting; takes a few days). Point the number's incoming-message webhook to `https://alerts.hornandfin.com/api/sms/inbound`. | `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_FROM_NUMBER` |
| Stripe | Paid tier. Create a product "Instant Tag Alerts" with a $4.99/month price. Add a webhook to `https://alerts.hornandfin.com/api/stripe/webhook` for `checkout.session.completed`, `customer.subscription.updated`, `customer.subscription.deleted`. Turn on the customer billing portal. | `STRIPE_SECRET_KEY`, `STRIPE_PRICE_ID`, `STRIPE_WEBHOOK_SECRET` |
| — | Admin endpoints | `ADMIN_TOKEN` (any long random string) |

Without these keys the worker still runs: it logs "[dry-run] would email/text" instead of sending.

### 2. Push and deploy

Same as Nabdrops: push this folder to GitHub (`joeeperry33-cmd/hornandfin-tag-alerts`), then in Cloudflare → Workers & Pages → Create → Import a repository. Or from a terminal:

```
npm install
npx wrangler login
npx wrangler deploy
npx wrangler secret put RESEND_API_KEY   # repeat for each secret
```

Use the Workers **Paid plan ($5/mo)**: the free plan's 50-subrequest limit is too small for a check run plus alert sends.

### 3. Custom domain

Cloudflare → the worker → Settings → Domains & Routes → add `alerts.hornandfin.com`.

### 4. Put the form on Horn & Fin

Create a page at `hornandfin.com/tag-alerts/` and paste `wordpress-embed.html` into a Custom HTML block. Add the same snippet with `data-states="CO"` (etc.) to each state guide page.

## Admin

```
curl -H "Authorization: Bearer $ADMIN_TOKEN" https://alerts.hornandfin.com/admin/sources   # health of every source
curl -H "Authorization: Bearer $ADMIN_TOKEN" https://alerts.hornandfin.com/admin/stats     # subscriber counts
curl -X POST -H "Authorization: Bearer $ADMIN_TOKEN" "https://alerts.hornandfin.com/admin/check?id=ut-remaining"  # check one now
```

Watch `fail_count` and `last_status`. A table source that keeps logging "falling back to change detection" needs its `parser_config` column names adjusted to match the live page.

**Adding or fixing a source:** edit `migrations/0002_sources.sql` and run `npm run db:seed`. Re-running keeps each source's history.

## Local development

```
npx wrangler d1 execute hornandfin-tag-alerts --local --file=migrations/0001_init.sql
npx wrangler d1 execute hornandfin-tag-alerts --local --file=migrations/0002_sources.sql
npm run dev                                   # then: curl "localhost:8787/__scheduled?cron=*/15+*+*+*+*"
npm test
```

## Compliance notes

- Email: double opt-in, one-click unsubscribe headers, and a mailing address in every footer (CAN-SPAM).
- Texts: paid users opt in with an explicit consent checkbox (logged with a timestamp); STOP is honored both by Twilio and in the database (TCPA).
- Every alert links back to the state agency; nothing here sells or reserves tags.
