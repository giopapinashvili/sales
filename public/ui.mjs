import {todayKey, orderGroups, parsePrice, validateOrder, georgianDate, money} from './core.mjs';
import {setupInstall} from './install.mjs';
import {api, send, whenSignedOut} from './api.mjs';
import {esc, icon, orderCard, personChip} from './render.mjs';
import {passwordKey} from './password.mjs';

const $ = selector => document.querySelector(selector);
const params = new URLSearchParams(location.search);
const REGIONS = ['თბილისი', 'ბათუმი', 'ქუთაისი', 'რუსთავი', 'იმერეთი', 'აჭარა', 'კახეთი', 'ქვემო ქართლი', 'შიდა ქართლი', 'სამეგრელო-ზემო სვანეთი', 'სამცხე-ჯავახეთი', 'გურია', 'მცხეთა-მთიანეთი', 'რაჭა-ლეჩხუმი და ქვემო სვანეთი'];

// No session: nothing saved yet in this browser. A session for an account
// without an email: this browser's own notebook. Otherwise: a signed-up account.
const state = {
  config: {googleReady: false, pushReady: false, pushPublicKey: null},
  session: null,
  orders: [],
  loaded: false,
  loading: false,
  filter: params.get('filter') === 'today' ? 'today' : 'all',
  query: '',
  expanded: new Set(),
  editing: null,
  draftId: null,
  pushEnabled: false,
  memberRequired: false,
  mergeAsked: false
};
const registered = () => Boolean(state.session && !state.session.account.guest);
let toastTimer;

function toast(message, error = false) {
  clearTimeout(toastTimer);
  const element = $('#toast');
  element.textContent = message;
  element.classList.toggle('error', error);
  element.hidden = false;
  toastTimer = setTimeout(() => { element.hidden = true; }, 4500);
}

function setError(selector, message) {
  const element = $(selector);
  if (!element) return;
  element.textContent = message || '';
  element.hidden = !message;
}

const appInstall = setupInstall({ready: () => state.loaded, notify: toast});

// ---- Notebook state ----

function startFresh() {
  for (const dialog of document.querySelectorAll('dialog[open]')) if (dialog.id !== 'auth-dialog') dialog.close();
  state.session = null;
  state.orders = [];
  state.loaded = true;
  state.expanded.clear();
  state.mergeAsked = false;
  renderMode();
  void checkPush();
}

function enter(payload) {
  const switched = state.session?.account?.email !== payload.account.email || !state.session;
  state.session = payload;
  if (switched) {
    state.orders = [];
    state.loaded = false;
    state.expanded.clear();
  }
  renderMode();
  if (registered() && !payload.member) openMemberDialog({required: true});
  else offerMerge();
  void loadOrders();
  void checkPush();
}

async function refreshSession() {
  try {
    const payload = await api('/session');
    if (payload.authenticated) {
      state.session = payload;
      renderMode();
    }
  } catch {}
}

whenSignedOut(() => {
  const wasRegistered = registered();
  startFresh();
  if (wasRegistered) openAuth('login', 'შესვლის ვადა ამოიწურა. შედი ხელახლა.');
});

function renderMode() {
  $('#guest-card').hidden = registered();
  $('#member-chip').hidden = !registered();
  $('.rail-label').textContent = registered() ? state.session.account.email : 'ამ ბრაუზერში';
  renderMember();
  render();
}

// ---- Order list ----

function render() {
  const today = todayKey();
  $('#current-date').textContent = georgianDate(today, {weekday: true});
  const orders = state.orders;
  const due = orders.filter(order => order.status === 'pending' && order.shipDate === today);
  $('#today-message').textContent = due.length ? `დღეს გასაგზავნია ${due.length} შეკვეთა` : state.loaded ? 'დღეს ყველაფერი მოწესრიგებულია' : 'შეკვეთების რვეული';
  $('#reminder-caption').textContent = state.pushEnabled ? 'შეხსენება ყოველდღე · 12:00' : 'შეხსენების ჩასართავად დააჭირე ზარს';
  $('#notification-dot').hidden = !state.pushEnabled;
  $('#count-all').textContent = orders.filter(order => order.status === 'pending').length;
  $('#count-today').textContent = due.length;
  $('#count-sent').textContent = orders.filter(order => order.status === 'sent').length;
  $('#rail-today').textContent = due.length;
  $('#day-number').textContent = due.length;
  $('#day-total').textContent = money(due.reduce((sum, order) => sum + order.priceCents, 0));
  $('#day-regions').innerHTML = [...new Set(due.map(order => order.region))].map(region => `<span>${esc(region)}</span>`).join('');
  document.querySelectorAll('[data-filter]').forEach(button => {
    button.classList.toggle('selected', button.dataset.filter === state.filter);
    button.setAttribute('aria-pressed', String(button.dataset.filter === state.filter));
  });
  document.querySelectorAll('.rail-item').forEach(button => button.classList.toggle('active', button.dataset.action === state.filter));
  const list = $('#orders');
  list.setAttribute('aria-busy', String(state.loading));
  if (!state.loaded) {
    list.innerHTML = `<div class="loading-state">${!navigator.onLine ? 'ინტერნეტთან დაკავშირებისას შეკვეთები გამოჩნდება.' : 'შეკვეთები იტვირთება…'}</div>`;
    $('#list-summary').textContent = '';
    return;
  }
  const showAuthor = registered() && ((state.session.members?.length || 0) > 1 || orders.some(order => order.createdBy && order.createdBy !== state.session.member?.name));
  const groups = orderGroups(orders, state.filter, state.query, today);
  const count = groups.reduce((sum, group) => sum + group.items.length, 0);
  list.innerHTML = count
    ? groups.filter(group => group.items.length).map(group => `<section class="order-section" aria-labelledby="section-${group.key}">
        <div class="section-heading"><h2 id="section-${group.key}">${group.title}</h2><span>${group.hint}</span></div>
        ${group.items.map(order => orderCard(order, {today, expanded: state.expanded.has(order.id), showAuthor})).join('')}
      </section>`).join('')
    : emptyState();
  $('#list-summary').textContent = state.query ? `მოიძებნა ${count} შეკვეთა` : `სულ ${orders.length} შეკვეთა`;
}

