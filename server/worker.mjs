import {buildPushPayload} from '@block65/webcrypto-web-push';
import {todayKey, validateOrder} from '../public/core.mjs';
import {ensureSchema} from './schema.mjs';
import {
  SESSION_MS, UserError, clearOauthCookie, clearSessionCookie, finishGoogle, googleReady, hashPasswordKey, json,
  normalizeEmail, normalizeMemberName, publicRedirect, randomToken, readJson, readSessionToken, redirect, sameOrigin,
  sessionCookie, sha256Hex, startGoogle, validPasswordKey, verifyPasswordKey
} from './auth.mjs';

const MAX_MEMBERS = 30;
const MAX_ORDERS = 20000;
const MAX_DEVICES = 30;
const REMINDER_BATCH = 15;
const LOGIN_WINDOW = 15 * 60000;
const HOUR = 60 * 60000;
const DAY = 86400000;
const UNREGISTERED_KEEP = 180 * DAY;

const error = (message, status = 400, code = undefined) => json(code ? {error: message, code} : {error: message}, status);
const isUUID = value => typeof value === 'string' && /^[a-f\d]{8}-[a-f\d]{4}-4[a-f\d]{3}-[89ab][a-f\d]{3}-[a-f\d]{12}$/i.test(value);
const validVersion = value => Number.isSafeInteger(value) && value > 0;
const clientIp = request => request.headers.get('CF-Connecting-IP') || 'local';
const pushReady = env => Boolean(env.VAPID_PUBLIC_KEY && env.VAPID_PRIVATE_KEY && env.VAPID_SUBJECT);
const isUniqueError = err => /UNIQUE/i.test(String(err?.message || ''));

function withCookies(response, ...cookies) {
  for (const cookie of cookies) if (cookie) response.headers.append('Set-Cookie', cookie);
  return response;
}

export function toOrder(row) {
  return {
    id: row.id,
    customer: row.customer,
    product: row.product,
    priceCents: row.price_cents,
    region: row.region,
    address: row.address,
    phone: row.phone,
    shipDate: row.ship_date,
    deliveryTime: row.delivery_time,
    notes: row.notes,
    status: row.status,
    createdBy: row.created_by,
    updatedBy: row.updated_by,
    sentBy: row.sent_by,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    sentAt: row.sent_at,
    version: row.version
  };
}

function checkedOrder(input) {
  try {
    return validateOrder(input);
  } catch (err) {
    throw new UserError(err.message);
  }
}

// ---- Rate limits ----

async function attempts(env, key, limit, windowMs) {
  const keyHash = await sha256Hex('attempt:' + key);
  const row = await env.DB.prepare('SELECT attempts, first_attempt FROM auth_attempts WHERE key_hash = ?').bind(keyHash).first();
  return {keyHash, blocked: Boolean(row && Date.now() - row.first_attempt < windowMs && row.attempts >= limit)};
}

function countAttempt(env, keyHash, windowMs) {
  return env.DB.prepare(`INSERT INTO auth_attempts (key_hash, attempts, first_attempt) VALUES (?1, 1, ?2)
    ON CONFLICT(key_hash) DO UPDATE SET
      attempts = CASE WHEN ?2 - first_attempt >= ?3 THEN 1 ELSE attempts + 1 END,
      first_attempt = CASE WHEN ?2 - first_attempt >= ?3 THEN ?2 ELSE first_attempt END`).bind(keyHash, Date.now(), windowMs);
}

async function limitOrRefuse(env, key, limit, windowMs, message) {
  const check = await attempts(env, key, limit, windowMs);
  if (check.blocked) throw new UserError(message, 429);
  await countAttempt(env, check.keyHash, windowMs).run();
}

// ---- Sessions ----

async function createSession(env, request, accountId, mergeFrom = null) {
  const token = randomToken(32);
  const tokenHash = await sha256Hex(token);
  const now = Date.now();
  await env.DB.prepare('INSERT INTO auth_sessions (token_hash, account_id, member_id, merge_from, created_at, expires_at) VALUES (?, ?, NULL, ?, ?, ?)')
    .bind(tokenHash, accountId, mergeFrom, now, now + SESSION_MS).run();
  return {cookie: sessionCookie(request, token), token, tokenHash, expiresAt: now + SESSION_MS};
}

