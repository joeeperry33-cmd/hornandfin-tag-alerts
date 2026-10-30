export interface Env {
  DB: D1Database;
  SITE_NAME: string;
  SITE_URL: string;
  API_URL: string;
  EMBED_ORIGINS?: string;
  FROM_EMAIL: string;
  CONTACT_EMAIL: string;
  BUSINESS_NAME: string;
  BUSINESS_ADDRESS: string;
  PAID_PRICE_LABEL: string;
  INTRO_FREE?: string;
  PARTNER_URL?: string;
  USER_AGENT: string;
  RESEND_API_KEY?: string;
  TWILIO_ACCOUNT_SID?: string;
  TWILIO_AUTH_TOKEN?: string;
  TWILIO_FROM_NUMBER?: string;
  STRIPE_SECRET_KEY?: string;
  STRIPE_PRICE_ID?: string;
  STRIPE_WEBHOOK_SECRET?: string;
  ADMIN_TOKEN?: string;
}

export interface Source {
  id: string;
  state: string;
  name: string;
  url: string;
  link_url: string | null;
  format: 'html' | 'pdf' | 'csv' | 'json';
  parser: 'change' | 'table';
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
