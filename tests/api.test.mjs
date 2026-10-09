// Runs against a local server: `npm run dev` in one window, `npm run test:api` in another.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {passwordKey} from '../public/password.mjs';
import {todayKey} from '../public/core.mjs';

const BASE = process.env.BASE_URL || 'http://127.0.0.1:8791';

// One "browser": keeps its own session cookie between calls.
function browser() {
  let cookie = '';
  return async function call(path, {method = 'GET', body, headers = {}} = {}) {
    const response = await fetch(BASE + '/api' + path, {
      method,
      headers: {'Content-Type': 'application/json', ...(cookie ? {Cookie: cookie} : {}), ...headers},
      body: body === undefined ? (method === 'GET' ? undefined : '{}') : JSON.stringify(body),
      redirect: 'manual'
    });
    const setCookie = response.headers.get('set-cookie');
    if (setCookie) {
      const match = setCookie.match(/session=([^;]*)/);
      if (match) cookie = match[1] ? `session=${match[1]}` : '';
    }
    const data = await response.json().catch(() => ({}));
    return {status: response.status, data, setCookie};
  };
}

const order = (extra = {}) => ({
  id: crypto.randomUUID(), customer: 'საცდელი კლიენტი', product: 'სუფრა', priceCents: 6000, region: 'თბილისი',
  address: 'ქუჩა 1, ბინა 2', phone: '555 12 34 56', shipDate: todayKey(), deliveryTime: '', notes: '', ...extra
});

test('a new browser starts empty and gets its own notebook on the first order', async () => {
  const first = browser();
  const second = browser();
  assert.deepEqual((await first('/session')).data, {authenticated: false});
  assert.deepEqual((await first('/orders')).data, {orders: []});

  const saved = await first('/orders', {method: 'POST', body: order({customer: 'პირველი'})});
  assert.equal(saved.status, 201);
  assert.match(saved.setCookie, /session=.+HttpOnly/);
  assert.equal(saved.data.order.createdBy, '');
  const session = (await first('/session')).data;
  assert.equal(session.authenticated, true);
  assert.equal(session.account.guest, true);
  assert.equal(session.account.email, null);

  // Another browser sees nothing of it.
  assert.deepEqual((await second('/orders')).data, {orders: []});
  await second('/orders', {method: 'POST', body: order({customer: 'მეორე'})});
  assert.deepEqual((await second('/orders')).data.orders.map(item => item.customer), ['მეორე']);
  assert.deepEqual((await first('/orders')).data.orders.map(item => item.customer), ['პირველი']);
  const firstOrder = saved.data.order;
  assert.equal((await second('/orders/' + firstOrder.id, {method: 'DELETE', body: {version: 1}})).status, 404);

  // Unregistered notebooks cannot use team features.
  assert.equal((await first('/account/password', {method: 'POST', body: {key: 'x'.repeat(43)}})).status, 400);
});