function emptyState() {
  const {query, filter} = state;
  const title = query ? 'შეკვეთა ვერ მოიძებნა' : filter === 'sent' ? 'ჯერ გაგზავნილი შეკვეთა არ არის' : filter === 'today' ? 'დღეს გასაგზავნი არაფერია' : 'პირველი შეკვეთა ჩავწეროთ';
  const copy = query ? 'სცადე სხვა სახელი, პროდუქტი ან ტელეფონის ნომერი.'
    : filter === 'all' ? 'ჩაწერე კლიენტი, პროდუქტი, მისამართი და გაგზავნის დღე. იმ დღეს შეკვეთა სიის თავში გამოჩნდება და 12:00-ზე შეხსენებაც მოვა.'
      : filter === 'today' ? 'ახალი შეკვეთები ჩაწერე და გაგზავნის თარიღი მიუთითე.' : 'გაგზავნილად მონიშნული შეკვეთები აქ გამოჩნდება.';
  return `<div class="empty-state">${icon(query ? 'search' : filter === 'today' ? 'check' : 'book')}<h2>${title}</h2><p>${copy}</p>${!query && filter !== 'sent' ? `<button class="primary-button" data-action="new">${icon('plus')}ახალი შეკვეთა</button>` : ''}</div>`;
}

async function loadOrders({quiet = false} = {}) {
  if (state.loading) return;
  if (!state.session) {
    state.loaded = true;
    render();
    return;
  }
  const account = state.session.account.email;
  state.loading = true;
  if (!quiet) render();
  try {
    const orders = (await api('/orders')).orders;
    if (!state.session || state.session.account.email !== account) return;
    state.orders = orders;
    state.loaded = true;
    $('#load-error').hidden = true;
    appInstall.consider();
  } catch (error) {
    if (error.status !== 401) {
      $('#load-error-text').textContent = error.message;
      $('#load-error').hidden = false;
    }
  } finally {
    state.loading = false;
    render();
  }
}

function selectFilter(value) {
  state.filter = value;
  render();
}

function needsMember() {
  if (!registered() || state.session.member) return false;
  openMemberDialog({required: true});
  return true;
}

function openOrder(order = null) {
  if (!state.loaded) return toast('დაელოდე შეკვეთების ჩატვირთვას.', true);
  if (needsMember()) return;
  state.editing = order ? structuredClone(order) : null;
  state.draftId = order?.id || crypto.randomUUID();
  $('#form-title').textContent = order ? 'შეკვეთის რედაქტირება' : 'ახალი შეკვეთა';
  setError('#form-error', '');
  const field = (name, label, attrs = '', value = '', hint = '') => `<div class="field"><label for="f-${name}">${label}</label><input id="f-${name}" name="${name}" ${attrs} value="${esc(value)}" ${hint ? `aria-describedby="hint-${name}"` : ''}>${hint ? `<span id="hint-${name}" class="field-hint">${hint}</span>` : ''}</div>`;
  $('#form-fields').innerHTML = `
    ${field('customer', 'სახელი და გვარი', 'required maxlength="160" autocomplete="off"', order?.customer)}
    ${field('product', 'პროდუქტი', 'required maxlength="500" autocomplete="off"', order?.product)}
    ${field('price', 'ფასი (₾)', 'required inputmode="decimal" type="text" maxlength="11" placeholder="მაგ. 85" autocomplete="off"', order ? String(order.priceCents / 100) : '')}
    ${field('region', 'ქალაქი / რეგიონი', 'required list="regions" maxlength="120" autocomplete="off" placeholder="მაგ. თბილისი"', order?.region)}
    <datalist id="regions">${REGIONS.map(region => `<option value="${region}">`).join('')}</datalist>
    ${field('address', 'ზუსტი მისამართი', 'required maxlength="1000" autocomplete="off" placeholder="ქუჩა, ნომერი, ბინა…"', order?.address)}
    ${field('phone', 'ტელეფონის ნომერი', 'required type="tel" maxlength="40" autocomplete="off" placeholder="555 12 34 56"', order?.phone)}
    ${field('shipDate', 'გაგზავნის თარიღი', 'required type="date" min="2000-01-01" max="2100-12-31"', order?.shipDate || todayKey(), 'შეხსენება ამ დღეს, 12:00-ზე მოვა.')}
    ${field('deliveryTime', 'მიტანის დრო <span class="optional">· სურვილისამებრ</span>', 'maxlength="120" placeholder="მაგ. 14:00–18:00" autocomplete="off"', order?.deliveryTime)}
    <div class="field"><label for="f-notes">დამატებითი ინფორმაცია <span class="optional">· სურვილისამებრ</span></label><textarea id="f-notes" name="notes" maxlength="3000" placeholder="მაგ. მისვლამდე დაურეკეთ">${esc(order?.notes || '')}</textarea></div>
    ${registered() ? `<p class="form-author">${order ? 'ცვლილებას შეინახავს' : 'ჩაწერს'}: ${personChip(state.session.member.name, 'person-chip small')}</p>` : ''}`;
  $('#order-dialog').showModal();
}

