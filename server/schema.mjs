// Tables for accounts, names, sessions, orders and reminder devices.
// An account without an email is a browser notebook: it was created when
// someone saved their first order without signing up. Signing up later adds
// an email (or Google) to the same account.
// The same statements live in migrations/0002_accounts.sql; the Worker also
// runs them once per start so a deploy works even if the migration step
// was skipped. Every statement is safe to repeat.
export const SCHEMA = [
  `CREATE TABLE IF NOT EXISTS accounts (
    id TEXT PRIMARY KEY,
    email TEXT UNIQUE,
    password_hash TEXT,
    google_sub TEXT UNIQUE,
    created_at INTEGER NOT NULL,
    last_active INTEGER NOT NULL DEFAULT 0
  )`,
  `CREATE INDEX IF NOT EXISTS idx_accounts_unregistered ON accounts(last_active) WHERE email IS NULL`,
  `CREATE TABLE IF NOT EXISTS members (
    id TEXT PRIMARY KEY,
    account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    created_at INTEGER NOT NULL
  )`,
  `CREATE UNIQUE INDEX IF NOT EXISTS idx_members_account_name ON members(account_id, name)`,
  `CREATE TABLE IF NOT EXISTS auth_sessions (
    token_hash TEXT PRIMARY KEY,
    account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
    member_id TEXT REFERENCES members(id) ON DELETE SET NULL,
    merge_from TEXT,
    created_at INTEGER NOT NULL,
    expires_at INTEGER NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS idx_auth_sessions_account ON auth_sessions(account_id)`,
  `CREATE TABLE IF NOT EXISTS auth_attempts (
    key_hash TEXT PRIMARY KEY,
    attempts INTEGER NOT NULL,
    first_attempt INTEGER NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS shop_orders (
    id TEXT PRIMARY KEY,
    account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
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
    created_by TEXT NOT NULL DEFAULT '',
    updated_by TEXT NOT NULL DEFAULT '',
    sent_by TEXT,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    sent_at INTEGER,
    version INTEGER NOT NULL DEFAULT 1
  )`,
  `CREATE INDEX IF NOT EXISTS idx_shop_orders_account ON shop_orders(account_id, status, ship_date)`,
  `CREATE TABLE IF NOT EXISTS push_devices (
    endpoint TEXT PRIMARY KEY,
    account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
    subscription TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    last_sent_date TEXT,
    failures INTEGER NOT NULL DEFAULT 0
  )`,
  `CREATE INDEX IF NOT EXISTS idx_push_devices_account ON push_devices(account_id)`
];

// A flag (not a shared promise): Workers must not await I/O started by
// another request. Two requests racing here both run harmless IF NOT EXISTS.
let schemaReady = false;

export async function ensureSchema(db) {
  if (schemaReady) return;
  await db.batch(SCHEMA.map(sql => db.prepare(sql)));
  schemaReady = true;
}
