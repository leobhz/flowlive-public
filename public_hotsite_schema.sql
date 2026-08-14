CREATE TABLE IF NOT EXISTS public_lives (
  live_id INTEGER PRIMARY KEY,
  tenant_id INTEGER NOT NULL,
  tenant_name TEXT NOT NULL,
  tenant_logo TEXT,
  title TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('scheduled','live','ended')),
  scheduled_at TEXT,
  started_at TEXT,
  ended_at TEXT,
  player_uid TEXT,
  accent_color TEXT NOT NULL DEFAULT '#F4821F',
  surface_color TEXT NOT NULL DEFAULT '#0D0D14',
  profile_avatar TEXT,
  profile_bio TEXT,
  instagram_handle TEXT,
  instagram_url TEXT,
  wallpaper_url TEXT,
  wallpaper_preset TEXT NOT NULL DEFAULT 'minimal',
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS public_products (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  public_product_id INTEGER NOT NULL,
  live_id INTEGER NOT NULL,
  name TEXT NOT NULL,
  price TEXT NOT NULL,
  image_url TEXT,
  checkout_url TEXT,
  display_order INTEGER NOT NULL DEFAULT 0,
  is_featured INTEGER NOT NULL DEFAULT 0,
  is_available INTEGER NOT NULL DEFAULT 1,
  updated_at TEXT NOT NULL,
  UNIQUE(live_id, public_product_id)
);

CREATE INDEX IF NOT EXISTS public_products_live_order_idx ON public_products(live_id, display_order);

CREATE TABLE IF NOT EXISTS public_profiles (
  public_profile_id TEXT PRIMARY KEY,
  provider TEXT NOT NULL CHECK (provider IN ('visitor','google')),
  display_name TEXT NOT NULL,
  avatar_url TEXT,
  profile_consent INTEGER NOT NULL DEFAULT 0,
  marketing_consent INTEGER NOT NULL DEFAULT 0,
  consented_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS public_sessions (
  session_id TEXT PRIMARY KEY,
  live_id INTEGER NOT NULL,
  public_profile_id TEXT,
  last_seen_at TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS public_sessions_live_idx ON public_sessions(live_id, last_seen_at);

CREATE TABLE IF NOT EXISTS public_messages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  live_id INTEGER NOT NULL,
  session_id TEXT NOT NULL,
  public_profile_id TEXT,
  display_name TEXT NOT NULL,
  avatar_url TEXT,
  message TEXT NOT NULL,
  sentiment TEXT NOT NULL DEFAULT 'neutral' CHECK (sentiment IN ('neutral','positive','negative','high_intent')),
  is_intent_to_buy INTEGER NOT NULL DEFAULT 0,
  is_approved INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS public_messages_live_created_idx ON public_messages(live_id, created_at);

CREATE TABLE IF NOT EXISTS public_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  live_id INTEGER NOT NULL,
  session_id TEXT NOT NULL,
  public_profile_id TEXT,
  event_type TEXT NOT NULL CHECK (event_type IN ('heartbeat','favorite','checkout_start','product_view','login_prompt','login_complete')),
  public_product_id INTEGER,
  utm_source TEXT,
  utm_medium TEXT,
  utm_campaign TEXT,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS public_events_live_created_idx ON public_events(live_id, created_at);

CREATE TABLE IF NOT EXISTS public_sync_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  event_id TEXT NOT NULL UNIQUE,
  received_at TEXT NOT NULL
);