$('#order-form').addEventListener('submit', async event => {
  event.preventDefault();
  const form = event.currentTarget;
  if (!form.reportValidity()) return;
  let values;
  try {
    const fields = Object.fromEntries(new FormData(form));
    values = validateOrder({...fields, priceCents: parsePrice(fields.price)});
  } catch (error) {
    setError('#form-error', error.message);
    return;
  }
  $('#save-button').disabled = true;
  setError('#form-error', '');
  const editing = state.editing;
  const firstSave = !state.session;
  try {
    const saved = (await send(editing ? '/orders/' + editing.id : '/orders', editing ? 'PUT' : 'POST', {...values, id: state.draftId, version: editing?.version})).order;
    const index = state.orders.findIndex(order => order.id === saved.id);
    if (index >= 0) state.orders[index] = saved; else state.orders.push(saved);
    state.filter = 'all';
    state.expanded.add(saved.id);
    render();
    $('#order-dialog').close();
    toast(editing ? 'ცვლილებები შენახულია' : 'შეკვეთა დამატებულია');
    document.getElementById('summary-' + saved.id)?.scrollIntoView({block: 'nearest', behavior: 'smooth'});
    if (firstSave) await refreshSession();
  } catch (error) {
    setError('#form-error', error.message);
    if (error.code === 'member-required') openMemberDialog({required: true});
    else if (error.status === 409) await loadOrders({quiet: true});
  } finally {
    $('#save-button').disabled = false;
  }
});

async function changeStatus(id, button) {
  const order = state.orders.find(item => item.id === id);
  if (!order || needsMember()) return;
  button.disabled = true;
  const status = order.status === 'sent' ? 'pending' : 'sent';
  try {
    const saved = (await send('/orders/' + id + '/status', 'PATCH', {status, version: order.version})).order;
    state.orders = state.orders.map(item => (item.id === id ? saved : item));
    state.expanded.delete(id);
    render();
    toast(status === 'sent' ? 'შეკვეთა გაგზავნილებში გადავიდა' : 'შეკვეთა გასაგზავნებში დაბრუნდა');
  } catch (error) {
    toast(error.message, true);
    if (error.status === 409) await loadOrders({quiet: true});
    button.disabled = false;
  }
}

let confirmResolve = null;
function confirmAction({title, copy, action = 'წაშლა'}) {
  $('#confirm-title').textContent = title;
  $('#confirm-copy').textContent = copy;
  $('#confirm-ok').textContent = action;
  $('#confirm-dialog').showModal();
  return new Promise(resolve => { confirmResolve = resolve; });
}
$('#confirm-ok').addEventListener('click', () => {
  const resolve = confirmResolve;
  confirmResolve = null;
  $('#confirm-dialog').close();
  resolve?.(true);
});
$('#confirm-dialog').addEventListener('close', () => {
  const resolve = confirmResolve;
  confirmResolve = null;
  resolve?.(false);
});

async function deleteOrder(id) {
  const order = state.orders.find(item => item.id === id);
  if (!order || needsMember()) return;
  if (!await confirmAction({title: 'წავშალოთ შეკვეთა?', copy: `${order.customer} — ${order.product}. წაშლილი შეკვეთის აღდგენა ვერ მოხერხდება.`})) return;
  try {
    await send('/orders/' + id, 'DELETE', {version: order.version});
    state.orders = state.orders.filter(item => item.id !== id);
    state.expanded.delete(id);
    render();
    toast('შეკვეთა წაშლილია');
  } catch (error) {
    toast(error.message, true);
    if (error.status === 409) await loadOrders({quiet: true});
  }
}

// ---- This browser's orders after signing in to an existing account ----

function offerMerge() {
  const count = state.session?.guestOrders || 0;
  if (!registered() || !state.session.member || state.mergeAsked || !count) return;
  state.mergeAsked = true;
  $('#merge-copy').textContent = `შესვლამდე ამ ბრაუზერში ${count} შეკვეთა ჩაწერე. გადმოვიტანოთ ამ ექაუნთში? თუ არ გადმოიტან, ის შეკვეთები წაიშლება.`;
  setError('#merge-error', '');
  $('#merge-keep').disabled = false;
  $('#merge-drop').disabled = false;
  $('#merge-dialog').showModal();
}

