export interface Env {
  DB: D1Database;
  SITE_NAME: string;
  SITE_URL: string;
  API_URL: string;
  EMBED_ORIGINS?: string;
  FROM_EMAIL: string;
  CONTACT_EMAIL: string;
  BUSINESS_NAME: string;
  /** Who the site and alert emails say runs the service. */
  EMAIL_OPERATOR?: string;
  /** City shown on the website's contact sections (no street address). */
  PUBLIC_LOCATION?: string;
  /** Comma-separated emails that can open /admin/subscribers after signing in. */
  ADMIN_EMAILS?: string;
  /** Google Analytics 4 measurement ID (G-XXXXXXX). Public pages only. */
  GA_MEASUREMENT_ID?: string;
  /** TikTok Pixel ID for ad measurement. Public pages plus the post-subscribe page. */
  TIKTOK_PIXEL_ID?: string;
  BUSINESS_ADDRESS: string;
  PAID_PRICE_LABEL: string;
  /** Billing period for instant alerts: "year" or "month". */
  PAID_INTERVAL?: string;
  /** "true" to offer a free daily-email tier alongside the paid plan. */
  FREE_TIER?: string;
  INTRO_FREE?: string;
  PARTNER_URL?: string;
  USER_AGENT: string;
  /** Bright Data API key (secret) for sources whose state page blocks automated checks. */
  BRIGHTDATA_API_KEY?: string;
  /** Apify API token (secret) for sources read through the owner's Apify tasks. */
  APIFY_TOKEN?: string;
  RESEND_API_KEY?: string;
  TWILIO_ACCOUNT_SID?: string;
  TWILIO_AUTH_TOKEN?: string;
  TWILIO_FROM_NUMBER?: string;
  /** PayPal REST app for the Horn & Fin PayPal Business account (secrets). */
  PAYPAL_CLIENT_ID?: string;
  PAYPAL_SECRET?: string;
  /** "sandbox" while testing, "live" to take real payments. */
  PAYPAL_ENV?: string;
  /** Filled per request from the settings table (not Worker vars). */
  PAYMENTS_READY?: boolean;
  PAYPAL_PLAN_ID?: string;
  /** Set per request while an end-of-season sale is on: first-year price ("19.99") and the day the price goes up ("2027-03-01"). */
  SALE_PRICE?: string;
  SALE_ENDS?: string;
  ADMIN_TOKEN?: string;
}

export interface Source {
  id: string;
  state: string;
  name: string;
  url: string;
  link_url: string | null;
  format: 'html' | 'pdf' | 'csv' | 'json';
  parser: 'change' | 'table' | 'form' | 'json' | 'snapshot' | 'brightdata_pdf' | 'apify';
  parser_config: string | null;
  species: string | null;
  check_minutes: number;
  season_start: string | null;
  season_end: string | null;
  notes: string | null;
  active: number;
  last_hash: string | null;
  last_checked: string | null;
  last_changed: string | null;
  last_status: number | null;
  fail_count: number;
  last_error?: string | null;
  opening?: string | null;
  /** JSON list of busy first-come windows: [{"start":"07-16","end":"07-31","minutes":30}] */
  rush?: string | null;
}

export interface Subscriber {
  id: string;
  email: string;
  phone: string | null;
  sms_consent_at: string | null;
  tier: 'free' | 'paid';
  states: string;
  species: string;
  verified_at: string | null;
  verify_token: string;
  manage_token: string;
  stripe_customer: string | null;
  stripe_sub: string | null;
  paypal_sub?: string | null;
  /** Set when a paid plan is canceled: instant alerts continue until this time. */
  paid_until?: string | null;
  renews_at?: string | null;
  renewal_notice_for?: string | null;
  sms_stopped: number;
  unsubscribed_at: string | null;
  created_at: string;
  openings?: string;
  weapons?: string;
  sexes?: string;
  home_state?: string | null;
  page_alerts?: number;
}

export interface AlertEvent {
  id: number;
  source_id: string;
  kind: 'new_listing' | 'quantity_up' | 'page_changed';
  state: string;
  species: string | null;
  title: string;
  detail: string | null;
  link_url: string;
  created_at: string;
  opening?: string | null;
  weapon?: string | null;
  sex?: string | null;
  residency?: string | null;
}

/** One hunt inside an alert (table sources). */
export interface EventItem {
  event_id: number;
  label: string;
  species: string | null;
  quantity: number | null;
  prev_quantity: number | null;
  weapon: string | null;
  sex: string | null;
  residency: string | null;
}

/** A hunt row pulled out of a structured state page. */
export interface ParsedListing {
  key: string;
  label: string;
  species?: string;
  quantity: number | null;
  weapon?: string | null;
  sex?: string | null;
  residency?: string | null;
}

/** What a parser returns for one fetch of a source. */
export interface ParseResult {
  /** Hash of the meaningful content; a change means something moved. */
  hash: string;
  /** Present only for structured (table) sources. */
  listings?: ParsedListing[];
}