export async function loadSession(env, request) {
  const token = readSessionToken(request);
  if (!token) return null;
  const tokenHash = await sha256Hex(token);
  const row = await env.DB.prepare(`SELECT s.account_id, s.member_id, s.merge_from, s.expires_at, a.email, a.last_active,
      a.password_hash IS NOT NULL AS has_password, a.google_sub IS NOT NULL AS has_google, m.name AS member_name
    FROM auth_sessions s
    JOIN accounts a ON a.id = s.account_id
    LEFT JOIN members m ON m.id = s.member_id
    WHERE s.token_hash = ?`).bind(tokenHash).first();
  if (!row || row.expires_at <= Date.now()) return null;
  return {
    token,
    tokenHash,
    accountId: row.account_id,
    email: row.email,
    guest: !row.email,
    hasPassword: Boolean(row.has_password),
    hasGoogle: Boolean(row.has_google),
    member: row.member_id && row.member_name ? {id: row.member_id, name: row.member_name} : null,
    mergeFrom: row.merge_from,
    lastActive: row.last_active,
    expiresAt: row.expires_at
  };
}

async function sessionPayload(env, session) {
  const {results} = await env.DB.prepare('SELECT id, name FROM members WHERE account_id = ? ORDER BY created_at, name').bind(session.accountId).all();
  let guestOrders = 0;
  if (session.mergeFrom) {
    const row = await env.DB.prepare(`SELECT COUNT(o.id) AS total FROM accounts a LEFT JOIN shop_orders o ON o.account_id = a.id
      WHERE a.id = ? AND a.email IS NULL`).bind(session.mergeFrom).first();
    guestOrders = row?.total || 0;
  }
  return {
    authenticated: true,
    account: {email: session.email, guest: session.guest, hasPassword: session.hasPassword, hasGoogle: session.hasGoogle},
    members: results,
    member: session.member,
    guestOrders
  };
}

// A browser notebook: an account with no email, opened by this browser's cookie.
async function createBrowserNotebook(env, request) {
  await limitOrRefuse(env, 'notebook:' + clientIp(request), 30, HOUR, 'ამ ქსელიდან ბევრი ახალი რვეული შეიქმნა. სცადე ერთ საათში.');
  const id = crypto.randomUUID();
  const now = Date.now();
  await env.DB.prepare('INSERT INTO accounts (id, email, password_hash, google_sub, created_at, last_active) VALUES (?, NULL, NULL, NULL, ?, ?)').bind(id, now, now).run();
  const created = await createSession(env, request, id);
  return {
    cookie: created.cookie,
    session: {token: created.token, tokenHash: created.tokenHash, accountId: id, email: null, guest: true, hasPassword: false, hasGoogle: false, member: null, mergeFrom: null, lastActive: now, expiresAt: created.expiresAt}
  };
}

// Registered accounts are shared by a team, so each change names its author.
function authorOf(session) {
  if (session.guest) return session.member?.name || '';
  if (!session.member) throw new UserError('ჯერ აირჩიე, ვინ ხარ.', 409, 'member-required');
  return session.member.name;
}

function passwordKeyFrom(input) {
  if (!validPasswordKey(input.key)) throw new UserError('პაროლი ვერ დამუშავდა. განაახლე გვერდი და სცადე ხელახლა.');
  return input.key;
}

// When someone signs in to an existing account from a browser that already
// has its own notebook, that notebook is kept aside and offered for merging.
async function setAsideBrowserNotebook(env, current, targetAccountId) {
  if (!current?.guest || current.accountId === targetAccountId) return null;
  await env.DB.prepare('DELETE FROM auth_sessions WHERE token_hash = ?').bind(current.tokenHash).run();
  const row = await env.DB.prepare('SELECT COUNT(*) AS total FROM shop_orders WHERE account_id = ?').bind(current.accountId).first();
  if (row.total > 0) return current.accountId;
  await env.DB.prepare('DELETE FROM accounts WHERE id = ? AND email IS NULL').bind(current.accountId).run();
  return null;
}

// ---- Account routes ----