async function finishMerge(keep, button) {
  button.disabled = true;
  setError('#merge-error', '');
  try {
    const result = await send('/account/merge', 'POST', {keep});
    $('#merge-dialog').close();
    toast(keep ? `ექაუნთში გადმოვიდა ${result.moved} შეკვეთა` : 'ამ ბრაუზერის შეკვეთები წაიშალა');
    await refreshSession();
    await loadOrders({quiet: true});
  } catch (error) {
    setError('#merge-error', error.message);
    button.disabled = false;
  }
}
$('#merge-keep').addEventListener('click', event => finishMerge(true, event.currentTarget));
$('#merge-drop').addEventListener('click', event => finishMerge(false, event.currentTarget));

// ---- Who is writing (signed-up accounts, shared by a team) ----

function renderMember() {
  const name = state.session?.member?.name;
  $('#member-chip-name').textContent = name || 'აირჩიე სახელი';
  $('#member-chip').classList.toggle('missing', !name);
}

function openMemberDialog({required = false} = {}) {
  if (!registered()) return;
  state.memberRequired = required || !state.session.member;
  const members = state.session.members || [];
  const currentId = state.session.member?.id;
  $('#member-title').textContent = members.length ? 'ვინ ხარ?' : 'რა გქვია?';
  $('#member-copy').textContent = members.length
    ? 'აირჩიე შენი სახელი. ის გამოჩნდება ყველა შეკვეთაზე, რომელსაც ჩაწერ, შეცვლი ან გაგზავნი.'
    : 'სახელი გამოჩნდება შენს ჩანაწერებზე. გუნდის სხვა წევრები შესვლისას თავიანთ სახელს დაამატებენ.';
  $('#member-options').innerHTML = members.map(member => `<button type="button" class="member-option${member.id === currentId ? ' current' : ''}" data-member="${esc(member.id)}">${personChip(member.name)}${member.id === currentId ? '<span class="member-now">ახლა</span>' : ''}</button>`).join('');
  $('#member-options').hidden = !members.length;
  $('#member-add-label').textContent = members.length ? 'ან დაამატე შენი სახელი' : 'შენი სახელი';
  $('#member-cancel').hidden = state.memberRequired;
  $('#member-form').reset();
  setError('#member-error', '');
  if (!$('#member-dialog').open) $('#member-dialog').showModal();
  if (!members.length) $('#member-name').focus();
}

$('#member-dialog').addEventListener('cancel', event => { if (state.memberRequired) event.preventDefault(); });

function memberChosen(payload) {
  state.session = payload;
  state.memberRequired = false;
  $('#member-dialog').close();
  renderMember();
  render();
  toast(`ახლა ჩაწერს: ${payload.member.name}`);
  offerMerge();
}

async function selectMember(id, button) {
  button.disabled = true;
  try {
    memberChosen(await send('/session/member', 'PUT', {memberId: id}));
  } catch (error) {
    setError('#member-error', error.message);
    button.disabled = false;
    if (error.status === 404) {
      await refreshSession();
      openMemberDialog({required: state.memberRequired});
    }
  }
}

$('#member-form').addEventListener('submit', async event => {
  event.preventDefault();
  const form = event.currentTarget;
  const name = form.elements['member-name'].value.trim();
  if (!name) return;
  const button = form.querySelector('[type="submit"]');
  button.disabled = true;
  setError('#member-error', '');
  try {
    memberChosen(await send('/members', 'POST', {name, select: true}));
  } catch (error) {
    setError('#member-error', error.message);
  } finally {
    button.disabled = false;
  }
});

async function removeMember(id) {
  const member = state.session.members.find(item => item.id === id);
  if (!member) return;
  if (!await confirmAction({title: 'წავშალოთ სახელი?', copy: `„${member.name}“ სიიდან წაიშლება. მისი ჩაწერილი შეკვეთები და ავტორობა უცვლელი დარჩება.`})) return;
  try {
    state.session = await send('/members/' + encodeURIComponent(id), 'DELETE');
    renderMember();
    render();
    showSettings();
    toast('სახელი წაიშალა');
    if (!state.session.member) openMemberDialog({required: true});
  } catch (error) {
    toast(error.message, true);
  }
}

// ---- Sign in and sign up ----

function selectAuthTab(mode) {
  const login = mode === 'login';
  $('#tab-login').setAttribute('aria-selected', String(login));
  $('#tab-register').setAttribute('aria-selected', String(!login));
  $('#login-form').hidden = !login;
  $('#register-form').hidden = login;
  $('#auth-title').textContent = login ? 'შესვლა' : 'ექაუნთის შექმნა';
  $('#auth-lead').textContent = login ? 'შედი და შენი შეკვეთები ნებისმიერი მოწყობილობიდან გექნება.' : 'რაც უკვე ჩაწერე, ექაუნთში დარჩება. მერე ნებისმიერი მოწყობილობიდან შეხვალ.';
  const from = login ? $('#register-email') : $('#login-email');
  const to = login ? $('#login-email') : $('#register-email');
  if (from.value && !to.value) to.value = from.value;
}

