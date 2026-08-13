-- Aplicar uma única vez no banco D1 flowlive-public-leads.
-- A tabela existente já contém os campos comerciais e de consentimento.
ALTER TABLE waitlist_leads ADD COLUMN utm_source TEXT;
ALTER TABLE waitlist_leads ADD COLUMN utm_medium TEXT;
ALTER TABLE waitlist_leads ADD COLUMN utm_campaign TEXT;
ALTER TABLE waitlist_leads ADD COLUMN utm_content TEXT;
ALTER TABLE waitlist_leads ADD COLUMN utm_term TEXT;
ALTER TABLE waitlist_leads ADD COLUMN fbclid TEXT;
ALTER TABLE waitlist_leads ADD COLUMN entry_url TEXT;
ALTER TABLE waitlist_leads ADD COLUMN referrer TEXT;

CREATE INDEX IF NOT EXISTS idx_waitlist_leads_utm_campaign
  ON waitlist_leads (utm_source, utm_campaign);