async function register(request, env) {
  const input = await readJson(request);
  const email = normalizeEmail(input.email);
  const key = passwordKeyFrom(input);
  await limitOrRefuse(env, 'register:' + clientIp(request), 10, HOUR, 'ამ ქსელიდან ბევრი ექაუნთი შეიქმნა. სცადე ერთ საათში.');
  const existing = await env.DB.prepare('SELECT password_hash FROM accounts WHERE email = ?').bind(email).first();
  if (existing) {
    return error(existing.password_hash
      ? 'ეს ელფოსტა უკვე რეგისტრირებულია. შედი შენი პაროლით.'
      : 'ეს ელფოსტა უკვე რეგისტრირებულია Google-ით. დააჭირე „Google-ით შესვლას“.', 409, 'email-exists');
  }
  const passwordHash = await hashPasswordKey(key);
  const current = await loadSession(env, request);
  let accountId = null;
  try {
    if (current?.guest) {
      // Signing up keeps this browser's notebook: it simply gets an email.
      const result = await env.DB.prepare('UPDATE accounts SET email = ?, password_hash = ?, last_active = ? WHERE id = ? AND email IS NULL')
        .bind(email, passwordHash, Date.now(), current.accountId).run();
      if (result.meta.changes) accountId = current.accountId;
    }
    if (!accountId) {
      accountId = crypto.randomUUID();
      await env.DB.prepare('INSERT INTO accounts (id, email, password_hash, google_sub, created_at, last_active) VALUES (?, ?, ?, NULL, ?, ?)')
        .bind(accountId, email, passwordHash, Date.now(), Date.now()).run();
    }
  } catch (err) {
    if (isUniqueError(err)) return error('ეს ელფოსტა უკვე რეგისტრირებულია. შედი შენი პაროლით.', 409, 'email-exists');
    throw err;
  }
  if (current) await env.DB.prepare('DELETE FROM auth_sessions WHERE token_hash = ?').bind(current.tokenHash).run();
  const created = await createSession(env, request, accountId);
  const session = {accountId, email, guest: false, hasPassword: true, hasGoogle: Boolean(current?.guest && current.hasGoogle), member: null, mergeFrom: null, tokenHash: created.tokenHash};
  return withCookies(json(await sessionPayload(env, session), 201), created.cookie);
}

async function login(request, env) {
  const input = await readJson(request);
  const email = normalizeEmail(input.email);
  const key = passwordKeyFrom(input);
  const ip = clientIp(request);
  const pair = await attempts(env, `login:${ip}:${email}`, 10, LOGIN_WINDOW);
  const wide = await attempts(env, `login-ip:${ip}`, 40, LOGIN_WINDOW);
  if (pair.blocked || wide.blocked) return error('ბევრი მცდელობაა. სცადე 15 წუთში.', 429);
  const account = await env.DB.prepare('SELECT id, email, password_hash, google_sub FROM accounts WHERE email = ?').bind(email).first();
  if (!account?.password_hash || !await verifyPasswordKey(key, account.password_hash)) {
    await env.DB.batch([countAttempt(env, pair.keyHash, LOGIN_WINDOW), countAttempt(env, wide.keyHash, LOGIN_WINDOW)]);
    if (account && !account.password_hash) return error('ამ ელფოსტით Google-ით ხარ რეგისტრირებული. დააჭირე „Google-ით შესვლას“.', 401, 'google-only');
    return error('ელფოსტა ან პაროლი არასწორია.', 401, 'wrong-password');
  }
  await env.DB.prepare('DELETE FROM auth_attempts WHERE key_hash = ?').bind(pair.keyHash).run();
  const current = await loadSession(env, request);
  const mergeFrom = await setAsideBrowserNotebook(env, current, account.id);
  if (current && !current.guest) await env.DB.prepare('DELETE FROM auth_sessions WHERE token_hash = ?').bind(current.tokenHash).run();
  const created = await createSession(env, request, account.id, mergeFrom);
  const session = {accountId: account.id, email: account.email, guest: false, hasPassword: true, hasGoogle: Boolean(account.google_sub), member: null, mergeFrom, tokenHash: created.tokenHash};
  return withCookies(json(await sessionPayload(env, session)), created.cookie);
}

async function mergeBrowserNotebook(env, session, keep) {
  if (!session.mergeFrom) return json({moved: 0});
  const guest = await env.DB.prepare('SELECT id FROM accounts WHERE id = ? AND email IS NULL').bind(session.mergeFrom).first();
  const statements = [env.DB.prepare('UPDATE auth_sessions SET merge_from = NULL WHERE token_hash = ?').bind(session.tokenHash)];
  let moved = 0;
  if (guest && keep) {
    const counts = await env.DB.prepare(`SELECT
        (SELECT COUNT(*) FROM shop_orders WHERE account_id = ?1) AS incoming,
        (SELECT COUNT(*) FROM shop_orders WHERE account_id = ?2) AS present`).bind(guest.id, session.accountId).first();
    if (counts.incoming + counts.present > MAX_ORDERS) return error('შეკვეთების ლიმიტი შევსებულია. ძველი გაგზავნილი შეკვეთები წაშალე.', 409);
    const author = session.member?.name || '';
    statements.unshift(
      env.DB.prepare(`UPDATE shop_orders SET account_id = ?1,
          created_by = CASE WHEN created_by = '' THEN ?2 ELSE created_by END,
          updated_by = CASE WHEN updated_by = '' THEN ?2 ELSE updated_by END,
          sent_by = CASE WHEN status = 'sent' AND (sent_by IS NULL OR sent_by = '') THEN ?2 ELSE sent_by END
        WHERE account_id = ?3`).bind(session.accountId, author, guest.id),
      env.DB.prepare('UPDATE push_devices SET account_id = ? WHERE account_id = ?').bind(session.accountId, guest.id)
    );
    moved = counts.incoming;
  }
  if (guest) statements.push(env.DB.prepare('DELETE FROM accounts WHERE id = ? AND email IS NULL').bind(guest.id));
  await env.DB.batch(statements);
  return json({moved});
}