function openAuth(mode = 'register', message = '') {
  selectAuthTab(mode);
  setError('#login-error', mode === 'login' ? message : '');
  setError('#register-error', mode === 'register' ? message : '');
  if (!$('#auth-dialog').open) $('#auth-dialog').showModal();
  (mode === 'login' ? $('#login-email') : $('#register-email')).focus();
}

async function submitAuth(form, path, errorSelector) {
  if (!form.reportValidity()) return;
  const email = form.elements.email.value.trim();
  const password = (form.elements['current-password'] || form.elements['new-password']).value;
  const button = form.querySelector('[type="submit"]');
  button.disabled = true;
  setError(errorSelector, '');
  try {
    const key = await passwordKey(email, password);
    const payload = await send(path, 'POST', {email, key});
    form.reset();
    $('#auth-dialog').close();
    toast(path === '/register' ? 'ექაუნთი შეიქმნა' : 'შეხვედი ექაუნთში');
    enter(payload);
  } catch (error) {
    setError(errorSelector, error.message);
  } finally {
    button.disabled = false;
  }
}

$('#login-form').addEventListener('submit', event => {
  event.preventDefault();
  void submitAuth(event.currentTarget, '/login', '#login-error');
});
$('#register-form').addEventListener('submit', event => {
  event.preventDefault();
  void submitAuth(event.currentTarget, '/register', '#register-error');
});

const AUTH_NOTICES = {
  'google-email-exists': ['login', 'ეს ელფოსტა უკვე რეგისტრირებულია პაროლით. შედი პაროლით, მერე პარამეტრებში Google-ს დააკავშირებ.'],
  'google-failed': ['login', 'Google-ით შესვლა ვერ მოხერხდა. სცადე ხელახლა.'],
  'google-off': ['login', 'Google-ით შესვლა ჯერ არ არის ჩართული. შედი ელფოსტით.'],
  'google-cancelled': ['toast', 'Google-ით შესვლა გაუქმდა.'],
  'google-in-use': ['toast-error', 'ეს Google ექაუნთი უკვე სხვა რვეულზეა მიბმული.'],
  'google-linked': ['toast', 'Google დაუკავშირდა შენს ექაუნთს. ახლა Google-ითაც შეხვალ.']
};

function showAuthNotice(code) {
  const notice = AUTH_NOTICES[code];
  if (!notice) return;
  const [kind, message] = notice;
  if (kind === 'login') openAuth('login', message);
  else toast(message, kind === 'toast-error');
}

// ---- Settings ----

const isIos = () => /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
const isStandalone = () => matchMedia('(display-mode: standalone)').matches || navigator.standalone;

function reminderSection() {
  const supported = 'Notification' in window && 'PushManager' in window;
  const denied = 'Notification' in window && Notification.permission === 'denied';
  const status = state.pushEnabled ? 'ჩართულია · ყოველდღე 12:00 · თბილისის დროით'
    : !supported ? (isIos() && !isStandalone() ? 'ჯერ დაამატე აპი მთავარ ეკრანზე, მერე ჩართე შეხსენება.' : 'ამ ბრაუზერს შეტყობინებების მხარდაჭერა არ აქვს.')
      : denied ? 'ბრაუზერში შეტყობინებები დაბლოკილია. დაუშვი საიტის პარამეტრებში.'
        : !state.config.pushReady ? 'შეხსენება Cloudflare-ზე გამართვის შემდეგ ჩაირთვება.' : 'გამორთულია · ჩართე, რომ დღევანდელი შეკვეთები არ გამოგრჩეს.';
  const disabled = !supported || !state.config.pushReady || denied || state.pushEnabled;
  return `<section class="settings-section"><h3>ყოველდღიური შეხსენება</h3>
    <p>12:00-ზე მოგივა შეტყობინება იმ დღის გასაგზავნი შეკვეთების რაოდენობით. გაგზავნილი შეკვეთები აღარ ჩაითვლება.</p>
    <div class="notification-status">${status}</div>
    <button class="primary-button" data-action="enable-push"${disabled ? ' disabled' : ''}>${icon('bell')}შეხსენების ჩართვა</button>
    ${state.pushEnabled ? `<button class="secondary-button" data-action="test-push">საცდელი შეტყობინება</button><button class="text-button" data-action="disable-push">ამ მოწყობილობაზე გამორთვა</button>` : ''}
  </section>`;
}

function peopleSection() {
  const members = state.session.members || [];
  const current = state.session.member;
  return `<section class="settings-section"><h3>ვინ ჩაწერს ამ მოწყობილობიდან</h3>
      <div class="current-person">${current ? personChip(current.name) : '<span class="muted">სახელი არჩეული არ არის</span>'}</div>
      <button class="secondary-button" data-action="member">სხვა სახელის არჩევა</button>
    </section>
    <section class="settings-section"><h3>გუნდის სახელები</h3>
      <p>ყველა, ვინც ამ ექაუნთით შედის, აქედან ირჩევს თავის სახელს. სახელის წაშლისას მისი ძველი ჩანაწერები ხელუხლებელი რჩება.</p>
      <ul class="member-list">${members.map(member => `<li>${personChip(member.name)}<button class="text-button danger-text" data-remove-member="${esc(member.id)}" aria-label="${esc(member.name)} — წაშლა">წაშლა</button></li>`).join('')}</ul>
      <form id="settings-member-form" class="inline-form">
        <label for="settings-member-name" class="visually-hidden">ახალი სახელი</label>
        <input id="settings-member-name" name="member-name" maxlength="40" autocomplete="off" placeholder="ახალი სახელი, მაგ. ლევანი" required>
        <button class="secondary-button" type="submit">დამატება</button>
      </form>
      <p id="settings-member-error" class="form-error" role="alert" hidden></p>
    </section>`;
}

