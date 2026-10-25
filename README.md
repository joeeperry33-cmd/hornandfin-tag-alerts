# Leftover Tag Alerts

**leftovertagalerts.com** watches state wildlife agency pages for leftover, returned and reissued big game tags and alerts subscribers.

- **Free:** one email each morning with everything that opened up in the last day.
- **Instant ($4.99/mo):** an email and a text within about 15 minutes of a change.

One Cloudflare Worker runs the whole thing: the website (home, privacy, terms, bot info), the sign-up and settings pages, the state checker and the alert sender. Data lives in the Cloudflare D1 database `leftover-tag-alerts`. Operated by Perry Capital LLC.

## How it works

1. Every 15 minutes the worker checks the state pages that are due (`sources` table). Each source has its own interval and in-season window; out of season it checks once a day, and failing sources back off.
2. It reads each site's `robots.txt` first and skips anything disallowed (or any site whose robots.txt can't be reached). It identifies itself as `LeftoverTagAlerts/0.2 (+https://leftovertagalerts.com/bot)`; `/bot` explains it to agency web teams.
3. Two parsers:
   - **table** reads hunt rows and counts (Utah, Idaho, Iowa, South Dakota, Pennsylvania, Massachusetts). Alerts name the hunt, e.g. "Utah: DB1500 – Pine Valley (4 available) just opened up". One alert per species.
   - **change** fingerprints the meaningful part of a page or PDF (ignoring timestamps, scripts, PDF metadata) and alerts when it changes.
   - If a table page's layout changes, it falls back to change detection, so alerts never silently stop.
4. A source's first check records a baseline quietly; no alert storm on launch.
5. Paid subscribers get instant alerts; free subscribers get a digest at 14:30 UTC (7:30am Pacific in summer).
6. The homepage's "Recent openings" list and `/api/feed` lag 12 hours so paid alerts keep their head start.

## Coverage (Oct 2026)

**Watching (16 lists, 14 states):** CO (leftover list + weekly reissue list), UT, ID (leftovers + returned tags), WY, OR, CA (deer), IA, SD, ND, KS, AR, PA, NY, VT.

**Off for now (17 rows)**, reasons in each row's `notes` in `migrations/0002_sources.sql`:
- Page loads by JavaScript, needs its data URL found: FL, WI, IL
- URL changes every year: NM, NE, TN. Update before each season, then set `active = 1`
- Nothing public to watch (login-only, alternates, nothing published): MT, NV, AK, MN, TX, NJ, CT, NC, KY, HI
- robots.txt blocks automated agents: WA
- State firewall blocks automated checks (403): AZ, MA, ME, MI. Ask each agency to allow the `LeftoverTagAlerts` user agent; /bot explains it.

## Deploy

Already done: database `leftover-tag-alerts` exists with tables and all sources loaded; its ID is in `wrangler.toml`.

### 1. Domain
Add **leftovertagalerts.com** to Cloudflare (or buy it through Cloudflare Registrar) so its DNS is on Cloudflare.

### 2. Worker
Cloudflare → Workers & Pages → Create → Import a repository → this repo.
- Project name **leftover-tag-alerts** (must match `wrangler.toml`)
- Deploy command `npx wrangler deploy`
- Workers **Paid plan ($5/mo)**: the free plan's subrequest limit is too small.

Then Worker → Settings → Domains & Routes → add custom domains `leftovertagalerts.com` and `www.leftovertagalerts.com` (www redirects to the main domain).

### 3. Secrets
Worker → Settings → Variables and Secrets → add each as type **Secret**:

| Service | What for | Secrets |
| --- | --- | --- |
| — | Admin endpoints | `ADMIN_TOKEN` (any long random string) |
| [Resend](https://resend.com) | Email. Add domain `leftovertagalerts.com`; use the Cloudflare auto-configure button for DNS. | `RESEND_API_KEY` |
| [Twilio](https://twilio.com) | Texts. Buy a number, complete A2P 10DLC registration (use `https://leftovertagalerts.com/privacy` and `/terms` in the campaign). Incoming-message webhook: `https://leftovertagalerts.com/api/sms/inbound`. | `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_FROM_NUMBER` |
| Stripe | Product "Instant Tag Alerts", $4.99/month. Webhook `https://leftovertagalerts.com/api/stripe/webhook` for `checkout.session.completed`, `customer.subscription.updated`, `customer.subscription.deleted`. Turn on the customer billing portal. | `STRIPE_SECRET_KEY`, `STRIPE_PRICE_ID`, `STRIPE_WEBHOOK_SECRET` |

Without these keys the worker still runs and logs "[dry-run] would email/text" instead of sending.

### 4. Email addresses
Alerts send from `alerts@leftovertagalerts.com` (Resend handles this). The site lists `support@leftovertagalerts.com` for contact; set up receiving with Cloudflare Email Routing (free) to forward it to your inbox.

## Embedding the form on other sites

Sites listed in `EMBED_ORIGINS` (`wrangler.toml`; currently hornandfin.com and landownertagauctions.com) can show the sign-up form. See `embed-snippet.html`.

## Admin

```
curl -H "Authorization: Bearer $ADMIN_TOKEN" https://leftovertagalerts.com/admin/sources   # health of every source
curl -H "Authorization: Bearer $ADMIN_TOKEN" https://leftovertagalerts.com/admin/stats     # subscriber counts
curl -X POST -H "Authorization: Bearer $ADMIN_TOKEN" "https://leftovertagalerts.com/admin/check?id=ut-remaining"  # check one now
```

Watch `fail_count` and `last_status`. A table source that keeps logging "falling back to change detection" needs its `parser_config` column names matched to the live page. To add or fix a source, edit `migrations/0002_sources.sql` and run `npm run db:seed` (keeps each source's history).

## Local development

```
npx wrangler d1 execute leftover-tag-alerts --local --file=migrations/0001_init.sql
npx wrangler d1 execute leftover-tag-alerts --local --file=migrations/0002_sources.sql
npm run dev        # then: curl "localhost:8787/__scheduled?cron=*/15+*+*+*+*"
npm test
```

## Compliance

- Email: double opt-in, one-click unsubscribe headers, business name and mailing address in every footer (CAN-SPAM).
- Texts: paid users opt in with an explicit consent checkbox, logged with a timestamp; STOP is honored by Twilio and in the database; privacy policy carries the carrier-required SMS language (TCPA / A2P 10DLC).
- Every alert links to the state agency; the service never sells or holds tags. The privacy policy and terms are plain-language starting points, not legal review.