async function addMember(request, env, session) {
  const input = await readJson(request);
  const name = normalizeMemberName(input.name);
  let member = await env.DB.prepare('SELECT id, name FROM members WHERE account_id = ? AND name = ?').bind(session.accountId, name).first();
  if (!member) {
    const count = await env.DB.prepare('SELECT COUNT(*) AS total FROM members WHERE account_id = ?').bind(session.accountId).first();
    if (count.total >= MAX_MEMBERS) return error(`სახელების სია სავსეა (მაქსიმუმ ${MAX_MEMBERS}). ზედმეტი სახელი წაშალე პარამეტრებში.`, 409);
    await env.DB.prepare('INSERT INTO members (id, account_id, name, created_at) VALUES (?, ?, ?, ?) ON CONFLICT(account_id, name) DO NOTHING')
      .bind(crypto.randomUUID(), session.accountId, name, Date.now()).run();
    member = await env.DB.prepare('SELECT id, name FROM members WHERE account_id = ? AND name = ?').bind(session.accountId, name).first();
  }
  if (input.select === true) {
    await env.DB.prepare('UPDATE auth_sessions SET member_id = ? WHERE token_hash = ?').bind(member.id, session.tokenHash).run();
    session.member = member;
  }
  return json({...await sessionPayload(env, session), added: member}, 201);
}

async function selectMember(request, env, session) {
  const input = await readJson(request);
  if (!isUUID(input.memberId)) return error('სახელი ვერ მოიძებნა.', 404);
  const member = await env.DB.prepare('SELECT id, name FROM members WHERE id = ? AND account_id = ?').bind(input.memberId, session.accountId).first();
  if (!member) return error('ეს სახელი სიიდან წაშლილია. აირჩიე სხვა ან დაამატე თავიდან.', 404);
  await env.DB.prepare('UPDATE auth_sessions SET member_id = ? WHERE token_hash = ?').bind(member.id, session.tokenHash).run();
  session.member = member;
  return json(await sessionPayload(env, session));
}

async function removeMember(env, session, id) {
  if (!isUUID(id)) return error('სახელი ვერ მოიძებნა.', 404);
  await env.DB.prepare('DELETE FROM members WHERE id = ? AND account_id = ?').bind(id, session.accountId).run();
  if (session.member?.id === id) session.member = null;
  return json(await sessionPayload(env, session));
}

// ---- Orders ----

const orderRow = (env, accountId, id) => env.DB.prepare('SELECT * FROM shop_orders WHERE id = ? AND account_id = ?').bind(id, accountId).first();

async function createOrder(request, env, session) {
  const input = await readJson(request);
  if (!isUUID(input.id)) return error('შეკვეთის ნომერი არასწორია.');
  const order = checkedOrder(input);
  let cookie = null;
  if (!session) ({session, cookie} = await createBrowserNotebook(env, request));
  const author = authorOf(session);
  const existing = await orderRow(env, session.accountId, input.id);
  if (existing) return withCookies(json({order: toOrder(existing)}), cookie);
  const count = await env.DB.prepare('SELECT COUNT(*) AS total FROM shop_orders WHERE account_id = ?').bind(session.accountId).first();
  if (count.total >= MAX_ORDERS) return error('შეკვეთების ლიმიტი შევსებულია. ძველი გაგზავნილი შეკვეთები წაშალე.', 409);
  const now = Date.now();
  await env.DB.prepare(`INSERT INTO shop_orders (id, account_id, customer, product, price_cents, region, address, phone, ship_date,
      delivery_time, notes, created_by, updated_by, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(id) DO NOTHING`)
    .bind(input.id, session.accountId, order.customer, order.product, order.priceCents, order.region, order.address, order.phone,
      order.shipDate, order.deliveryTime, order.notes, author, author, now, now).run();
  const saved = await orderRow(env, session.accountId, input.id);
  if (!saved) return error('შეკვეთა ვერ შეინახა. სცადე ხელახლა.', 409);
  return withCookies(json({order: toOrder(saved)}, 201), cookie);
}