function installSection() {
  const standalone = isStandalone();
  return `<section class="settings-section"><h3>ტელეფონში დაყენება</h3>
    <p>${standalone ? 'აპი უკვე დაყენებულია.' : isIos() ? 'Safari-ში დააჭირე გაზიარებას (Share), შემდეგ „Add to Home Screen“ და აპი მთავარი ეკრანიდან გახსენი.' : 'Chrome-ში გახსენი მენიუ ⋮ და აირჩიე „Install app“ ან „Add to Home screen“.'}</p>
    ${standalone ? '' : '<button class="primary-button" data-action="install">აპის დაყენება</button>'}
  </section>`;
}

function browserNotebookSection() {
  const count = state.orders.length;
  return `<section class="settings-section"><h3>ექაუნთი</h3>
    <p>${count ? `შენი ${count} შეკვეთა ინახება და მხოლოდ ამ ბრაუზერიდან იხსნება.` : 'რასაც ჩაწერ, შეინახება და მხოლოდ ამ ბრაუზერიდან გაიხსნება.'} თუ ბრაუზერის მონაცემებს წაშლი, ამ რვეულს ვეღარ გახსნი. დარეგისტრირდი, რომ ნებისმიერი მოწყობილობიდან შეხვიდე. რაც უკვე ჩაწერე, ადგილზე დარჩება.</p>
    <button class="primary-button" data-auth="register">რეგისტრაცია</button>
    <button class="secondary-button" data-auth="login">შესვლა არსებულ ექაუნთში</button>
  </section>`;
}

function accountSection() {
  const {account} = state.session;
  const google = state.config.googleReady
    ? account.hasGoogle ? `<p class="status-line">${icon('check')}Google დაკავშირებულია</p>` : `<a class="secondary-button" href="/auth/google?mode=link">Google-ის დაკავშირება</a>`
    : '';
  return `<section class="settings-section"><h3>ექაუნთი</h3>
    <p class="account-email">${icon('mail')}<span>${esc(account.email)}</span></p>
    ${google}
    <form id="password-form" class="settings-form">
      <input type="text" name="username" autocomplete="username" value="${esc(account.email)}" class="visually-hidden" tabindex="-1" readonly aria-hidden="true">
      <label for="settings-new-password">${account.hasPassword ? 'პაროლის შეცვლა' : 'პაროლის დაყენება'}</label>
      <span class="field-hint">${account.hasPassword ? 'ახალი პაროლი მომდევნო შესვლებზე იმუშავებს. უკვე შესული მოწყობილობები შესული დარჩება.' : 'პაროლით გუნდის სხვა წევრებიც შეძლებენ ამ ელფოსტით შესვლას.'}</span>
      <div class="password-field">
        <input id="settings-new-password" name="new-password" type="password" autocomplete="new-password" minlength="8" maxlength="200" required>
        <button type="button" class="reveal" aria-label="პაროლის ჩვენება" aria-pressed="false">${icon('eye')}</button>
      </div>
      <p id="password-error" class="form-error" role="alert" hidden></p>
      <button class="secondary-button" type="submit">პაროლის შენახვა</button>
    </form>
    <button class="secondary-button" data-action="sign-out-others">სხვა მოწყობილობებიდან გასვლა</button>
    <button class="secondary-button" data-action="logout">${icon('logout')}გასვლა</button>
  </section>`;
}

function showSettings(section = 'all') {
  if (section === 'install') {
    appInstall.open();
    return;
  }
  const parts = section === 'notifications' ? [reminderSection()]
    : registered() ? [peopleSection(), reminderSection(), installSection(), accountSection()]
      : [browserNotebookSection(), reminderSection(), installSection()];
  $('#settings-content').innerHTML = parts.join('');
  if (!$('#settings-dialog').open) $('#settings-dialog').showModal();
}

document.addEventListener('submit', async event => {
  const form = event.target;
  if (form.id === 'settings-member-form') {
    event.preventDefault();
    const name = form.elements['member-name'].value.trim();
    if (!name) return;
    const button = form.querySelector('[type="submit"]');
    button.disabled = true;
    try {
      state.session = await send('/members', 'POST', {name, select: false});
      showSettings();
      render();
      toast(`„${name}“ დაემატა სიაში`);
    } catch (error) {
      setError('#settings-member-error', error.message);
      button.disabled = false;
    }
  }
  if (form.id === 'password-form') {
    event.preventDefault();
    if (!form.reportValidity()) return;
    const button = form.querySelector('[type="submit"]');
    button.disabled = true;
    setError('#password-error', '');
    try {
      const key = await passwordKey(state.session.account.email, form.elements['new-password'].value);
      state.session = await send('/account/password', 'POST', {key});
      showSettings();
      toast('პაროლი შენახულია');
    } catch (error) {
      setError('#password-error', error.message);
      button.disabled = false;
    }
  }
});

