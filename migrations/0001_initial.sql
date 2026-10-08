CREATE TABLE orders (
  id TEXT PRIMARY KEY,
  customer TEXT NOT NULL,
  product TEXT NOT NULL,
  price_cents INTEGER NOT NULL CHECK(price_cents >= 0),
  region TEXT NOT NULL,
  address TEXT NOT NULL,
  phone TEXT NOT NULL,
  ship_date TEXT NOT NULL,
  delivery_time TEXT NOT NULL DEFAULT '',
  notes TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending', 'sent')),
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  sent_at INTEGER,
  version INTEGER NOT NULL DEFAULT 1
);
CREATE INDEX idx_orders_status_ship_date ON orders(status, ship_date);
CREATE TABLE sessions (
  token_hash TEXT PRIMARY KEY,
  expires_at INTEGER NOT NULL
);
CREATE TABLE login_attempts (
  ip_hash TEXT PRIMARY KEY,
  attempts INTEGER NOT NULL DEFAULT 0,
  first_attempt INTEGER NOT NULL
);
CREATE TABLE push_subscriptions (
  endpoint TEXT PRIMARY KEY,
  subscription TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  last_sent_date TEXT,
  failures INTEGER NOT NULL DEFAULT 0
);