async function changeOrder(request, env, session, id, statusRoute) {
  if (!isUUID(id)) return error('შეკვეთა ვერ მოიძებნა.', 404);
  const input = await readJson(request);
  if (!validVersion(input.version)) return error('განაახლე შეკვეთა და სცადე ხელახლა.');
  const method = request.method;
  let result;
  if (method === 'PUT' && !statusRoute) {
    const author = authorOf(session);
    const order = checkedOrder(input);
    result = await env.DB.prepare(`UPDATE shop_orders SET customer = ?, product = ?, price_cents = ?, region = ?, address = ?, phone = ?,
        ship_date = ?, delivery_time = ?, notes = ?, updated_by = ?, updated_at = ?, version = version + 1
      WHERE id = ? AND account_id = ? AND version = ?`)
      .bind(order.customer, order.product, order.priceCents, order.region, order.address, order.phone, order.shipDate,
        order.deliveryTime, order.notes, author, Date.now(), id, session.accountId, input.version).run();
  } else if (method === 'PATCH' && statusRoute) {
    if (!['pending', 'sent'].includes(input.status)) return error('სტატუსი არასწორია.');
    const author = authorOf(session);
    const sent = input.status === 'sent';
    result = await env.DB.prepare(`UPDATE shop_orders SET status = ?, sent_at = ?, sent_by = ?, updated_by = ?, updated_at = ?, version = version + 1
      WHERE id = ? AND account_id = ? AND version = ?`)
      .bind(input.status, sent ? Date.now() : null, sent ? author : null, author, Date.now(), id, session.accountId, input.version).run();
  } else if (method === 'DELETE' && !statusRoute) {
    authorOf(session);
    result = await env.DB.prepare('DELETE FROM shop_orders WHERE id = ? AND account_id = ? AND version = ?').bind(id, session.accountId, input.version).run();
  } else {
    return error('მოქმედება არ არის მხარდაჭერილი.', 405);
  }
  if (!result.meta.changes) {
    if (!await orderRow(env, session.accountId, id)) return error('შეკვეთა უკვე წაშლილია.', 404);
    return error('შეკვეთა სხვა მოწყობილობაზე შეიცვალა. გადახედე ახალ ინფორმაციას და სცადე ხელახლა.', 409);
  }
  if (method === 'DELETE') return json({ok: true});
  return json({order: toOrder(await orderRow(env, session.accountId, id))});
}

// ---- Daily reminders (Web Push) ----

export function validateSubscription(input) {
  if (!input || typeof input.endpoint !== 'string' || input.endpoint.length > 2048) throw new UserError('შეტყობინების მისამართი არასწორია.');
  let url;
  try { url = new URL(input.endpoint); } catch { throw new UserError('შეტყობინების მისამართი არასწორია.'); }
  const host = url.hostname;
  const allowed = host === 'fcm.googleapis.com' || host === 'updates.push.services.mozilla.com' || host.endsWith('.push.services.mozilla.com')
    || host.endsWith('.push.apple.com') || host === 'push.apple.com' || host.endsWith('.notify.windows.com');
  if (url.protocol !== 'https:' || url.port || url.username || url.password || !allowed) throw new UserError('შეტყობინების სერვისი არ არის მხარდაჭერილი.');
  for (const [key, length] of [['p256dh', 65], ['auth', 16]]) {
    const value = input.keys?.[key];
    if (typeof value !== 'string' || !/^[\w-]+={0,2}$/.test(value) || value.length > 100) throw new UserError('შეტყობინების გასაღები არასწორია.');
    let bytes;
    try { bytes = Uint8Array.from(atob(value.replace(/-/g, '+').replace(/_/g, '/')), char => char.charCodeAt(0)); } catch { bytes = null; }
    if (!bytes || bytes.length !== length || (key === 'p256dh' && bytes[0] !== 4)) throw new UserError('შეტყობინების გასაღები არასწორია.');
  }
  return {endpoint: input.endpoint, expirationTime: null, keys: {p256dh: input.keys.p256dh, auth: input.keys.auth}};
}

export async function sendPush(env, subscription, payload) {
  const init = await buildPushPayload({data: JSON.stringify(payload), options: {ttl: 14400}}, subscription,
    {subject: env.VAPID_SUBJECT, publicKey: env.VAPID_PUBLIC_KEY, privateKey: env.VAPID_PRIVATE_KEY});
  return (await fetch(subscription.endpoint, {...init, redirect: 'error', signal: AbortSignal.timeout(10000)})).status;
}