async function signOutOthers(button) {
  if (!await confirmAction({title: 'სხვა მოწყობილობებიდან გასვლა?', copy: 'ყველა სხვა ტელეფონი და კომპიუტერი გამოვა ექაუნთიდან და ხელახლა შესვლა დასჭირდება. ეს მოწყობილობა შესული დარჩება.', action: 'გასვლა'})) return;
  button.disabled = true;
  try {
    const result = await send('/account/sign-out-others', 'POST');
    toast(result.signedOut ? `გამოვიდა ${result.signedOut} მოწყობილობა` : 'სხვა შესული მოწყობილობა არ იყო');
  } catch (error) {
    toast(error.message, true);
  } finally {
    button.disabled = false;
  }
}

async function logout(button) {
  button.disabled = true;
  try {
    if (state.pushEnabled) await disablePush({quiet: true});
    await send('/logout', 'POST');
    startFresh();
    toast('გამოხვედი ექაუნთიდან');
  } catch (error) {
    toast(error.message, true);
    button.disabled = false;
  }
}

// ---- Daily reminder on this device ----

async function checkPush() {
  if (!('serviceWorker' in navigator) || !('PushManager' in window)) return;
  try {
    const registration = await navigator.serviceWorker.ready;
    const subscription = await registration.pushManager.getSubscription();
    state.pushEnabled = Boolean(subscription && state.session);
    if (subscription && state.session) await send('/subscriptions', 'POST', subscription.toJSON());
  } catch {
    state.pushEnabled = false;
  }
  render();
}

const urlBase64 = value => Uint8Array.from(atob(value.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(value.length / 4) * 4, '=')), char => char.charCodeAt(0));

async function enablePush(button) {
  if (!('Notification' in window) || !('PushManager' in window) || !state.config.pushReady) return;
  const permissionPromise = Notification.requestPermission();
  button.disabled = true;
  try {
    const permission = await permissionPromise;
    if (permission !== 'granted') {
      toast('შეხსენებისთვის საჭიროა შეტყობინებების ნებართვა.', true);
      showSettings('notifications');
      return;
    }
    const registration = await navigator.serviceWorker.ready;
    const subscription = await registration.pushManager.subscribe({userVisibleOnly: true, applicationServerKey: urlBase64(state.config.pushPublicKey)});
    try {
      await send('/subscriptions', 'POST', subscription.toJSON());
    } catch (error) {
      await subscription.unsubscribe();
      throw error;
    }
    if (!state.session) await refreshSession();
    state.pushEnabled = true;
    render();
    showSettings('notifications');
    toast('შეხსენება ჩაირთო · ყოველდღე 12:00');
  } catch (error) {
    toast(error.message || 'შეხსენება ვერ ჩაირთო. სცადე ხელახლა.', true);
    button.disabled = false;
  }
}

async function disablePush({quiet = false} = {}) {
  try {
    const registration = await navigator.serviceWorker.ready;
    const subscription = await registration.pushManager.getSubscription();
    if (subscription) {
      if (state.session) await send('/subscriptions', 'DELETE', {endpoint: subscription.endpoint}).catch(() => {});
      await subscription.unsubscribe();
    }
    state.pushEnabled = false;
    if (quiet) return;
    render();
    showSettings('notifications');
    toast('ამ მოწყობილობაზე შეხსენება გამორთულია');
  } catch (error) {
    if (!quiet) toast(error.message, true);
  }
}

async function testPush(button) {
  button.disabled = true;
  try {
    const registration = await navigator.serviceWorker.ready;
    const subscription = await registration.pushManager.getSubscription();
    if (!subscription) throw new Error('ჯერ ჩართე შეხსენება.');
    await send('/push/test', 'POST', {endpoint: subscription.endpoint});
    toast('საცდელი შეტყობინება გაიგზავნა');
  } catch (error) {
    toast(error.message, true);
  } finally {
    button.disabled = false;
  }
}

// ---- Clicks ----

