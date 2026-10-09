import {testOrders} from './fixtures.mjs';
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createECDH,webcrypto} from 'node:crypto';
import {buildPushPayload} from '@block65/webcrypto-web-push';
import {todayKey,dayDifference,orderGroups,parsePrice,validateOrder,validDate,georgianDate,money} from '../public/core.mjs';
import {validateSubscription,sendDailyReminders} from '../server/worker.mjs';
import {hashPasswordKey,verifyPasswordKey,profileFromIdToken,finishGoogle,publicRedirect,b64url} from '../server/auth.mjs';
test('Georgian calendar changes at Tbilisi midnight and noon is 08:00 UTC',()=>{assert.equal(todayKey(new Date('2026-10-08T19:59:59Z')),'2026-10-08');assert.equal(todayKey(new Date('2026-10-08T20:00:00Z')),'2026-10-09');assert.equal(todayKey(new Date('2026-10-09T08:00:00Z')),'2026-10-09');assert.equal(dayDifference('2026-11-01','2026-10-31'),1)});
test('dates stay Georgian without relying on browser locale support',()=>{assert.equal(georgianDate('2026-10-09',{weekday:true}),'9 ოქტომბერი · პარასკევი');assert.equal(georgianDate('2026-10-09',{year:true}),'9 ოქტომბერი 2026');assert.equal(money(8550),'85,50 ₾')});
test('today first, remaining pending newest first, sent excluded',()=>{const orders=testOrders('2026-10-09');orders.push({...orders[3],id:'overdue',shipDate:'2026-10-08',createdAt:Date.now()+1000});const groups=orderGroups(orders,'all','','2026-10-09');assert.equal(groups[0].key,'today');assert.equal(groups[0].items.length,3);assert.equal(groups[1].items[0].id,'overdue');assert.ok(groups.flatMap(g=>g.items).every(o=>o.status==='pending'));assert.equal(orderGroups(orders,'sent','','2026-10-09')[0].items.length,1);assert.equal(orderGroups(orders,'all','ნინო','2026-10-09')[0].items[0].customer,'ნინო ბერიძე')});
test('money keeps cents and validates date and phone',()=>{assert.equal(parsePrice('85,50'),8550);assert.equal(parsePrice('0'),0);assert.throws(()=>parsePrice('1.001'));assert.throws(()=>parsePrice('-5'));assert.equal(validDate('2026-02-30'),false);assert.equal(validDate('2028-02-29'),true);const order=testOrders('2026-10-09')[0];assert.equal(validateOrder(order).priceCents,8500);assert.throws(()=>validateOrder({...order,phone:'555'}));assert.throws(()=>validateOrder({...order,priceCents:85.5}))});
test('subscriptions reject private destinations and wrong encryption keys',()=>{const client=createECDH('prime256v1');client.generateKeys();const sub={endpoint:'https://fcm.googleapis.com/fcm/send/test',keys:{p256dh:client.getPublicKey().toString('base64url'),auth:Buffer.alloc(16,2).toString('base64url')}};assert.equal(validateSubscription(sub).endpoint,sub.endpoint);assert.throws(()=>validateSubscription({...sub,endpoint:'https://127.0.0.1/private'}));assert.throws(()=>validateSubscription({...sub,endpoint:'https://fcm.googleapis.com.evil.example/send'}));assert.throws(()=>validateSubscription({...sub,keys:{...sub.keys,auth:'abc'}}))});
test('push library creates Apple-compatible encrypted aes128gcm payload',async()=>{const client=createECDH('prime256v1');client.generateKeys();const server=createECDH('prime256v1');server.generateKeys();const payload=await buildPushPayload({data:JSON.stringify({title:'დღევანდელი შეკვეთები',body:'დღეს 3 შეკვეთა გაქვს გასაგზავნი.'}),options:{ttl:14400}},{endpoint:'https://web.push.apple.com/test',keys:{p256dh:client.getPublicKey().toString('base64url'),auth:Buffer.alloc(16,3).toString('base64url')}},{subject:'mailto:test@example.com',publicKey:server.getPublicKey().toString('base64url'),privateKey:server.getPrivateKey().toString('base64url')});assert.equal(new Headers(payload.headers).get('Content-Encoding'),'aes128gcm');assert.ok(new Headers(payload.headers).get('Authorization').startsWith('vapid '));assert.ok(payload.body.byteLength>100)});

function mockDB(rows) {
  const batches = [];
  return {
    batches,
    prepare(sql) {
      const statement = {sql, values: [], bind(...values) { statement.values = values; return statement; }, async all() { return {results: rows}; }, async first() { return null; }, async run() { return {meta: {changes: 1}}; }};
      return statement;
    },
    async batch(statements) {
      batches.push(statements.map(statement => ({sql: statement.sql, values: statement.values})));
      return statements.map(() => ({meta: {changes: 1}}));
    }
  };
}

const pushEnv = DB => ({DB, VAPID_PUBLIC_KEY: 'key', VAPID_PRIVATE_KEY: 'key', VAPID_SUBJECT: 'mailto:test@example.com'});