// Runs every 5 minutes from 12:00 to 12:55 Tbilisi time. Each run handles a
// small batch so the free plan's per-run limits are never reached.
export async function sendDailyReminders(env, scheduledTime = Date.now(), sender = sendPush) {
  if (!env.DB) return {sent: 0, reason: 'not-configured'};
  await ensureSchema(env.DB);
  const now = Date.now();
  const housekeeping = [
    env.DB.prepare('DELETE FROM auth_sessions WHERE expires_at < ?').bind(now),
    env.DB.prepare('DELETE FROM auth_attempts WHERE first_attempt < ?').bind(now - DAY),
    // Browser notebooks nobody has opened for half a year (never signed up).
    env.DB.prepare('DELETE FROM accounts WHERE email IS NULL AND last_active < ?').bind(now - UNREGISTERED_KEEP)
  ];
  if (!pushReady(env)) {
    await env.DB.batch(housekeeping);
    return {sent: 0, reason: 'not-configured'};
  }
  const day = todayKey(new Date(scheduledTime));
  const {results} = await env.DB.prepare(`SELECT d.endpoint, d.subscription, d.failures, c.total
    FROM push_devices d
    JOIN (SELECT account_id, COUNT(*) AS total FROM shop_orders WHERE status = 'pending' AND ship_date = ?1 GROUP BY account_id) c
      ON c.account_id = d.account_id
    WHERE d.last_sent_date IS NULL OR d.last_sent_date != ?1
    ORDER BY d.created_at LIMIT ?2`).bind(day, REMINDER_BATCH).all();
  const updates = [];
  let sent = 0;
  for (const row of results) {
    let status = 0;
    try {
      status = await sender(env, JSON.parse(row.subscription), {
        title: 'დღევანდელი შეკვეთები',
        body: `დღეს ${row.total} შეკვეთა გაქვს გასაგზავნი.`,
        url: '/?filter=today',
        tag: 'orders-' + day
      });
    } catch {
      console.error('Push delivery failed');
    }
    if (status >= 200 && status < 300) {
      updates.push(env.DB.prepare('UPDATE push_devices SET last_sent_date = ?, failures = 0 WHERE endpoint = ?').bind(day, row.endpoint));
      sent++;
    } else if (status === 404 || status === 410 || row.failures >= 9) {
      updates.push(env.DB.prepare('DELETE FROM push_devices WHERE endpoint = ?').bind(row.endpoint));
    } else {
      updates.push(env.DB.prepare('UPDATE push_devices SET last_sent_date = ?, failures = failures + 1 WHERE endpoint = ?').bind(day, row.endpoint));
      if (status) console.error('Push rejected', status);
    }
  }
  await env.DB.batch([...updates, ...housekeeping]);
  return {sent, checked: results.length};
}

async function saveSubscription(request, env, session) {
  if (!pushReady(env)) return error('შეხსენება ჯერ არ არის გამართული.', 503);
  const subscription = validateSubscription(await readJson(request));
  let cookie = null;
  if (!session) ({session, cookie} = await createBrowserNotebook(env, request));
  const existing = await env.DB.prepare('SELECT account_id FROM push_devices WHERE endpoint = ?').bind(subscription.endpoint).first();
  if (existing?.account_id !== session.accountId) {
    const total = await env.DB.prepare('SELECT COUNT(*) AS total FROM push_devices WHERE account_id = ?').bind(session.accountId).first();
    if (total.total >= MAX_DEVICES) return error('შეხსენება უკვე ბევრ მოწყობილობაზეა ჩართული. გამორთე ძველ მოწყობილობაზე.', 409);
  }
  await env.DB.prepare(`INSERT INTO push_devices (endpoint, account_id, subscription, created_at) VALUES (?, ?, ?, ?)
    ON CONFLICT(endpoint) DO UPDATE SET subscription = excluded.subscription, account_id = excluded.account_id`)
    .bind(subscription.endpoint, session.accountId, JSON.stringify(subscription), Date.now()).run();
  return withCookies(json({ok: true}), cookie);
}

