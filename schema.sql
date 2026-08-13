CREATE TABLE IF NOT EXISTS waitlist_leads (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  company TEXT NOT NULL,
  email TEXT NOT NULL UNIQUE,
  whatsapp TEXT NOT NULL,
  live_volume TEXT NOT NULL,
  contact_consent INTEGER NOT NULL CHECK (contact_consent IN (0, 1)),
  consent_at TEXT NOT NULL,
  source TEXT NOT NULL,
  email_status TEXT NOT NULL DEFAULT 'pending',
  email_provider_id TEXT,
  email_sent_at TEXT,
  utm_source TEXT,
  utm_medium TEXT,
  utm_campaign TEXT,
  utm_content TEXT,
  utm_term TEXT,
  fbclid TEXT,
  entry_url TEXT,
  referrer TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_waitlist_leads_created_at ON waitlist_leads (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_waitlist_leads_utm_campaign ON waitlist_leads (utm_source, utm_campaign);
