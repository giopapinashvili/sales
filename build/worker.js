var __defProp = Object.defineProperty;
var __name = (target, value) => __defProp(target, "name", { value, configurable: true });

// node_modules/uint8array-extras/index.js
var objectToString = Object.prototype.toString;
var uint8ArrayStringified = "[object Uint8Array]";
var arrayBufferStringified = "[object ArrayBuffer]";
function isType(value, typeConstructor, typeStringified) {
  if (!value) {
    return false;
  }
  if (value.constructor === typeConstructor) {
    return true;
  }
  return objectToString.call(value) === typeStringified;
}
__name(isType, "isType");
function isUint8Array(value) {
  return isType(value, Uint8Array, uint8ArrayStringified);
}
__name(isUint8Array, "isUint8Array");
function isArrayBuffer(value) {
  return isType(value, ArrayBuffer, arrayBufferStringified);
}
__name(isArrayBuffer, "isArrayBuffer");
function isUint8ArrayOrArrayBuffer(value) {
  return isUint8Array(value) || isArrayBuffer(value);
}
__name(isUint8ArrayOrArrayBuffer, "isUint8ArrayOrArrayBuffer");
function toUint8ArrayIfArrayBuffer(value) {
  return isArrayBuffer(value) ? new Uint8Array(value) : value;
}
__name(toUint8ArrayIfArrayBuffer, "toUint8ArrayIfArrayBuffer");
function assertUint8ArrayOrArrayBuffer(value) {
  if (!isUint8ArrayOrArrayBuffer(value)) {
    throw new TypeError(`Expected \`Uint8Array\` or \`ArrayBuffer\`, got \`${typeof value}\``);
  }
}
__name(assertUint8ArrayOrArrayBuffer, "assertUint8ArrayOrArrayBuffer");
function toUint8Array(value) {
  if (value instanceof ArrayBuffer) {
    return new Uint8Array(value);
  }
  if (ArrayBuffer.isView(value)) {
    return new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
  }
  throw new TypeError(`Unsupported value, got \`${typeof value}\`.`);
}
__name(toUint8Array, "toUint8Array");
function concatUint8Arrays(arrays, totalLength) {
  if (arrays.length === 0) {
    return new Uint8Array(0);
  }
  totalLength ??= arrays.reduce((accumulator, currentValue) => accumulator + currentValue.byteLength, 0);
  const returnValue = new Uint8Array(totalLength);
  let offset = 0;
  for (let array of arrays) {
    assertUint8ArrayOrArrayBuffer(array);
    array = toUint8ArrayIfArrayBuffer(array);
    returnValue.set(array, offset);
    offset += array.length;
  }
  return returnValue;
}
__name(concatUint8Arrays, "concatUint8Arrays");
var cachedDecoders = {
  utf8: new globalThis.TextDecoder("utf8")
};
function assertString(value) {
  if (typeof value !== "string") {
    throw new TypeError(`Expected \`string\`, got \`${typeof value}\``);
  }
}
__name(assertString, "assertString");
var cachedEncoder = new globalThis.TextEncoder();
function stringToUint8Array(string) {
  assertString(string);
  return cachedEncoder.encode(string);
}
__name(stringToUint8Array, "stringToUint8Array");
function base64ToBase64Url(base64) {
  return base64.replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "");
}
__name(base64ToBase64Url, "base64ToBase64Url");
function base64UrlToBase64(base64url) {
  const base64 = base64url.replaceAll("-", "+").replaceAll("_", "/");
  const padding = (4 - base64.length % 4) % 4;
  return base64 + "=".repeat(padding);
}
__name(base64UrlToBase64, "base64UrlToBase64");
var MAX_BLOCK_SIZE = 65535;
function uint8ArrayToBase64(array, { urlSafe = false } = {}) {
  assertUint8ArrayOrArrayBuffer(array);
  array = toUint8ArrayIfArrayBuffer(array);
  let base64 = "";
  for (let index = 0; index < array.length; index += MAX_BLOCK_SIZE) {
    const chunk = array.subarray(index, index + MAX_BLOCK_SIZE);
    base64 += globalThis.btoa(String.fromCodePoint.apply(void 0, chunk));
  }
  return urlSafe ? base64ToBase64Url(base64) : base64;
}
__name(uint8ArrayToBase64, "uint8ArrayToBase64");
function base64ToUint8Array(base64String) {
  assertString(base64String);
  return Uint8Array.from(globalThis.atob(base64UrlToBase64(base64String)), (x) => x.codePointAt(0));
}
__name(base64ToUint8Array, "base64ToUint8Array");
var byteToHexLookupTable = Array.from({ length: 256 }, (_, index) => index.toString(16).padStart(2, "0"));

// node_modules/@block65/webcrypto-web-push/dist/lib/utils.js
function encodeRecordSize(size) {
  const bytes = new Uint8Array(4);
  new DataView(bytes.buffer).setUint32(0, size);
  return bytes;
}
__name(encodeRecordSize, "encodeRecordSize");
function invariant(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}
__name(invariant, "invariant");

// node_modules/@block65/webcrypto-web-push/dist/lib/client-keys.js
async function deriveClientKeys(sub) {
  const bytes = base64ToUint8Array(sub.keys.p256dh);
  const authSecretBytes = base64ToUint8Array(sub.keys.auth);
  invariant(bytes.byteLength === 65 && bytes[0] === 4, "Subscription p256dh is not an uncompressed P-256 point");
  invariant(authSecretBytes.byteLength === 16, "Subscription auth secret is not 16 bytes");
  return {
    publicKeyBytes: bytes,
    publicKey: await crypto.subtle.importKey("raw", bytes, {
      name: "ECDH",
      namedCurve: "P-256"
    }, false, []),
    authSecretBytes
  };
}
__name(deriveClientKeys, "deriveClientKeys");