async function testPush(request, env, session) {
  const input = await readJson(request);
  if (typeof input.endpoint !== 'string') return error('შეტყობინების მისამართი არასწორია.');
  const row = await env.DB.prepare('SELECT subscription FROM push_devices WHERE endpoint = ? AND account_id = ?').bind(input.endpoint, session.accountId).first();
  if (!row) return error('ჯერ ჩართე შეხსენება.', 404);
  const status = await sendPush(env, JSON.parse(row.subscription), {
    title: 'შეხსენება მუშაობს',
    body: 'დღევანდელი გასაგზავნი შეკვეთების შეხსენება მოვა 12:00-ზე.',
    tag: 'orders-test'
  });
  if (status >= 200 && status < 300) return json({ok: true});
  if (status === 404 || status === 410) await env.DB.prepare('DELETE FROM push_devices WHERE endpoint = ?').bind(input.endpoint).run();
  return error('შეტყობინება ვერ გაიგზავნა. გამორთე შეხსენება და ხელახლა ჩართე.', 502);
}

// ---- Router ----

async function handleApi(request, env) {
  const url = new URL(request.url);
  const path = url.pathname;
  const method = request.method;
  if (!sameOrigin(request)) return error('ამ მოთხოვნის შესრულება დაუშვებელია.', 403);

  if (path === '/api/config' && method === 'GET') {
    return json({googleReady: googleReady(env), pushReady: pushReady(env), pushPublicKey: env.VAPID_PUBLIC_KEY || null});
  }
  if (path === '/api/register' && method === 'POST') return register(request, env);
  if (path === '/api/login' && method === 'POST') return login(request, env);
  if (path === '/api/logout' && method === 'POST') {
    const token = readSessionToken(request);
    if (token) await env.DB.prepare('DELETE FROM auth_sessions WHERE token_hash = ?').bind(await sha256Hex(token)).run();
    return json({ok: true}, 200, {'Set-Cookie': clearSessionCookie(request)});
  }

  const session = await loadSession(env, request);

  if (path === '/api/session' && method === 'GET') {
    if (!session) return json({authenticated: false}, 200, readSessionToken(request) ? {'Set-Cookie': clearSessionCookie(request)} : {});
    const now = Date.now();
    const headers = {};
    if (session.expiresAt - now < SESSION_MS - DAY) {
      await env.DB.prepare('UPDATE auth_sessions SET expires_at = ? WHERE token_hash = ?').bind(now + SESSION_MS, session.tokenHash).run();
      headers['Set-Cookie'] = sessionCookie(request, session.token);
    }
    if (now - session.lastActive > DAY) await env.DB.prepare('UPDATE accounts SET last_active = ? WHERE id = ?').bind(now, session.accountId).run();
    return json(await sessionPayload(env, session), 200, headers);
  }
  // Saving a first order or turning on reminders creates this browser's notebook.
  if (path === '/api/orders' && method === 'POST') return createOrder(request, env, session);
  if (path === '/api/subscriptions' && method === 'POST') return saveSubscription(request, env, session);
  if (path === '/api/orders' && method === 'GET' && !session) return json({orders: []});

  if (!session) return error('შედი შენს ექაუნთში.', 401, 'signed-out');

  if (path === '/api/members' && method === 'POST') return addMember(request, env, session);
  const memberMatch = path.match(/^\/api\/members\/([^/]+)$/);
  if (memberMatch && method === 'DELETE') return removeMember(env, session, memberMatch[1]);
  if (path === '/api/session/member' && method === 'PUT') return selectMember(request, env, session);
  if (path === '/api/account/merge' && method === 'POST') return mergeBrowserNotebook(env, session, (await readJson(request)).keep === true);
  if (path === '/api/account/password' && method === 'POST') {
    if (session.guest) return error('პაროლის დასაყენებლად ჯერ დარეგისტრირდი.', 400);
    const key = passwordKeyFrom(await readJson(request));
    await env.DB.prepare('UPDATE accounts SET password_hash = ? WHERE id = ?').bind(await hashPasswordKey(key), session.accountId).run();
    session.hasPassword = true;
    return json(await sessionPayload(env, session));
  }
  if (path === '/api/account/sign-out-others' && method === 'POST') {
    const result = await env.DB.prepare('DELETE FROM auth_sessions WHERE account_id = ? AND token_hash != ?').bind(session.accountId, session.tokenHash).run();
    return json({ok: true, signedOut: result.meta.changes || 0});
  }

  if (path === '/api/orders' && method === 'GET') {
    const {results} = await env.DB.prepare('SELECT * FROM shop_orders WHERE account_id = ? ORDER BY created_at DESC').bind(session.accountId).all();
    return json({orders: results.map(toOrder)});
  }
  const orderMatch = path.match(/^\/api\/orders\/([^/]+?)(\/status)?$/);
  if (orderMatch) return changeOrder(request, env, session, orderMatch[1], Boolean(orderMatch[2]));

  if (path === '/api/subscriptions' && method === 'DELETE') {
    const input = await readJson(request);
    if (typeof input.endpoint !== 'string') return error('შეტყობინების მისამართი არასწორია.');
    await env.DB.prepare('DELETE FROM push_devices WHERE endpoint = ? AND account_id = ?').bind(input.endpoint, session.accountId).run();
    return json({ok: true});
  }
  if (path === '/api/push/test' && method === 'POST') return testPush(request, env, session);
  return error('მოთხოვნა ვერ მოიძებნა.', 404);
}

