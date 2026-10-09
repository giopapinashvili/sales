// HTML pieces shared by the app and the landing-page preview.
import {todayKey, dayDifference, dueLabel, money, georgianDate} from './core.mjs';

export const esc = value => String(value ?? '').replace(/[&<>"']/g, char => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'}[char]));

export const icon = (name, className = 'icon') => `<svg class="${className}" aria-hidden="true"><use href="#i-${name}"/></svg>`;

// Each name gets one of six steady colours so people recognise each other's entries.
export function personTone(name) {
  let hash = 0;
  for (const char of String(name)) hash = (hash * 31 + char.codePointAt(0)) >>> 0;
  return 'person-' + (hash % 6);
}

export function personChip(name, className = 'person-chip') {
  if (!name) return '';
  const initial = [...String(name).trim()][0] || '?';
  return `<span class="${className} ${personTone(name)}"><span class="person-initial" aria-hidden="true">${esc(initial)}</span>${esc(name)}</span>`;
}

const dateOf = timestamp => georgianDate(todayKey(new Date(timestamp)));

export function orderState(order, today = todayKey()) {
  if (order.status === 'sent') return 'sent';
  if (order.shipDate === today) return 'today';
  return dayDifference(order.shipDate, today) < 0 ? 'overdue' : '';
}

export function orderCard(order, {today = todayKey(), expanded = false, showAuthor = false, readOnly = false} = {}) {
  const state = orderState(order, today);
  const late = state === 'overdue' ? Math.abs(dayDifference(order.shipDate, today)) : 0;
  const id = esc(order.id);
  return `<article class="order-card ${state}">
    <button id="summary-${id}" class="order-summary" data-order="${id}" aria-expanded="${expanded}" aria-controls="details-${id}">
      <span class="order-status"><span class="status-badge"${late ? ` aria-label="${late} დღით დაგვიანებული"` : ''}>${dueLabel(order, today)}</span><span class="region-label">${esc(order.region)}</span></span>
      <span class="order-main"><span class="customer">${esc(order.customer)}</span><span class="product">${esc(order.product)}</span>${showAuthor && order.createdBy ? `<span class="order-author">${personChip(order.createdBy, 'person-chip small')}</span>` : ''}</span>
      <span class="order-price">${money(order.priceCents)}</span>
      ${icon('chevron', 'icon order-chevron')}
    </button>
    <div class="order-details" id="details-${id}"${expanded ? '' : ' hidden'}>${expanded ? orderDetails(order, {readOnly}) : ''}</div>
  </article>`;
}

export function orderHistory(order) {
  const lines = [];
  if (order.createdBy) lines.push(`<span>დაამატა: <strong>${esc(order.createdBy)}</strong> · ${dateOf(order.createdAt)}</span>`);
  if (order.updatedBy && order.version > 1 && (order.updatedBy !== order.createdBy || order.updatedAt - order.createdAt > 60000) && order.updatedBy !== order.sentBy) {
    lines.push(`<span>ბოლოს შეცვალა: <strong>${esc(order.updatedBy)}</strong> · ${dateOf(order.updatedAt)}</span>`);
  }
  if (order.status === 'sent') lines.push(`<span>გაგზავნა: ${order.sentBy ? `<strong>${esc(order.sentBy)}</strong> · ` : ''}${dateOf(order.sentAt || order.updatedAt)}</span>`);
  return lines.join('');
}

export function orderDetails(order, {readOnly = false} = {}) {
  const field = (label, value, wide = false) => `<div class="detail ${wide ? 'wide' : ''}"><dt>${label}</dt><dd>${esc(value)}</dd></div>`;
  const phoneDigits = String(order.phone).replace(/[^+\d]/g, '');
  const id = esc(order.id);
  return `<dl class="details-grid">
      ${field('სახელი და გვარი', order.customer)}
      ${field('პროდუქტი', order.product)}
      ${field('ფასი', money(order.priceCents))}
      ${field('ქალაქი / რეგიონი', order.region)}
      ${field('ზუსტი მისამართი', order.address, true)}
      <div class="detail"><dt>ტელეფონის ნომერი</dt><dd>${readOnly ? esc(order.phone) : `<a class="phone-link" href="tel:${phoneDigits}">${esc(order.phone)}${icon('phone')}</a>`}</dd></div>
      ${field('გაგზავნის თარიღი', georgianDate(order.shipDate, {year: true}))}
      ${field('მიტანის დრო', order.deliveryTime || 'მითითებული არ არის')}
      ${order.notes ? field('დამატებითი ინფორმაცია', order.notes, true) : ''}
    </dl>
    ${readOnly ? '' : `<div class="detail-actions">
      <button class="secondary-button" data-edit="${id}">${icon('edit')}რედაქტირება</button>
      <button class="primary-button" data-status="${id}">${icon(order.status === 'sent' ? 'refresh' : 'check')}${order.status === 'sent' ? 'გასაგზავნებში დაბრუნება' : 'გაგზავნილად მონიშვნა'}</button>
    </div>`}
    <div class="detail-bottom">
      <p class="order-history">${orderHistory(order)}</p>
      ${readOnly ? '' : `<button class="delete-button" data-delete="${id}">შეკვეთის წაშლა</button>`}
    </div>`;
}