test('daily reminders: nothing due sends nothing; each account gets its own count', async () => {
  let calls = 0;
  const quiet = await sendDailyReminders(pushEnv(mockDB([])), Date.parse('2026-10-09T08:00:00Z'), async () => { calls++; return 201; });
  assert.equal(quiet.sent, 0);
  assert.equal(calls, 0);
  const db = mockDB([
    {endpoint: 'ok', subscription: '{"endpoint":"ok"}', failures: 0, total: 2},
    {endpoint: 'expired', subscription: '{"endpoint":"expired"}', failures: 0, total: 5},
    {endpoint: 'flaky', subscription: '{"endpoint":"flaky"}', failures: 1, total: 1}
  ]);
  const messages = [];
  const result = await sendDailyReminders(pushEnv(db), Date.parse('2026-10-09T08:00:00Z'), async (_env, sub, message) => {
    messages.push([sub.endpoint, message.body]);
    return sub.endpoint === 'ok' ? 201 : sub.endpoint === 'expired' ? 410 : 500;
  });
  assert.equal(result.sent, 1);
  assert.deepEqual(messages.map(([endpoint]) => endpoint), ['ok', 'expired', 'flaky']);
  assert.ok(messages.find(([endpoint]) => endpoint === 'ok')[1].includes('2 შეკვეთა'));
  assert.ok(messages.find(([endpoint]) => endpoint === 'expired')[1].includes('5 შეკვეთა'));
  const updates = db.batches.at(-1);
  assert.ok(updates.some(op => op.sql.startsWith('UPDATE push_devices SET last_sent_date = ?, failures = 0') && op.values[0] === '2026-10-09'));
  assert.ok(updates.some(op => op.sql.startsWith('DELETE FROM push_devices') && op.values[0] === 'expired'));
  assert.ok(updates.some(op => op.sql.includes('failures = failures + 1') && op.values[1] === 'flaky'), 'a failing device waits until tomorrow');
});

test('password keys are stretched with a salt and checked exactly', async () => {
  const key = b64url(crypto.getRandomValues(new Uint8Array(32)));
  const stored = await hashPasswordKey(key, 2000);
  assert.match(stored, /^pbkdf2\$2000\$/);
  assert.notEqual(stored, await hashPasswordKey(key, 2000), 'salt differs every time');
  assert.equal(await verifyPasswordKey(key, stored), true);
  assert.equal(await verifyPasswordKey(b64url(crypto.getRandomValues(new Uint8Array(32))), stored), false);
  assert.equal(await verifyPasswordKey(key, 'pbkdf2$999999999$x$y'), false);
  assert.equal(await verifyPasswordKey('short', stored), false);
});

const token = claims => ['e30', b64url(new TextEncoder().encode(JSON.stringify(claims))), 'sig'].join('.');
const goodClaims = {iss: 'https://accounts.google.com', aud: 'client-1', sub: '1234567890', email: 'Nino@Gmail.com', email_verified: true, exp: Math.floor(Date.now() / 1000) + 600, name: 'ნინო'};

test('Google identity is accepted only for this app and a verified email', () => {
  assert.deepEqual(profileFromIdToken(token(goodClaims), 'client-1'), {sub: '1234567890', email: 'nino@gmail.com', name: 'ნინო'});
  assert.throws(() => profileFromIdToken(token({...goodClaims, aud: 'other-app'}), 'client-1'));
  assert.throws(() => profileFromIdToken(token({...goodClaims, email_verified: false}), 'client-1'));
  assert.throws(() => profileFromIdToken(token({...goodClaims, iss: 'https://evil.example'}), 'client-1'));
  assert.throws(() => profileFromIdToken(token({...goodClaims, exp: Math.floor(Date.now() / 1000) - 3600}), 'client-1'));
});

test('Google callback checks the saved state and swaps the code with the secret', async () => {
  const env = {GOOGLE_CLIENT_ID: 'client-1', GOOGLE_CLIENT_SECRET: 'secret'};
  const state = 'A'.repeat(22), verifier = 'B'.repeat(43);
  const request = (query, cookie = `google_oauth=${state}.${verifier}.login`) => new Request('https://sales.pages.dev/auth/google/callback?' + query, {headers: {Cookie: cookie}});
  let sent;
  const fetcher = async (url, init) => { sent = {url, body: String(init.body)}; return Response.json({id_token: token(goodClaims)}); };
  const ok = await finishGoogle(request(`state=${state}&code=abc`), env, fetcher);
  assert.equal(ok.profile.email, 'nino@gmail.com');
  assert.equal(ok.mode, 'login');
  assert.match(sent.body, /code_verifier=B{43}/);
  assert.match(sent.body, /redirect_uri=https%3A%2F%2Fsales.pages.dev%2Fauth%2Fgoogle%2Fcallback/);
  assert.equal((await finishGoogle(request(`state=${'C'.repeat(22)}&code=abc`), env, fetcher)).error, 'google-failed');
  assert.equal((await finishGoogle(request(`state=${state}&code=abc`, ''), env, fetcher)).error, 'google-failed');
  assert.equal((await finishGoogle(request('error=access_denied'), env, fetcher)).error, 'google-cancelled');
});

test('old workers.dev address sends people to the pages.dev address', () => {
  const env = {PUBLIC_URL: 'https://sales.pages.dev'};
  const moved = publicRedirect(new Request('https://sales.example-account.workers.dev/?filter=today'), env);
  assert.equal(moved.status, 302);
  assert.equal(moved.headers.get('Location'), 'https://sales.pages.dev/?filter=today');
  assert.equal(publicRedirect(new Request('https://sales.pages.dev/api/session'), env), null);
  assert.equal(publicRedirect(new Request('http://127.0.0.1:8791/'), env), null);
});