async function handleAuth(request, env) {
  const url = new URL(request.url);
  if (request.method !== 'GET') return new Response('Method not allowed', {status: 405});
  if (url.pathname === '/auth/google') {
    if (!googleReady(env)) return redirect('/?auth=google-off');
    return startGoogle(request, env, url.searchParams.get('mode') === 'link' ? 'link' : 'login');
  }
  if (url.pathname !== '/auth/google/callback') return new Response('Not found', {status: 404});
  const clear = clearOauthCookie(request);
  if (!googleReady(env)) return redirect('/?auth=google-off', {'Set-Cookie': clear});
  const result = await finishGoogle(request, env);
  if (result.error) return redirect('/?auth=' + result.error, {'Set-Cookie': clear});
  const {profile, mode} = result;
  const current = await loadSession(env, request);
  const owner = await env.DB.prepare('SELECT id FROM accounts WHERE google_sub = ?').bind(profile.sub).first();

  if (mode === 'link' && current && !current.guest) {
    if (owner && owner.id !== current.accountId) return redirect('/?auth=google-in-use', {'Set-Cookie': clear});
    await env.DB.prepare('UPDATE accounts SET google_sub = ? WHERE id = ?').bind(profile.sub, current.accountId).run();
    return redirect('/?auth=google-linked', {'Set-Cookie': clear});
  }

  let accountId = owner?.id || null;
  let mergeFrom = null;
  if (accountId) {
    mergeFrom = await setAsideBrowserNotebook(env, current, accountId);
  } else {
    // An account that signed up with a password is never joined to a Google
    // identity automatically: the owner links Google from settings instead.
    if (await env.DB.prepare('SELECT id FROM accounts WHERE email = ?').bind(profile.email).first()) return redirect('/?auth=google-email-exists', {'Set-Cookie': clear});
    try {
      if (current?.guest) {
        const upgraded = await env.DB.prepare('UPDATE accounts SET email = ?, google_sub = ?, last_active = ? WHERE id = ? AND email IS NULL')
          .bind(profile.email, profile.sub, Date.now(), current.accountId).run();
        if (upgraded.meta.changes) accountId = current.accountId;
      }
      if (!accountId) {
        accountId = crypto.randomUUID();
        await env.DB.prepare('INSERT INTO accounts (id, email, password_hash, google_sub, created_at, last_active) VALUES (?, ?, NULL, ?, ?, ?)')
          .bind(accountId, profile.email, profile.sub, Date.now(), Date.now()).run();
      }
    } catch (err) {
      if (isUniqueError(err)) return redirect('/?auth=google-email-exists', {'Set-Cookie': clear});
      throw err;
    }
  }
  if (current) await env.DB.prepare('DELETE FROM auth_sessions WHERE token_hash = ?').bind(current.tokenHash).run();
  const created = await createSession(env, request, accountId, mergeFrom);
  return withCookies(new Response(null, {status: 302, headers: {Location: '/', 'Cache-Control': 'no-store'}}), clear, created.cookie);
}

export default {
  async fetch(request, env) {
    const moved = publicRedirect(request, env);
    if (moved) return moved;
    const url = new URL(request.url);
    const api = url.pathname.startsWith('/api/');
    const auth = url.pathname.startsWith('/auth/');
    if (!api && !auth) return env.ASSETS ? env.ASSETS.fetch(request) : new Response('Not found', {status: 404});
    try {
      if (!env.DB) return error('საიტს Cloudflare-ზე გამართვა სჭირდება.', 503);
      await ensureSchema(env.DB);
      return api ? await handleApi(request, env) : await handleAuth(request, env);
    } catch (err) {
      if (err instanceof UserError) return error(err.message, err.status, err.code);
      console.error('Request failed', err?.name, err?.message);
      if (auth) return redirect('/?auth=google-failed', {'Set-Cookie': clearOauthCookie(request)});
      return error('მოქმედება ვერ შესრულდა. სცადე ხელახლა; შევსებული ინფორმაცია შენარჩუნებულია.', 503);
    }
  },
  async scheduled(controller, env, ctx) {
    ctx.waitUntil(sendDailyReminders(env, controller.scheduledTime));
  }
};
