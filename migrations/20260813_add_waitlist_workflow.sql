-- Aplicar uma única vez no banco D1 flowlive-public-leads.
ALTER TABLE waitlist_leads ADD COLUMN lead_status TEXT NOT NULL DEFAULT 'new'
  CHECK (lead_status IN ('new', 'contacted', 'diagnosis', 'qualified', 'onboarding', 'lost'));
ALTER TABLE waitlist_leads ADD COLUMN owner TEXT;
ALTER TABLE waitlist_leads ADD COLUMN priority TEXT NOT NULL DEFAULT 'normal'
  CHECK (priority IN ('low', 'normal', 'high', 'urgent'));
ALTER TABLE waitlist_leads ADD COLUMN next_contact_at TEXT;
ALTER TABLE waitlist_leads ADD COLUMN notes TEXT;

CREATE INDEX IF NOT EXISTS idx_waitlist_leads_workflow
  ON waitlist_leads (lead_status, priority, next_contact_at);
