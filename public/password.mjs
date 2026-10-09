// The password never leaves the device. The browser stretches it into a key
// (slow on purpose) and only that key is sent; the server stretches it again.
const ITERATIONS = 150000;
const SALT_PREFIX = 'orders-notebook-v1:';

const toBase64Url = bytes => btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

export async function passwordKey(email, password) {
  if (!crypto?.subtle) throw new Error('ეს ბრაუზერი უსაფრთხო შესვლას ვერ ახერხებს. გახსენი საიტი Chrome-ში ან Safari-ში.');
  const encoder = new TextEncoder();
  const material = await crypto.subtle.importKey('raw', encoder.encode(password.normalize('NFC')), 'PBKDF2', false, ['deriveBits']);
  const salt = encoder.encode(SALT_PREFIX + email.trim().toLowerCase());
  const bits = await crypto.subtle.deriveBits({name: 'PBKDF2', hash: 'SHA-256', salt, iterations: ITERATIONS}, material, 256);
  return toBase64Url(new Uint8Array(bits));
}

export const MIN_PASSWORD = 8;