test('signing up keeps the browser notebook; names and authors after that', async () => {
  const phone = browser();
  const laptop = browser();
  const email = `owner-${Date.now()}@example.com`;
  const key = await passwordKey(email, 'correct horse 42');

  const early = order({customer: 'რეგისტრაციამდე'});
  await phone('/orders', {method: 'POST', body: early});
  const signedUp = await phone('/register', {method: 'POST', body: {email, key}});
  assert.equal(signedUp.status, 201);
  assert.equal(signedUp.data.account.guest, false);
  assert.equal(signedUp.data.account.email, email);
  assert.deepEqual((await phone('/orders')).data.orders.map(item => item.id), [early.id], 'nothing to move: same notebook');
  assert.equal((await phone('/register', {method: 'POST', body: {email, key}})).status, 409);

  // Registered accounts are shared, so writing needs a name.
  const blocked = await phone('/orders', {method: 'POST', body: order()});
  assert.equal(blocked.data.code, 'member-required');
  const nino = await phone('/members', {method: 'POST', body: {name: 'ნინო', select: true}});
  const later = order({customer: 'რეგისტრაციის მერე'});
  assert.equal((await phone('/orders', {method: 'POST', body: later})).data.order.createdBy, 'ნინო');

  // The laptop wrote one order before signing in to the same account.
  const laptopOrder = order({customer: 'ლეპტოპიდან'});
  await laptop('/orders', {method: 'POST', body: laptopOrder});
  const signedIn = await laptop('/login', {method: 'POST', body: {email, key}});
  assert.equal(signedIn.status, 200);
  assert.equal(signedIn.data.guestOrders, 1);
  assert.equal(signedIn.data.member, null);
  await laptop('/members', {method: 'POST', body: {name: 'ლევანი', select: true}});
  const merged = await laptop('/account/merge', {method: 'POST', body: {keep: true}});
  assert.equal(merged.data.moved, 1);
  const all = (await laptop('/orders')).data.orders;
  assert.equal(all.length, 3);
  assert.equal(all.find(item => item.id === laptopOrder.id).createdBy, 'ლევანი');
  assert.equal((await laptop('/session')).data.guestOrders, 0);

  // A third browser chooses not to keep its unregistered orders.
  const tablet = browser();
  await tablet('/orders', {method: 'POST', body: order({customer: 'არ მინდა'})});
  assert.equal((await tablet('/login', {method: 'POST', body: {email, key}})).data.guestOrders, 1);
  assert.equal((await tablet('/account/merge', {method: 'POST', body: {keep: false}})).data.moved, 0);
  assert.equal((await tablet('/orders')).data.orders.length, 3);

  // Edits and status changes name the person.
  const edited = await laptop('/orders/' + later.id, {method: 'PUT', body: {...later, notes: 'დაურეკეთ', version: 1}});
  assert.equal(edited.data.order.updatedBy, 'ლევანი');
  const sent = await laptop('/orders/' + later.id + '/status', {method: 'PATCH', body: {status: 'sent', version: 2}});
  assert.equal(sent.data.order.sentBy, 'ლევანი');
  assert.equal((await phone('/orders/' + later.id, {method: 'PUT', body: {...later, version: 1}})).status, 409, 'stale edit is refused');

  // Cross-site requests are refused.
  assert.equal((await phone('/orders', {method: 'POST', body: order(), headers: {Origin: 'https://evil.example'}})).status, 403);

  // Password change and signing out other devices.
  const newKey = await passwordKey(email, 'new password 2026');
  assert.equal((await phone('/account/password', {method: 'POST', body: {key: newKey}})).status, 200);
  assert.equal((await laptop('/session')).data.authenticated, true);
  assert.equal((await phone('/account/sign-out-others', {method: 'POST'})).data.signedOut, 2);
  assert.equal((await laptop('/session')).data.authenticated, false);
  assert.equal((await browser()('/login', {method: 'POST', body: {email, key}})).status, 401);
  assert.equal((await browser()('/login', {method: 'POST', body: {email, key: newKey}})).status, 200);

  // Removing a name keeps its history.
  assert.equal((await phone('/members/' + nino.data.member.id, {method: 'DELETE'})).data.member, null);
  assert.equal((await phone('/orders')).data.orders.find(item => item.id === later.id).createdBy, 'ნინო');

  const out = await phone('/logout', {method: 'POST'});
  assert.match(out.setCookie, /Max-Age=0/);
  assert.deepEqual((await phone('/orders')).data, {orders: []}, 'after signing out the browser starts empty again');
});

test('input checks', async () => {
  const call = browser();
  assert.equal((await call('/register', {method: 'POST', body: {email: 'not-an-email', key: 'x'.repeat(43)}})).status, 400);
  assert.equal((await call('/register', {method: 'POST', body: {email: 'a@b.ge', key: 'short'}})).status, 400);
  assert.equal((await call('/orders', {method: 'POST', body: order({phone: '5'})})).status, 400);
  assert.equal((await call('/session')).data.authenticated, false, 'an invalid first order creates no notebook');
  const plain = await fetch(BASE + '/api/login', {method: 'POST', headers: {'Content-Type': 'text/plain'}, body: '{}'});
  assert.equal(plain.status, 415);
  const google = await fetch(BASE + '/auth/google', {redirect: 'manual'});
  assert.equal(google.status, 302);
  assert.match(google.headers.get('location'), /auth=google-off/);
});