// node_modules/@block65/webcrypto-web-push/dist/lib/hkdf.js
function createHMAC(data) {
  const keyPromise = crypto.subtle.importKey("raw", data, {
    name: "HMAC",
    hash: "SHA-256"
  }, false, ["sign"]);
  return {
    hash: /* @__PURE__ */ __name(async (input) => {
      const k = await keyPromise;
      return crypto.subtle.sign("HMAC", k, input);
    }, "hash")
  };
}
__name(createHMAC, "createHMAC");
async function hkdf(salt, ikm) {
  const prkhPromise = createHMAC(salt).hash(ikm).then((prk) => createHMAC(prk));
  return {
    extract: /* @__PURE__ */ __name(async (info, len) => {
      const prkh = await prkhPromise;
      const blocks = await Array.from({ length: Math.ceil(len / 32) }, (_, i) => i).reduce(async (acc, i) => {
        const previous = await acc;
        const hash2 = await prkh.hash(new Uint8Array([...previous.at(-1) ?? [], ...info, i + 1]));
        return [...previous, new Uint8Array(hash2)];
      }, Promise.resolve([]));
      return concatUint8Arrays(blocks).slice(0, len);
    }, "extract")
  };
}
__name(hkdf, "hkdf");

// node_modules/@block65/webcrypto-web-push/dist/lib/info.js
function createKeyInfo(clientPublic, serverPublic) {
  return new Uint8Array([
    ...stringToUint8Array("WebPush: info\0"),
    ...clientPublic,
    ...serverPublic
  ]);
}
__name(createKeyInfo, "createKeyInfo");
function createInfo(type) {
  return stringToUint8Array(`Content-Encoding: ${type}\0`);
}
__name(createInfo, "createInfo");

// node_modules/@block65/webcrypto-web-push/dist/lib/local-keys.js
async function generateLocalKeys() {
  const keyPair = await crypto.subtle.generateKey({
    name: "ECDH",
    namedCurve: "P-256"
  }, false, ["deriveBits"]);
  return {
    privateKey: keyPair.privateKey,
    publicKeyBytes: new Uint8Array(await crypto.subtle.exportKey("raw", keyPair.publicKey))
  };
}
__name(generateLocalKeys, "generateLocalKeys");

// node_modules/@block65/webcrypto-web-push/dist/lib/salt.js
async function getSalt() {
  return crypto.getRandomValues(new Uint8Array(16));
}
__name(getSalt, "getSalt");

// node_modules/@block65/webcrypto-web-push/dist/lib/encrypt.js
var recordSize = 4096;
var headerSize = 21 + 65;
var maxPlaintextSize = recordSize - headerSize - 17;
async function encryptNotification(subscription, plaintext, options = {}) {
  invariant(plaintext.byteLength <= maxPlaintextSize, `Payload is ${plaintext.byteLength} bytes, the maximum is ${maxPlaintextSize}`);
  const clientKeys = await deriveClientKeys(subscription);
  const salt = await getSalt();
  const localKeys = await generateLocalKeys();
  const sharedSecret = await crypto.subtle.deriveBits({
    name: "ECDH",
    public: clientKeys.publicKey
  }, localKeys.privateKey, 256);
  const keyInfo = createKeyInfo(clientKeys.publicKeyBytes, localKeys.publicKeyBytes);
  const cekInfo = createInfo("aes128gcm");
  const nonceInfo = createInfo("nonce");
  const ikmHkdf = await hkdf(clientKeys.authSecretBytes, sharedSecret);
  const ikm = await ikmHkdf.extract(keyInfo, 32);
  const messageHkdf = await hkdf(salt, ikm);
  const cekBytes = await messageHkdf.extract(cekInfo, 16);
  const nonceBytes = await messageHkdf.extract(nonceInfo, 12);
  const cekCryptoKey = await crypto.subtle.importKey("raw", cekBytes, {
    name: "AES-GCM",
    length: 128
  }, false, ["encrypt"]);
  const padTo = options.pad ?? true ? maxPlaintextSize : plaintext.byteLength;
  const padded = new Uint8Array(padTo + 1);
  padded.set(plaintext);
  padded[plaintext.byteLength] = 2;
  const encrypted = await crypto.subtle.encrypt({
    name: "AES-GCM",
    iv: nonceBytes
  }, cekCryptoKey, padded);
  return new Uint8Array([
    ...salt,
    ...encodeRecordSize(recordSize),
    localKeys.publicKeyBytes.byteLength,
    ...localKeys.publicKeyBytes,
    ...new Uint8Array(encrypted)
  ]);
}
__name(encryptNotification, "encryptNotification");

// node_modules/@block65/webcrypto-web-push/dist/lib/base64.js
function encodeBase64Url(value) {
  return uint8ArrayToBase64(toUint8Array(value), { urlSafe: true });
}
__name(encodeBase64Url, "encodeBase64Url");
function objectToBase64Url(obj) {
  return encodeBase64Url(stringToUint8Array(JSON.stringify(obj)));
}
__name(objectToBase64Url, "objectToBase64Url");

// node_modules/@block65/webcrypto-web-push/dist/lib/jwt.js
async function sign(payload, key) {
  const headerStr = objectToBase64Url({
    typ: "JWT",
    alg: "ES256"
  });
  const payloadStr = objectToBase64Url({
    iat: Math.floor(Date.now() / 1e3),
    ...payload
  });
  const dataStr = `${headerStr}.${payloadStr}`;
  const signature = await crypto.subtle.sign({
    name: "ECDSA",
    hash: "SHA-256"
  }, key, stringToUint8Array(dataStr));
  return `${dataStr}.${encodeBase64Url(signature)}`;
}
__name(sign, "sign");

