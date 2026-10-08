import {buildPushPayload} from '@block65/webcrypto-web-push';
import {todayKey,validateOrder} from '../public/core.mjs';
const SESSION_DURATION=400*86400000;
const json=(data,status=200,headers={})=>Response.json(data,{status,headers:{'Cache-Control':'no-store','X-Content-Type-Options':'nosniff',...headers}});
const error=(message,status=400)=>json({error:message},status);
export function toOrder(r){return {id:r.id,customer:r.customer,product:r.product,priceCents:r.price_cents,region:r.region,address:r.address,phone:r.phone,shipDate:r.ship_date,deliveryTime:r.delivery_time,notes:r.notes,status:r.status,createdAt:r.created_at,updatedAt:r.updated_at,sentAt:r.sent_at,version:r.version}}
async function hash(value){return [...new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(value)))].map(v=>v.toString(16).padStart(2,'0')).join('')}
async function secureEqual(a,b){const x=await hash(a),y=await hash(b);let diff=0;for(let i=0;i<x.length;i++)diff|=x.charCodeAt(i)^y.charCodeAt(i);return diff===0}
function cookie(request,value,maxAge=SESSION_DURATION/1000){return `orders_session=${value}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${maxAge}${new URL(request.url).protocol==='https:'?'; Secure':''}`}
async function body(request){if(Number(request.headers.get('Content-Length')||0)>16384)throw new Error('ინფორმაცია ძალიან დიდია.');const text=await request.text();if(text.length>16384)throw new Error('ინფორმაცია ძალიან დიდია.');try{return JSON.parse(text)}catch{throw new Error('ინფორმაცია არასწორ ფორმატშია.')}}
async function session(request,env,{renew=false}={}){
  const token=request.headers.get('Cookie')?.match(/(?:^|;\s*)orders_session=([a-f0-9]{64})(?:;|$)/)?.[1];
  if(!token)return null;
  const tokenHash=await hash(token),row=await env.DB.prepare('SELECT expires_at FROM sessions WHERE token_hash = ?').bind(tokenHash).first();
  if(!row||row.expires_at<=Date.now())return null;
  if(renew)await env.DB.prepare('UPDATE sessions SET expires_at = ? WHERE token_hash = ?').bind(Date.now()+SESSION_DURATION,tokenHash).run();
  return token;
}
const isUUID=v=>typeof v==='string'&&/^[a-f\d]{8}-[a-f\d]{4}-4[a-f\d]{3}-[89ab][a-f\d]{3}-[a-f\d]{12}$/i.test(v);
const validVersion=v=>Number.isSafeInteger(v)&&v>0;
const rowFor=(env,id)=>env.DB.prepare('SELECT * FROM orders WHERE id = ?').bind(id).first();
async function login(request,env){
  const input=await body(request);if(typeof input.password!=='string'||input.password.length>256)return error('პაროლი არასწორია.',401);
  const now=Date.now(),ipHash=await hash((request.headers.get('CF-Connecting-IP')||'local')+env.APP_PASSWORD);
  await env.DB.prepare('DELETE FROM login_attempts WHERE first_attempt < ?').bind(now-15*60000).run();
  const attempt=await env.DB.prepare('SELECT attempts FROM login_attempts WHERE ip_hash = ?').bind(ipHash).first();if(attempt?.attempts>=10)return error('ბევრი მცდელობაა. სცადე 15 წუთში.',429);
  if(!await secureEqual(input.password,env.APP_PASSWORD)){await env.DB.prepare('INSERT INTO login_attempts (ip_hash, attempts, first_attempt) VALUES (?, 1, ?) ON CONFLICT(ip_hash) DO UPDATE SET attempts = attempts + 1').bind(ipHash,now).run();return error('პაროლი არასწორია.',401)}
  const token=[...crypto.getRandomValues(new Uint8Array(32))].map(v=>v.toString(16).padStart(2,'0')).join('');
  await env.DB.batch([env.DB.prepare('DELETE FROM login_attempts WHERE ip_hash = ?').bind(ipHash),env.DB.prepare('DELETE FROM sessions WHERE expires_at < ?').bind(now),env.DB.prepare('INSERT INTO sessions (token_hash, expires_at) VALUES (?, ?)').bind(await hash(token),now+SESSION_DURATION)]);
  return json({ok:true},200,{'Set-Cookie':cookie(request,token)});
}
export function validateSubscription(input){
  if(!input||typeof input.endpoint!=='string'||input.endpoint.length>2048)throw new Error('შეტყობინების მისამართი არასწორია.');let url;try{url=new URL(input.endpoint)}catch{throw new Error('შეტყობინების მისამართი არასწორია.')}
  const h=url.hostname,allowed=h==='fcm.googleapis.com'||h==='updates.push.services.mozilla.com'||h.endsWith('.push.services.mozilla.com')||h.endsWith('.push.apple.com')||h==='push.apple.com'||h.endsWith('.notify.windows.com');
  if(url.protocol!=='https:'||url.port||url.username||url.password||!allowed)throw new Error('შეტყობინების სერვისი არ არის მხარდაჭერილი.');
  for(const [key,length] of [['p256dh',65],['auth',16]]){const v=input.keys?.[key];if(typeof v!=='string'||!/^[\w-]+={0,2}$/.test(v)||v.length>100)throw new Error('შეტყობინების გასაღები არასწორია.');try{const bytes=Uint8Array.from(atob(v.replace(/-/g,'+').replace(/_/g,'/')),c=>c.charCodeAt(0));if(bytes.length!==length||(key==='p256dh'&&bytes[0]!==4))throw new Error()}catch{throw new Error('შეტყობინების გასაღები არასწორია.')}}
  return {endpoint:input.endpoint,expirationTime:null,keys:{p256dh:input.keys.p256dh,auth:input.keys.auth}};
}
export async function sendPush(env,subscription,payload){
  const init=await buildPushPayload({data:JSON.stringify(payload),options:{ttl:14400}},subscription,{subject:env.VAPID_SUBJECT,publicKey:env.VAPID_PUBLIC_KEY,privateKey:env.VAPID_PRIVATE_KEY});
  return (await fetch(subscription.endpoint,{...init,redirect:'error',signal:AbortSignal.timeout(10000)})).status;
}
export async function sendDailyReminders(env,scheduledTime=Date.now(),sender=sendPush){
  if(!env.DB||!env.VAPID_PUBLIC_KEY||!env.VAPID_PRIVATE_KEY||!env.VAPID_SUBJECT)return {sent:0,reason:'not-configured'};
  const day=todayKey(new Date(scheduledTime)),count=await env.DB.prepare("SELECT COUNT(*) AS total FROM orders WHERE status = 'pending' AND ship_date = ?").bind(day).first();if(!count?.total)return {sent:0,reason:'no-orders'};
  const {results}=await env.DB.prepare('SELECT endpoint, subscription FROM push_subscriptions WHERE last_sent_date IS NULL OR last_sent_date != ?').bind(day).all();let sent=0;
  for(const row of results){try{const status=await sender(env,JSON.parse(row.subscription),{title:'დღევანდელი შეკვეთები',body:`დღეს ${count.total} შეკვეთა გაქვს გასაგზავნი.`,url:'/?filter=today',tag:'orders-'+day});if(status>=200&&status<300){await env.DB.prepare('UPDATE push_subscriptions SET last_sent_date = ?, failures = 0 WHERE endpoint = ?').bind(day,row.endpoint).run();sent++}else if(status===404||status===410)await env.DB.prepare('DELETE FROM push_subscriptions WHERE endpoint = ?').bind(row.endpoint).run();else{await env.DB.prepare('UPDATE push_subscriptions SET failures = failures + 1 WHERE endpoint = ?').bind(row.endpoint).run();console.error('Push rejected',status)}}catch{console.error('Push delivery failed')}}
  await env.DB.prepare('DELETE FROM sessions WHERE expires_at < ?').bind(Date.now()).run();return {sent,count:count.total};
}
async function handleApi(request,env){
  const url=new URL(request.url),path=url.pathname,method=request.method;
  if(request.headers.get('Sec-Fetch-Site')==='cross-site'||(request.headers.get('Origin')&&request.headers.get('Origin')!==url.origin))return error('ამ მოთხოვნის შესრულება დაუშვებელია.',403);
  if(path==='/api/config'&&method==='GET')return json({ready:Boolean(env.DB&&env.APP_PASSWORD),pushReady:Boolean(env.VAPID_PUBLIC_KEY&&env.VAPID_PRIVATE_KEY&&env.VAPID_SUBJECT),pushPublicKey:env.VAPID_PUBLIC_KEY||null});
  if(!env.DB||!env.APP_PASSWORD)return error('საიტს Cloudflare-ზე გამართვა სჭირდება.',503);
  if(path==='/api/login'&&method==='POST')return login(request,env);
  if(path==='/api/session'&&method==='GET'){const token=await session(request,env,{renew:true});return json({authenticated:Boolean(token)},200,token?{'Set-Cookie':cookie(request,token)}:{})}
  if(!await session(request,env))return error('შედით მაღაზიის პაროლით.',401);
  if(path==='/api/logout'&&method==='POST'){const token=request.headers.get('Cookie')?.match(/orders_session=([a-f0-9]{64})/)?.[1];if(token)await env.DB.prepare('DELETE FROM sessions WHERE token_hash = ?').bind(await hash(token)).run();return json({ok:true},200,{'Set-Cookie':cookie(request,'',0)})}
  if(path==='/api/orders'&&method==='GET'){const {results}=await env.DB.prepare('SELECT * FROM orders ORDER BY created_at DESC').all();return json({orders:results.map(toOrder)})}
  if(path==='/api/orders'&&method==='POST'){
    const input=await body(request);if(!isUUID(input.id))return error('შეკვეთის ნომერი არასწორია.');const o=validateOrder(input),now=Date.now(),existing=await rowFor(env,input.id);if(existing)return json({order:toOrder(existing)});
    await env.DB.prepare('INSERT INTO orders (id, customer, product, price_cents, region, address, phone, ship_date, delivery_time, notes, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(id) DO NOTHING').bind(input.id,o.customer,o.product,o.priceCents,o.region,o.address,o.phone,o.shipDate,o.deliveryTime,o.notes,now,now).run();return json({order:toOrder(await rowFor(env,input.id))},201);
  }
  const match=path.match(/^\/api\/orders\/([a-f\d-]+)(\/status)?$/i);
  if(match){const id=match[1];if(!isUUID(id))return error('შეკვეთა ვერ მოიძებნა.',404);const input=await body(request);if(!validVersion(input.version))return error('განაახლე შეკვეთა და სცადე ხელახლა.');let result;
    if(method==='PUT'&&!match[2]){const o=validateOrder(input);result=await env.DB.prepare('UPDATE orders SET customer = ?, product = ?, price_cents = ?, region = ?, address = ?, phone = ?, ship_date = ?, delivery_time = ?, notes = ?, updated_at = ?, version = version + 1 WHERE id = ? AND version = ?').bind(o.customer,o.product,o.priceCents,o.region,o.address,o.phone,o.shipDate,o.deliveryTime,o.notes,Date.now(),id,input.version).run()}
    else if(method==='PATCH'&&match[2]){if(!['pending','sent'].includes(input.status))return error('სტატუსი არასწორია.');result=await env.DB.prepare('UPDATE orders SET status = ?, sent_at = ?, updated_at = ?, version = version + 1 WHERE id = ? AND version = ?').bind(input.status,input.status==='sent'?Date.now():null,Date.now(),id,input.version).run()}
    else if(method==='DELETE'&&!match[2])result=await env.DB.prepare('DELETE FROM orders WHERE id = ? AND version = ?').bind(id,input.version).run();else return error('მოქმედება არ არის მხარდაჭერილი.',405);
    if(!result.meta.changes){if(!await rowFor(env,id))return error('შეკვეთა უკვე წაშლილია.',404);return error('შეკვეთა სხვა მოწყობილობაზე შეიცვალა. გადახედე ახალ ინფორმაციას და სცადე ხელახლა.',409)}return method==='DELETE'?json({ok:true}):json({order:toOrder(await rowFor(env,id))});
  }
  if(path==='/api/subscriptions'&&method==='POST'){if(!env.VAPID_PUBLIC_KEY||!env.VAPID_PRIVATE_KEY||!env.VAPID_SUBJECT)return error('შეხსენება ჯერ არ არის გამართული.',503);const sub=validateSubscription(await body(request)),existing=await env.DB.prepare('SELECT endpoint FROM push_subscriptions WHERE endpoint = ?').bind(sub.endpoint).first();if(!existing){const total=await env.DB.prepare('SELECT COUNT(*) AS total FROM push_subscriptions').first();if(total.total>=30)return error('შეხსენება უკვე ბევრ მოწყობილობაზეა ჩართული. გამორთე ძველ მოწყობილობაზე.',409)}await env.DB.prepare('INSERT INTO push_subscriptions (endpoint, subscription, created_at) VALUES (?, ?, ?) ON CONFLICT(endpoint) DO UPDATE SET subscription = excluded.subscription').bind(sub.endpoint,JSON.stringify(sub),Date.now()).run();return json({ok:true})}
  if(path==='/api/subscriptions'&&method==='DELETE'){const input=await body(request);if(typeof input.endpoint!=='string')return error('შეტყობინების მისამართი არასწორია.');await env.DB.prepare('DELETE FROM push_subscriptions WHERE endpoint = ?').bind(input.endpoint).run();return json({ok:true})}
  if(path==='/api/push/test'&&method==='POST'){const input=await body(request);if(typeof input.endpoint!=='string')return error('შეტყობინების მისამართი არასწორია.');const row=await env.DB.prepare('SELECT subscription FROM push_subscriptions WHERE endpoint = ?').bind(input.endpoint).first();if(!row)return error('ჯერ ჩართე შეხსენება.',404);const status=await sendPush(env,JSON.parse(row.subscription),{title:'შეხსენება მუშაობს',body:'დღევანდელი გასაგზავნი შეკვეთების შეხსენება მოვა 12:00-ზე.',tag:'orders-test'});if(status>=200&&status<300)return json({ok:true});if(status===404||status===410)await env.DB.prepare('DELETE FROM push_subscriptions WHERE endpoint = ?').bind(input.endpoint).run();return error('შეტყობინება ვერ გაიგზავნა. გამორთე შეხსენება და ხელახლა ჩართე.',502)}
  return error('მოთხოვნა ვერ მოიძებნა.',404);
}
export default {
  async fetch(request,env){const url=new URL(request.url);if(!url.pathname.startsWith('/api/'))return env.ASSETS.fetch(request);try{return await handleApi(request,env)}catch(err){if(err instanceof Error&&/შეავსე|ფასი|თარიღი|ტელეფონის|ინფორმაცია|შეტყობინების|სერვისი|გასაღები/.test(err.message))return error(err.message);console.error('Order API failed',err?.name);return error('მოქმედება ვერ შესრულდა. სცადე ხელახლა; შევსებული ინფორმაცია შენარჩუნებულია.',503)}},
  async scheduled(controller,env,ctx){ctx.waitUntil(sendDailyReminders(env,controller.scheduledTime))}
};