document.addEventListener('click', async event => {
  const target = event.target.closest('button, a');
  if (!target) return;
  if (target.matches('.reveal')) {
    const input = target.parentElement.querySelector('input');
    const shown = input.type === 'text';
    input.type = shown ? 'password' : 'text';
    target.setAttribute('aria-pressed', String(!shown));
    target.setAttribute('aria-label', shown ? 'პაროლის ჩვენება' : 'პაროლის დამალვა');
    target.innerHTML = icon(shown ? 'eye' : 'eye-off');
    return;
  }
  if (target.hasAttribute('data-close')) {
    target.closest('dialog').close();
    return;
  }
  if (target.dataset.auth) {
    const host = target.closest('dialog');
    if (host && host.id !== 'auth-dialog') host.close();
    openAuth(target.dataset.auth);
    return;
  }
  if (target.dataset.authTab) {
    selectAuthTab(target.dataset.authTab);
    return;
  }
  if (target.dataset.order && target.closest('#orders')) {
    const id = target.dataset.order;
    if (state.expanded.has(id)) state.expanded.delete(id); else state.expanded.add(id);
    render();
    document.getElementById('summary-' + id)?.focus({preventScroll: true});
    return;
  }
  if (target.dataset.edit) return openOrder(state.orders.find(order => order.id === target.dataset.edit));
  if (target.dataset.status) return changeStatus(target.dataset.status, target);
  if (target.dataset.delete) return deleteOrder(target.dataset.delete);
  if (target.dataset.member) return selectMember(target.dataset.member, target);
  if (target.dataset.removeMember) return removeMember(target.dataset.removeMember);
  if (target.dataset.filter) return selectFilter(target.dataset.filter);
  const action = target.dataset.action;
  if (!action) return;
  if (['all', 'today', 'sent'].includes(action)) {
    selectFilter(action);
    if (action === 'today') $('#orders').scrollIntoView({block: 'nearest', behavior: 'smooth'});
    return;
  }
  if (action === 'new') openOrder();
  if (action === 'search') {
    const wrap = $('#search-wrap');
    wrap.classList.toggle('visible');
    if (wrap.classList.contains('visible')) $('#search').focus();
    else {
      state.query = '';
      $('#search').value = '';
      render();
    }
  }
  if (action === 'settings') showSettings();
  if (action === 'notifications') showSettings('notifications');
  if (action === 'install') showSettings('install');
  if (action === 'member') {
    $('#settings-dialog').close();
    openMemberDialog();
  }
  if (action === 'forgot') {
    $('#auth-dialog').close();
    $('#forgot-dialog').showModal();
  }
  if (action === 'reload') await loadOrders();
  if (action === 'enable-push') await enablePush(target);
  if (action === 'disable-push') await disablePush();
  if (action === 'test-push') await testPush(target);
  if (action === 'sign-out-others') await signOutOthers(target);
  if (action === 'logout') await logout(target);
});

$('#search').addEventListener('input', event => {
  state.query = event.target.value;
  render();
});

document.addEventListener('invalid', event => event.target.setAttribute('aria-invalid', 'true'), true);
document.addEventListener('input', event => {
  if (event.target.hasAttribute?.('aria-invalid') && event.target.validity.valid) event.target.removeAttribute('aria-invalid');
});

function updateOnline() {
  $('#offline-banner').hidden = navigator.onLine;
  if (navigator.onLine) void loadOrders({quiet: true});
  else render();
}
window.addEventListener('online', updateOnline);
window.addEventListener('offline', updateOnline);
const refreshable = () => Boolean(state.session) && document.visibilityState === 'visible' && !document.querySelector('dialog[open]');
document.addEventListener('visibilitychange', () => { if (refreshable()) { render(); void loadOrders({quiet: true}); } });
setInterval(() => { if (refreshable()) { render(); void loadOrders({quiet: true}); } }, 60000);

if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('/sw.js').catch(() => {});
  navigator.serviceWorker.addEventListener('message', event => {
    if (event.data?.type === 'OPEN_TODAY') {
      selectFilter('today');
      void loadOrders({quiet: true});
    }
  });
}

// ---- Start ----

async function init() {
  render();
  const notice = params.get('auth');
  if (notice) history.replaceState(null, '', location.pathname + (state.filter === 'today' ? '?filter=today' : ''));
  let session = null;
  try {
    state.config = await api('/config');
    document.querySelectorAll('[data-google]').forEach(element => { element.hidden = !state.config.googleReady; });
    session = await api('/session');
  } catch (error) {
    $('#load-error-text').textContent = error.message;
    $('#load-error').hidden = false;
  }
  if (session?.authenticated) enter(session);
  else startFresh();
  $('#offline-banner').hidden = navigator.onLine;
  if (notice) showAuthNotice(notice);
}

if (document.modelContext?.registerTool) {
  const lifecycle = new AbortController();
  window.addEventListener('pagehide', () => lifecycle.abort(), {once: true});
  const tools = [
    {name: 'list_orders', title: 'შეკვეთების ნახვა', description: 'Read the orders shown in this notebook.', inputSchema: {type: 'object', properties: {}, additionalProperties: false}, annotations: {readOnlyHint: true, untrustedContentHint: true},
      execute: async input => {
        if (!input || Object.keys(input).length || !state.loaded) throw new Error('Wait for the notebook to load and pass an empty object.');
        return {orders: structuredClone(state.orders)};
      }},
    {name: 'start_order_creation', title: 'ახალი შეკვეთის გახსნა', description: 'Open the form. Does not save an order.', inputSchema: {type: 'object', properties: {}, additionalProperties: false}, annotations: {readOnlyHint: false},
      execute: async input => {
        if (!input || Object.keys(input).length || !state.loaded) throw new Error('Wait for the notebook to load and pass an empty object.');
        openOrder();
        return {formOpen: $('#order-dialog').open};
      }}
  ];
  for (const tool of tools) {
    try { Promise.resolve(document.modelContext.registerTool(tool, {signal: lifecycle.signal})).catch(() => {}); } catch {}
  }
}

void init();