// node_modules/@block65/webcrypto-web-push/dist/lib/vapid.js
async function vapidHeaders(subscription, vapid) {
  invariant(vapid.subject, "Vapid subject is empty");
  invariant(vapid.privateKey, "Vapid private key is empty");
  invariant(vapid.publicKey, "Vapid public key is empty");
  const endpoint = new URL(subscription.endpoint);
  invariant(endpoint.protocol === "https:", `Subscription endpoint is not https: ${endpoint.protocol}`);
  const vapidPublicKeyBytes = base64ToUint8Array(vapid.publicKey);
  const publicKey = await crypto.subtle.importKey("jwk", {
    kty: "EC",
    crv: "P-256",
    x: encodeBase64Url(vapidPublicKeyBytes.slice(1, 33)),
    y: encodeBase64Url(vapidPublicKeyBytes.slice(33, 65)),
    d: vapid.privateKey
  }, {
    name: "ECDSA",
    namedCurve: "P-256"
  }, false, ["sign"]);
  const jwt = await sign({
    aud: endpoint.origin,
    exp: Math.floor(Date.now() / 1e3) + 12 * 60 * 60,
    sub: vapid.subject
  }, publicKey);
  return {
    headers: {
      authorization: `vapid t=${jwt}, k=${vapid.publicKey}`
    }
  };
}
__name(vapidHeaders, "vapidHeaders");

// node_modules/@block65/webcrypto-web-push/dist/lib/payload.js
async function buildPushPayload(message, subscription, vapid) {
  const { headers } = await vapidHeaders(subscription, vapid);
  const body2 = await encryptNotification(subscription, stringToUint8Array(
    // if its a primitive, convert to string, otherwise stringify
    typeof message.data === "string" || typeof message.data === "number" ? message.data.toString() : JSON.stringify(message.data)
  ));
  return {
    headers: {
      ...headers,
      ttl: (message.options?.ttl || 60).toString(),
      ...message.options?.urgency && {
        urgency: message.options.urgency
      },
      ...message.options?.topic && {
        topic: message.options.topic
      },
      "content-encoding": "aes128gcm",
      "content-length": body2.byteLength.toString(),
      "content-type": "application/octet-stream"
    },
    method: "post",
    body: body2
  };
}
__name(buildPushPayload, "buildPushPayload");

// public/core.mjs
function todayKey(now = /* @__PURE__ */ new Date()) {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Tbilisi", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(now);
  const get = /* @__PURE__ */ __name((type) => parts.find((p) => p.type === type).value, "get");
  return `${get("year")}-${get("month")}-${get("day")}`;
}
__name(todayKey, "todayKey");
function validDate(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const d = /* @__PURE__ */ new Date(value + "T00:00:00Z");
  return Number.isFinite(+d) && d.toISOString().slice(0, 10) === value && value >= "2000-01-01" && value <= "2100-12-31";
}
__name(validDate, "validDate");
function validateOrder(input) {
  if (!input || typeof input !== "object") throw new Error("\u10E8\u10D4\u10D9\u10D5\u10D4\u10D7\u10D8\u10E1 \u10D8\u10DC\u10E4\u10DD\u10E0\u10DB\u10D0\u10EA\u10D8\u10D0 \u10D0\u10E0\u10D0\u10E1\u10EC\u10DD\u10E0\u10D8\u10D0.");
  const result = {};
  for (const [field, label, max] of [["customer", "\u10E1\u10D0\u10EE\u10D4\u10DA\u10D8 \u10D3\u10D0 \u10D2\u10D5\u10D0\u10E0\u10D8", 160], ["product", "\u10DE\u10E0\u10DD\u10D3\u10E3\u10E5\u10E2\u10D8", 500], ["region", "\u10E5\u10D0\u10DA\u10D0\u10E5\u10D8 / \u10E0\u10D4\u10D2\u10D8\u10DD\u10DC\u10D8", 120], ["address", "\u10D6\u10E3\u10E1\u10E2\u10D8 \u10DB\u10D8\u10E1\u10D0\u10DB\u10D0\u10E0\u10D7\u10D8", 1e3], ["phone", "\u10E2\u10D4\u10DA\u10D4\u10E4\u10DD\u10DC\u10D8\u10E1 \u10DC\u10DD\u10DB\u10D4\u10E0\u10D8", 40]]) {
    if (typeof input[field] !== "string" || !input[field].trim() || input[field].trim().length > max) throw new Error(`\u10E8\u10D4\u10D0\u10D5\u10E1\u10D4 \u10D5\u10D4\u10DA\u10D8: ${label}`);
    result[field] = input[field].trim();
  }
  const digits = result.phone.replace(/\D/g, "");
  if (digits.length < 9 || digits.length > 15 || !/^\+?[\d\s()\-]+$/.test(result.phone)) throw new Error("\u10E2\u10D4\u10DA\u10D4\u10E4\u10DD\u10DC\u10D8\u10E1 \u10DC\u10DD\u10DB\u10D4\u10E0\u10D8 \u10E3\u10DC\u10D3\u10D0 \u10E8\u10D4\u10D8\u10EA\u10D0\u10D5\u10D3\u10D4\u10E1 9\u201315 \u10EA\u10D8\u10E4\u10E0\u10E1.");
  if (!Number.isSafeInteger(input.priceCents) || input.priceCents < 0 || input.priceCents > 999999999) throw new Error("\u10E4\u10D0\u10E1\u10D8 \u10D0\u10E0\u10D0\u10E1\u10EC\u10DD\u10E0\u10D8\u10D0.");
  result.priceCents = input.priceCents;
  if (!validDate(input.shipDate)) throw new Error("\u10D0\u10D8\u10E0\u10E9\u10D8\u10D4 \u10E1\u10EC\u10DD\u10E0\u10D8 \u10D2\u10D0\u10D2\u10D6\u10D0\u10D5\u10DC\u10D8\u10E1 \u10D7\u10D0\u10E0\u10D8\u10E6\u10D8.");
  result.shipDate = input.shipDate;
  for (const [field, max] of [["deliveryTime", 120], ["notes", 3e3]]) {
    if (typeof input[field] !== "string" || input[field].length > max) throw new Error("\u10D3\u10D0\u10DB\u10D0\u10E2\u10D4\u10D1\u10D8\u10D7\u10D8 \u10D8\u10DC\u10E4\u10DD\u10E0\u10DB\u10D0\u10EA\u10D8\u10D0 \u10EB\u10D0\u10DA\u10D8\u10D0\u10DC \u10D2\u10E0\u10EB\u10D4\u10DA\u10D8\u10D0.");
    result[field] = input[field].trim();
  }
  return result;
}
__name(validateOrder, "validateOrder");

// server/worker.mjs
var SESSION_DURATION = 400 * 864e5;
var json = /* @__PURE__ */ __name((data, status = 200, headers = {}) => Response.json(data, { status, headers: { "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff", ...headers } }), "json");
var error = /* @__PURE__ */ __name((message, status = 400) => json({ error: message }, status), "error");
function toOrder(r) {
  return { id: r.id, customer: r.customer, product: r.product, priceCents: r.price_cents, region: r.region, address: r.address, phone: r.phone, shipDate: r.ship_date, deliveryTime: r.delivery_time, notes: r.notes, status: r.status, createdAt: r.created_at, updatedAt: r.updated_at, sentAt: r.sent_at, version: r.version };
}
__name(toOrder, "toOrder");
async function hash(value) {
  return [...new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value)))].map((v) => v.toString(16).padStart(2, "0")).join("");
}
__name(hash, "hash");
async function secureEqual(a, b) {
  const x = await hash(a), y = await hash(b);
  let diff = 0;
  for (let i = 0; i < x.length; i++) diff |= x.charCodeAt(i) ^ y.charCodeAt(i);
  return diff === 0;
}
__name(secureEqual, "secureEqual");
function cookie(request, value, maxAge = SESSION_DURATION / 1e3) {
  return `orders_session=${value}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${maxAge}${new URL(request.url).protocol === "https:" ? "; Secure" : ""}`;
}
__name(cookie, "cookie");
async function body(request) {
  if (Number(request.headers.get("Content-Length") || 0) > 16384) throw new Error("\u10D8\u10DC\u10E4\u10DD\u10E0\u10DB\u10D0\u10EA\u10D8\u10D0 \u10EB\u10D0\u10DA\u10D8\u10D0\u10DC \u10D3\u10D8\u10D3\u10D8\u10D0.");
  const text = await request.text();
  if (text.length > 16384) throw new Error("\u10D8\u10DC\u10E4\u10DD\u10E0\u10DB\u10D0\u10EA\u10D8\u10D0 \u10EB\u10D0\u10DA\u10D8\u10D0\u10DC \u10D3\u10D8\u10D3\u10D8\u10D0.");
  try {
    return JSON.parse(text);
  } catch {
    throw new Error("\u10D8\u10DC\u10E4\u10DD\u10E0\u10DB\u10D0\u10EA\u10D8\u10D0 \u10D0\u10E0\u10D0\u10E1\u10EC\u10DD\u10E0 \u10E4\u10DD\u10E0\u10DB\u10D0\u10E2\u10E8\u10D8\u10D0.");
  }
}
__name(body, "body");
async function session(request, env, { renew = false } = {}) {
  const token = request.headers.get("Cookie")?.match(/(?:^|;\s*)orders_session=([a-f0-9]{64})(?:;|$)/)?.[1];
  if (!token) return null;
  const tokenHash = await hash(token), row = await env.DB.prepare("SELECT expires_at FROM sessions WHERE token_hash = ?").bind(tokenHash).first();
  if (!row || row.expires_at <= Date.now()) return null;
  if (renew) await env.DB.prepare("UPDATE sessions SET expires_at = ? WHERE token_hash = ?").bind(Date.now() + SESSION_DURATION, tokenHash).run();
  return token;
}
__name(session, "session");
var isUUID = /* @__PURE__ */ __name((v) => typeof v === "string" && /^[a-f\d]{8}-[a-f\d]{4}-4[a-f\d]{3}-[89ab][a-f\d]{3}-[a-f\d]{12}$/i.test(v), "isUUID");
var validVersion = /* @__PURE__ */ __name((v) => Number.isSafeInteger(v) && v > 0, "validVersion");
var rowFor = /* @__PURE__ */ __name((env, id) => env.DB.prepare("SELECT * FROM orders WHERE id = ?").bind(id).first(), "rowFor");
async function login(request, env) {
  const input = await body(request);
  if (typeof input.password !== "string" || input.password.length > 256) return error("\u10DE\u10D0\u10E0\u10DD\u10DA\u10D8 \u10D0\u10E0\u10D0\u10E1\u10EC\u10DD\u10E0\u10D8\u10D0.", 401);
  const now = Date.now(), ipHash = await hash((request.headers.get("CF-Connecting-IP") || "local") + env.APP_PASSWORD);
  await env.DB.prepare("DELETE FROM login_attempts WHERE first_attempt < ?").bind(now - 15 * 6e4).run();
  const attempt = await env.DB.prepare("SELECT attempts FROM login_attempts WHERE ip_hash = ?").bind(ipHash).first();
  if (attempt?.attempts >= 10) return error("\u10D1\u10D4\u10D5\u10E0\u10D8 \u10DB\u10EA\u10D3\u10D4\u10DA\u10DD\u10D1\u10D0\u10D0. \u10E1\u10EA\u10D0\u10D3\u10D4 15 \u10EC\u10E3\u10D7\u10E8\u10D8.", 429);
  if (!await secureEqual(input.password, env.APP_PASSWORD)) {
    await env.DB.prepare("INSERT INTO login_attempts (ip_hash, attempts, first_attempt) VALUES (?, 1, ?) ON CONFLICT(ip_hash) DO UPDATE SET attempts = attempts + 1").bind(ipHash, now).run();
    return error("\u10DE\u10D0\u10E0\u10DD\u10DA\u10D8 \u10D0\u10E0\u10D0\u10E1\u10EC\u10DD\u10E0\u10D8\u10D0.", 401);
  }
  const token = [...crypto.getRandomValues(new Uint8Array(32))].map((v) => v.toString(16).padStart(2, "0")).join("");
  await env.DB.batch([env.DB.prepare("DELETE FROM login_attempts WHERE ip_hash = ?").bind(ipHash), env.DB.prepare("DELETE FROM sessions WHERE expires_at < ?").bind(now), env.DB.prepare("INSERT INTO sessions (token_hash, expires_at) VALUES (?, ?)").bind(await hash(token), now + SESSION_DURATION)]);
  return json({ ok: true }, 200, { "Set-Cookie": cookie(request, token) });
}
__name(login, "login");
function validateSubscription(input) {
  if (!input || typeof input.endpoint !== "string" || input.endpoint.length > 2048) throw new Error("\u10E8\u10D4\u10E2\u10E7\u10DD\u10D1\u10D8\u10DC\u10D4\u10D1\u10D8\u10E1 \u10DB\u10D8\u10E1\u10D0\u10DB\u10D0\u10E0\u10D7\u10D8 \u10D0\u10E0\u10D0\u10E1\u10EC\u10DD\u10E0\u10D8\u10D0.");
  let url;
  try {
    url = new URL(input.endpoint);
  } catch {
    throw new Error("\u10E8\u10D4\u10E2\u10E7\u10DD\u10D1\u10D8\u10DC\u10D4\u10D1\u10D8\u10E1 \u10DB\u10D8\u10E1\u10D0\u10DB\u10D0\u10E0\u10D7\u10D8 \u10D0\u10E0\u10D0\u10E1\u10EC\u10DD\u10E0\u10D8\u10D0.");
  }
  const h = url.hostname, allowed = h === "fcm.googleapis.com" || h === "updates.push.services.mozilla.com" || h.endsWith(".push.services.mozilla.com") || h.endsWith(".push.apple.com") || h === "push.apple.com" || h.endsWith(".notify.windows.com");
  if (url.protocol !== "https:" || url.port || url.username || url.password || !allowed) throw new Error("\u10E8\u10D4\u10E2\u10E7\u10DD\u10D1\u10D8\u10DC\u10D4\u10D1\u10D8\u10E1 \u10E1\u10D4\u10E0\u10D5\u10D8\u10E1\u10D8 \u10D0\u10E0 \u10D0\u10E0\u10D8\u10E1 \u10DB\u10EE\u10D0\u10E0\u10D3\u10D0\u10ED\u10D4\u10E0\u10D8\u10DA\u10D8.");
  for (const [key, length] of [["p256dh", 65], ["auth", 16]]) {
    const v = input.keys?.[key];
    if (typeof v !== "string" || !/^[\w-]+={0,2}$/.test(v) || v.length > 100) throw new Error("\u10E8\u10D4\u10E2\u10E7\u10DD\u10D1\u10D8\u10DC\u10D4\u10D1\u10D8\u10E1 \u10D2\u10D0\u10E1\u10D0\u10E6\u10D4\u10D1\u10D8 \u10D0\u10E0\u10D0\u10E1\u10EC\u10DD\u10E0\u10D8\u10D0.");
    try {
      const bytes = Uint8Array.from(atob(v.replace(/-/g, "+").replace(/_/g, "/")), (c) => c.charCodeAt(0));
      if (bytes.length !== length || key === "p256dh" && bytes[0] !== 4) throw new Error();
    } catch {
      throw new Error("\u10E8\u10D4\u10E2\u10E7\u10DD\u10D1\u10D8\u10DC\u10D4\u10D1\u10D8\u10E1 \u10D2\u10D0\u10E1\u10D0\u10E6\u10D4\u10D1\u10D8 \u10D0\u10E0\u10D0\u10E1\u10EC\u10DD\u10E0\u10D8\u10D0.");
    }
  }
  return { endpoint: input.endpoint, expirationTime: null, keys: { p256dh: input.keys.p256dh, auth: input.keys.auth } };
}
__name(validateSubscription, "validateSubscription");
async function sendPush(env, subscription, payload) {
  const init = await buildPushPayload({ data: JSON.stringify(payload), options: { ttl: 14400 } }, subscription, { subject: env.VAPID_SUBJECT, publicKey: env.VAPID_PUBLIC_KEY, privateKey: env.VAPID_PRIVATE_KEY });
  return (await fetch(subscription.endpoint, { ...init, redirect: "error", signal: AbortSignal.timeout(1e4) })).status;
}
__name(sendPush, "sendPush");
async function sendDailyReminders(env, scheduledTime = Date.now(), sender = sendPush) {
  if (!env.DB || !env.VAPID_PUBLIC_KEY || !env.VAPID_PRIVATE_KEY || !env.VAPID_SUBJECT) return { sent: 0, reason: "not-configured" };
  const day = todayKey(new Date(scheduledTime)), count = await env.DB.prepare("SELECT COUNT(*) AS total FROM orders WHERE status = 'pending' AND ship_date = ?").bind(day).first();
  if (!count?.total) return { sent: 0, reason: "no-orders" };
  const { results } = await env.DB.prepare("SELECT endpoint, subscription FROM push_subscriptions WHERE last_sent_date IS NULL OR last_sent_date != ?").bind(day).all();
  let sent = 0;
  for (const row of results) {
    try {
      const status = await sender(env, JSON.parse(row.subscription), { title: "\u10D3\u10E6\u10D4\u10D5\u10D0\u10DC\u10D3\u10D4\u10DA\u10D8 \u10E8\u10D4\u10D9\u10D5\u10D4\u10D7\u10D4\u10D1\u10D8", body: `\u10D3\u10E6\u10D4\u10E1 ${count.total} \u10E8\u10D4\u10D9\u10D5\u10D4\u10D7\u10D0 \u10D2\u10D0\u10E5\u10D5\u10E1 \u10D2\u10D0\u10E1\u10D0\u10D2\u10D6\u10D0\u10D5\u10DC\u10D8.`, url: "/?filter=today", tag: "orders-" + day });
      if (status >= 200 && status < 300) {
        await env.DB.prepare("UPDATE push_subscriptions SET last_sent_date = ?, failures = 0 WHERE endpoint = ?").bind(day, row.endpoint).run();
        sent++;
      } else if (status === 404 || status === 410) await env.DB.prepare("DELETE FROM push_subscriptions WHERE endpoint = ?").bind(row.endpoint).run();
      else {
        await env.DB.prepare("UPDATE push_subscriptions SET failures = failures + 1 WHERE endpoint = ?").bind(row.endpoint).run();
        console.error("Push rejected", status);
      }
    } catch {
      console.error("Push delivery failed");
    }
  }
  await env.DB.prepare("DELETE FROM sessions WHERE expires_at < ?").bind(Date.now()).run();
  return { sent, count: count.total };
}
__name(sendDailyReminders, "sendDailyReminders");
async function handleApi(request, env) {
  const url = new URL(request.url), path = url.pathname, method = request.method;
  if (request.headers.get("Sec-Fetch-Site") === "cross-site" || request.headers.get("Origin") && request.headers.get("Origin") !== url.origin) return error("\u10D0\u10DB \u10DB\u10DD\u10D7\u10EE\u10DD\u10D5\u10DC\u10D8\u10E1 \u10E8\u10D4\u10E1\u10E0\u10E3\u10DA\u10D4\u10D1\u10D0 \u10D3\u10D0\u10E3\u10E8\u10D5\u10D4\u10D1\u10D4\u10DA\u10D8\u10D0.", 403);
  if (path === "/api/config" && method === "GET") return json({ ready: Boolean(env.DB && env.APP_PASSWORD), pushReady: Boolean(env.VAPID_PUBLIC_KEY && env.VAPID_PRIVATE_KEY && env.VAPID_SUBJECT), pushPublicKey: env.VAPID_PUBLIC_KEY || null });
  if (!env.DB || !env.APP_PASSWORD) return error("\u10E1\u10D0\u10D8\u10E2\u10E1 Cloudflare-\u10D6\u10D4 \u10D2\u10D0\u10DB\u10D0\u10E0\u10D7\u10D5\u10D0 \u10E1\u10ED\u10D8\u10E0\u10D3\u10D4\u10D1\u10D0.", 503);
  if (path === "/api/login" && method === "POST") return login(request, env);
  if (path === "/api/session" && method === "GET") {
    const token = await session(request, env, { renew: true });
    return json({ authenticated: Boolean(token) }, 200, token ? { "Set-Cookie": cookie(request, token) } : {});
  }
  if (!await session(request, env)) return error("\u10E8\u10D4\u10D3\u10D8\u10D7 \u10DB\u10D0\u10E6\u10D0\u10D6\u10D8\u10D8\u10E1 \u10DE\u10D0\u10E0\u10DD\u10DA\u10D8\u10D7.", 401);
  if (path === "/api/logout" && method === "POST") {
    const token = request.headers.get("Cookie")?.match(/orders_session=([a-f0-9]{64})/)?.[1];
    if (token) await env.DB.prepare("DELETE FROM sessions WHERE token_hash = ?").bind(await hash(token)).run();
    return json({ ok: true }, 200, { "Set-Cookie": cookie(request, "", 0) });
  }
  if (path === "/api/orders" && method === "GET") {
    const { results } = await env.DB.prepare("SELECT * FROM orders ORDER BY created_at DESC").all();
    return json({ orders: results.map(toOrder) });
  }
  if (path === "/api/orders" && method === "POST") {
    const input = await body(request);
    if (!isUUID(input.id)) return error("\u10E8\u10D4\u10D9\u10D5\u10D4\u10D7\u10D8\u10E1 \u10DC\u10DD\u10DB\u10D4\u10E0\u10D8 \u10D0\u10E0\u10D0\u10E1\u10EC\u10DD\u10E0\u10D8\u10D0.");
    const o = validateOrder(input), now = Date.now(), existing = await rowFor(env, input.id);
    if (existing) return json({ order: toOrder(existing) });
    await env.DB.prepare("INSERT INTO orders (id, customer, product, price_cents, region, address, phone, ship_date, delivery_time, notes, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(id) DO NOTHING").bind(input.id, o.customer, o.product, o.priceCents, o.region, o.address, o.phone, o.shipDate, o.deliveryTime, o.notes, now, now).run();
    return json({ order: toOrder(await rowFor(env, input.id)) }, 201);
  }
  const match = path.match(/^\/api\/orders\/([a-f\d-]+)(\/status)?$/i);
  if (match) {
    const id = match[1];
    if (!isUUID(id)) return error("\u10E8\u10D4\u10D9\u10D5\u10D4\u10D7\u10D0 \u10D5\u10D4\u10E0 \u10DB\u10DD\u10D8\u10EB\u10D4\u10D1\u10DC\u10D0.", 404);
    const input = await body(request);
    if (!validVersion(input.version)) return error("\u10D2\u10D0\u10DC\u10D0\u10D0\u10EE\u10DA\u10D4 \u10E8\u10D4\u10D9\u10D5\u10D4\u10D7\u10D0 \u10D3\u10D0 \u10E1\u10EA\u10D0\u10D3\u10D4 \u10EE\u10D4\u10DA\u10D0\u10EE\u10DA\u10D0.");
    let result;
    if (method === "PUT" && !match[2]) {
      const o = validateOrder(input);
      result = await env.DB.prepare("UPDATE orders SET customer = ?, product = ?, price_cents = ?, region = ?, address = ?, phone = ?, ship_date = ?, delivery_time = ?, notes = ?, updated_at = ?, version = version + 1 WHERE id = ? AND version = ?").bind(o.customer, o.product, o.priceCents, o.region, o.address, o.phone, o.shipDate, o.deliveryTime, o.notes, Date.now(), id, input.version).run();
    } else if (method === "PATCH" && match[2]) {
      if (!["pending", "sent"].includes(input.status)) return error("\u10E1\u10E2\u10D0\u10E2\u10E3\u10E1\u10D8 \u10D0\u10E0\u10D0\u10E1\u10EC\u10DD\u10E0\u10D8\u10D0.");
      result = await env.DB.prepare("UPDATE orders SET status = ?, sent_at = ?, updated_at = ?, version = version + 1 WHERE id = ? AND version = ?").bind(input.status, input.status === "sent" ? Date.now() : null, Date.now(), id, input.version).run();
    } else if (method === "DELETE" && !match[2]) result = await env.DB.prepare("DELETE FROM orders WHERE id = ? AND version = ?").bind(id, input.version).run();
    else return error("\u10DB\u10DD\u10E5\u10DB\u10D4\u10D3\u10D4\u10D1\u10D0 \u10D0\u10E0 \u10D0\u10E0\u10D8\u10E1 \u10DB\u10EE\u10D0\u10E0\u10D3\u10D0\u10ED\u10D4\u10E0\u10D8\u10DA\u10D8.", 405);
    if (!result.meta.changes) {
      if (!await rowFor(env, id)) return error("\u10E8\u10D4\u10D9\u10D5\u10D4\u10D7\u10D0 \u10E3\u10D9\u10D5\u10D4 \u10EC\u10D0\u10E8\u10DA\u10D8\u10DA\u10D8\u10D0.", 404);
      return error("\u10E8\u10D4\u10D9\u10D5\u10D4\u10D7\u10D0 \u10E1\u10EE\u10D5\u10D0 \u10DB\u10DD\u10EC\u10E7\u10DD\u10D1\u10D8\u10DA\u10DD\u10D1\u10D0\u10D6\u10D4 \u10E8\u10D4\u10D8\u10EA\u10D5\u10D0\u10DA\u10D0. \u10D2\u10D0\u10D3\u10D0\u10EE\u10D4\u10D3\u10D4 \u10D0\u10EE\u10D0\u10DA \u10D8\u10DC\u10E4\u10DD\u10E0\u10DB\u10D0\u10EA\u10D8\u10D0\u10E1 \u10D3\u10D0 \u10E1\u10EA\u10D0\u10D3\u10D4 \u10EE\u10D4\u10DA\u10D0\u10EE\u10DA\u10D0.", 409);
    }
    return method === "DELETE" ? json({ ok: true }) : json({ order: toOrder(await rowFor(env, id)) });
  }
  if (path === "/api/subscriptions" && method === "POST") {
    if (!env.VAPID_PUBLIC_KEY || !env.VAPID_PRIVATE_KEY || !env.VAPID_SUBJECT) return error("\u10E8\u10D4\u10EE\u10E1\u10D4\u10DC\u10D4\u10D1\u10D0 \u10EF\u10D4\u10E0 \u10D0\u10E0 \u10D0\u10E0\u10D8\u10E1 \u10D2\u10D0\u10DB\u10D0\u10E0\u10D7\u10E3\u10DA\u10D8.", 503);
    const sub = validateSubscription(await body(request)), existing = await env.DB.prepare("SELECT endpoint FROM push_subscriptions WHERE endpoint = ?").bind(sub.endpoint).first();
    if (!existing) {
      const total = await env.DB.prepare("SELECT COUNT(*) AS total FROM push_subscriptions").first();
      if (total.total >= 30) return error("\u10E8\u10D4\u10EE\u10E1\u10D4\u10DC\u10D4\u10D1\u10D0 \u10E3\u10D9\u10D5\u10D4 \u10D1\u10D4\u10D5\u10E0 \u10DB\u10DD\u10EC\u10E7\u10DD\u10D1\u10D8\u10DA\u10DD\u10D1\u10D0\u10D6\u10D4\u10D0 \u10E9\u10D0\u10E0\u10D7\u10E3\u10DA\u10D8. \u10D2\u10D0\u10DB\u10DD\u10E0\u10D7\u10D4 \u10EB\u10D5\u10D4\u10DA \u10DB\u10DD\u10EC\u10E7\u10DD\u10D1\u10D8\u10DA\u10DD\u10D1\u10D0\u10D6\u10D4.", 409);
    }
    await env.DB.prepare("INSERT INTO push_subscriptions (endpoint, subscription, created_at) VALUES (?, ?, ?) ON CONFLICT(endpoint) DO UPDATE SET subscription = excluded.subscription").bind(sub.endpoint, JSON.stringify(sub), Date.now()).run();
    return json({ ok: true });
  }
  if (path === "/api/subscriptions" && method === "DELETE") {
    const input = await body(request);
    if (typeof input.endpoint !== "string") return error("\u10E8\u10D4\u10E2\u10E7\u10DD\u10D1\u10D8\u10DC\u10D4\u10D1\u10D8\u10E1 \u10DB\u10D8\u10E1\u10D0\u10DB\u10D0\u10E0\u10D7\u10D8 \u10D0\u10E0\u10D0\u10E1\u10EC\u10DD\u10E0\u10D8\u10D0.");
    await env.DB.prepare("DELETE FROM push_subscriptions WHERE endpoint = ?").bind(input.endpoint).run();
    return json({ ok: true });
  }
  if (path === "/api/push/test" && method === "POST") {
    const input = await body(request);
    if (typeof input.endpoint !== "string") return error("\u10E8\u10D4\u10E2\u10E7\u10DD\u10D1\u10D8\u10DC\u10D4\u10D1\u10D8\u10E1 \u10DB\u10D8\u10E1\u10D0\u10DB\u10D0\u10E0\u10D7\u10D8 \u10D0\u10E0\u10D0\u10E1\u10EC\u10DD\u10E0\u10D8\u10D0.");
    const row = await env.DB.prepare("SELECT subscription FROM push_subscriptions WHERE endpoint = ?").bind(input.endpoint).first();
    if (!row) return error("\u10EF\u10D4\u10E0 \u10E9\u10D0\u10E0\u10D7\u10D4 \u10E8\u10D4\u10EE\u10E1\u10D4\u10DC\u10D4\u10D1\u10D0.", 404);
    const status = await sendPush(env, JSON.parse(row.subscription), { title: "\u10E8\u10D4\u10EE\u10E1\u10D4\u10DC\u10D4\u10D1\u10D0 \u10DB\u10E3\u10E8\u10D0\u10DD\u10D1\u10E1", body: "\u10D3\u10E6\u10D4\u10D5\u10D0\u10DC\u10D3\u10D4\u10DA\u10D8 \u10D2\u10D0\u10E1\u10D0\u10D2\u10D6\u10D0\u10D5\u10DC\u10D8 \u10E8\u10D4\u10D9\u10D5\u10D4\u10D7\u10D4\u10D1\u10D8\u10E1 \u10E8\u10D4\u10EE\u10E1\u10D4\u10DC\u10D4\u10D1\u10D0 \u10DB\u10DD\u10D5\u10D0 12:00-\u10D6\u10D4.", tag: "orders-test" });
    if (status >= 200 && status < 300) return json({ ok: true });
    if (status === 404 || status === 410) await env.DB.prepare("DELETE FROM push_subscriptions WHERE endpoint = ?").bind(input.endpoint).run();
    return error("\u10E8\u10D4\u10E2\u10E7\u10DD\u10D1\u10D8\u10DC\u10D4\u10D1\u10D0 \u10D5\u10D4\u10E0 \u10D2\u10D0\u10D8\u10D2\u10D6\u10D0\u10D5\u10DC\u10D0. \u10D2\u10D0\u10DB\u10DD\u10E0\u10D7\u10D4 \u10E8\u10D4\u10EE\u10E1\u10D4\u10DC\u10D4\u10D1\u10D0 \u10D3\u10D0 \u10EE\u10D4\u10DA\u10D0\u10EE\u10DA\u10D0 \u10E9\u10D0\u10E0\u10D7\u10D4.", 502);
  }
  return error("\u10DB\u10DD\u10D7\u10EE\u10DD\u10D5\u10DC\u10D0 \u10D5\u10D4\u10E0 \u10DB\u10DD\u10D8\u10EB\u10D4\u10D1\u10DC\u10D0.", 404);
}
__name(handleApi, "handleApi");
var worker_default = {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (!url.pathname.startsWith("/api/")) return env.ASSETS.fetch(request);
    try {
      return await handleApi(request, env);
    } catch (err) {
      if (err instanceof Error && /შეავსე|ფასი|თარიღი|ტელეფონის|ინფორმაცია|შეტყობინების|სერვისი|გასაღები/.test(err.message)) return error(err.message);
      console.error("Order API failed", err?.name);
      return error("\u10DB\u10DD\u10E5\u10DB\u10D4\u10D3\u10D4\u10D1\u10D0 \u10D5\u10D4\u10E0 \u10E8\u10D4\u10E1\u10E0\u10E3\u10DA\u10D3\u10D0. \u10E1\u10EA\u10D0\u10D3\u10D4 \u10EE\u10D4\u10DA\u10D0\u10EE\u10DA\u10D0; \u10E8\u10D4\u10D5\u10E1\u10D4\u10D1\u10E3\u10DA\u10D8 \u10D8\u10DC\u10E4\u10DD\u10E0\u10DB\u10D0\u10EA\u10D8\u10D0 \u10E8\u10D4\u10DC\u10D0\u10E0\u10E9\u10E3\u10DC\u10D4\u10D1\u10E3\u10DA\u10D8\u10D0.", 503);
    }
  },
  async scheduled(controller, env, ctx) {
    ctx.waitUntil(sendDailyReminders(env, controller.scheduledTime));
  }
};
export {
  worker_default as default,
  sendDailyReminders,
  sendPush,
  toOrder,
  validateSubscription
};
//# sourceMappingURL=worker.js.map
