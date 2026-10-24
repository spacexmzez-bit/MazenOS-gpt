export class HttpError extends Error {
  constructor(status, message, code = '') { super(message); this.status = status; this.code = code; }
}
export const fail = (status, message, code) => { throw new HttpError(status, message, code); };
export const uid = () => crypto.randomUUID();
export const iso = (now = Date.now()) => new Date(now).toISOString();
export const dateAST = (now = Date.now()) => iso(now + 10800000).slice(0, 10);
export const weekdayAST = (now = Date.now()) => new Date(now + 10800000).getUTCDay();
export const logicalDate = (now = Date.now()) => iso(now).slice(0, 10); // 03:00 AST boundary = 00:00 UTC
export const one = (env, sql, ...v) => env.DB.prepare(sql).bind(...v).first();
export const all = async (env, sql, ...v) => (await env.DB.prepare(sql).bind(...v).all()).results;
export const run = (env, sql, ...v) => env.DB.prepare(sql).bind(...v).run();
export const stmt = (env, sql, ...v) => env.DB.prepare(sql).bind(...v);
export async function setting(env, key, fallback = null) {
  const row = await one(env, 'SELECT value FROM system_settings WHERE key=?', key);
  return row ? JSON.parse(row.value) : fallback;
}
export const setSetting = (env, key, value) => run(env, 'INSERT INTO system_settings(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value,updated_at=CURRENT_TIMESTAMP', key, JSON.stringify(value));
export function text(value, name, max = 1000, required = false) {
  if (typeof value !== 'string' || value.length > max || (required && !value.trim())) fail(400, `Enter a valid ${name}.`);
  return value.trim();
}
export function number(value, name, min, max, integer = false) {
  if (value === '' || value == null || typeof value === 'boolean') fail(400, `Enter a valid ${name}.`);
  const n = Number(value);
  if (!Number.isFinite(n) || n < min || n > max || (integer && !Number.isInteger(n))) fail(400, `Enter a valid ${name}.`);
  return n;
}
export const bool = value => value === true || value === 1;
export function timestamp(value, required = false) {
  if (!value && !required) return null;
  if (typeof value !== 'string' || !/(?:Z|[+-]\d{2}:\d{2})$/.test(value) || !Number.isFinite(Date.parse(value))) fail(400, 'Enter a date with a time zone.');
  return new Date(value).toISOString();
}
export function validDate(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value) || !Number.isFinite(Date.parse(value)) || iso(Date.parse(value)).slice(0,10) !== value) fail(400, 'Enter a valid date.');
  return value;
}
export async function bodyJSON(request, limit = 50000) {
  if (!request.headers.get('Content-Type')?.startsWith('application/json')) fail(415, 'Use JSON for this request.');
  const reader = request.body?.getReader(); if (!reader) fail(400, 'A request body is required.');
  const parts = []; let size = 0;
  while (true) { const {done,value} = await reader.read(); if (done) break; size += value.length; if (size > limit) { await reader.cancel(); fail(413, 'This request is too large.'); } parts.push(value); }
  const bytes = new Uint8Array(size); let offset=0; for (const part of parts) { bytes.set(part,offset); offset+=part.length; }
  try { const data = JSON.parse(new TextDecoder().decode(bytes)); if (!data || typeof data !== 'object' || Array.isArray(data)) throw Error(); return data; } catch { fail(400, 'Enter valid JSON.'); }
}
export async function hash(value) { return [...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value)))].map(x=>x.toString(16).padStart(2,'0')).join(''); }
export function randomToken() { return [...crypto.getRandomValues(new Uint8Array(32))].map(x=>x.toString(16).padStart(2,'0')).join(''); }
export const b64 = bytes => { let s=''; for (const b of bytes) s+=String.fromCharCode(b); return btoa(s); };
export const unb64 = str => Uint8Array.from(atob(str), c=>c.charCodeAt(0));
export async function seal(env, value) {
  if (!/^[a-f\d]{64}$/i.test(env.VAULT_KEY || '')) fail(503, 'The server key vault needs setup.');
  const key = await crypto.subtle.importKey('raw', Uint8Array.from(env.VAULT_KEY.match(/../g), x=>parseInt(x,16)), 'AES-GCM', false, ['encrypt','decrypt']);
  const iv=crypto.getRandomValues(new Uint8Array(12));
  const data=await crypto.subtle.encrypt({name:'AES-GCM',iv}, key, new TextEncoder().encode(value));
  return {iv:b64(iv), data:b64(new Uint8Array(data))};
}
export async function unseal(env, record) {
  if (!record) return null;
  if (!/^[a-f\d]{64}$/i.test(env.VAULT_KEY || '')) fail(503, 'The server key vault needs setup.');
  try {
    const key=await crypto.subtle.importKey('raw',Uint8Array.from(env.VAULT_KEY.match(/../g),x=>parseInt(x,16)),'AES-GCM',false,['decrypt']);
    return new TextDecoder().decode(await crypto.subtle.decrypt({name:'AES-GCM',iv:unb64(record.iv)},key,unb64(record.data)));
  } catch { fail(503,'The saved key cannot be opened. Check the server vault key.'); }
}
export async function rate(env, key, limit, seconds = 60) {
  const now=Date.now(), bucket=Math.floor(now/(seconds*1000));
  const result=await one(env, 'INSERT INTO rate_limits(key,count,expires_at) VALUES(?,1,?) ON CONFLICT(key) DO UPDATE SET count=count+1 RETURNING count', key+':'+bucket, now+seconds*2000);
  if (result.count>limit) fail(429,'Too many requests. Please wait before trying again.');
}
export async function passwordRecord(password, salt = randomToken()) {
  text(password,'password',256,true); if(password.length<12) fail(400,'Use at least 12 characters for your password.');
  const material=await crypto.subtle.importKey('raw',new TextEncoder().encode(password),'PBKDF2',false,['deriveBits']);
  const bits=await crypto.subtle.deriveBits({name:'PBKDF2',hash:'SHA-256',salt:new TextEncoder().encode(salt),iterations:100000},material,256);
  return {salt, hash:b64(new Uint8Array(bits))};
}
export async function verifyPassword(env, password) {
  const record=await setting(env,'auth_password');
  if (!record || typeof password!=='string' || password.length<12 || password.length>256) return false;
  return (await passwordRecord(password,record.salt)).hash === record.hash;
}
export async function session(env) {
  const token=randomToken(); await run(env,'INSERT INTO auth_sessions(token_hash,expires_at) VALUES(?,?)',await hash(token),Date.now()+7*86400000); return token;
}
export async function authenticate(request,env) {
  const token=request.headers.get('Authorization')?.match(/^Bearer ([a-f\d]{64})$/i)?.[1];
  if (!token) fail(401,'Sign in to continue.');
  const tokenHash=await hash(token);
  if (await one(env,'SELECT token_hash FROM auth_sessions WHERE token_hash=? AND expires_at>?',tokenHash,Date.now())) return {kind:'owner',hash:tokenHash};
  if (tokenHash===await setting(env,'phone_token_hash')) return {kind:'phone',hash:tokenHash};
  fail(401,'Your sign-in has expired. Please sign in again.');
}
export async function assertOwnerSession(env, identity) {
  if (identity.kind !== 'owner' || !await one(env,'SELECT token_hash FROM auth_sessions WHERE token_hash=? AND expires_at>?',identity.hash,Date.now())) fail(401,'Sign in again.');
}
export async function authRoute(request,env,path,data,identity) {
  if(path==='/api/auth/setup') {
    await rate(env,'setup:'+request.headers.get('CF-Connecting-IP'),5,600);
    if(await setting(env,'auth_password')) fail(409,'Setup has already been completed.');
    if(!env.SETUP_TOKEN || typeof data.setup_token!=='string' || await hash(data.setup_token)!==await hash(env.SETUP_TOKEN)) fail(403,'The setup code is incorrect.');
    const record=await passwordRecord(data.password);
    const result=await run(env,'INSERT OR IGNORE INTO system_settings(key,value) VALUES(?,?)','auth_password',JSON.stringify(record));
    if(!result.meta.changes) fail(409,'Setup has already been completed.');
    return {token:await session(env)};
  }
  if(path==='/api/auth/login') {
    await rate(env,'login:'+request.headers.get('CF-Connecting-IP'),8,600);
    if(!await verifyPassword(env,data.password)) fail(401,'The password is incorrect, or setup is incomplete.');
    return {token:await session(env)};
  }
  if(path==='/api/auth/logout') { await run(env,'DELETE FROM auth_sessions WHERE token_hash=?',identity.hash); return {ok:true}; }
  if(path==='/api/auth/password') {
    if(!await verifyPassword(env,data.current_password)) fail(403,'Enter your current password.');
    const record=await passwordRecord(data.password);
    await env.DB.batch([stmt(env,'UPDATE system_settings SET value=?,updated_at=CURRENT_TIMESTAMP WHERE key=?',JSON.stringify(record),'auth_password'),stmt(env,'DELETE FROM auth_sessions')]);
    return {token:await session(env)};
  }
  return null;
}
export async function healthToday(env,now=Date.now()) {
  const record=await one(env,'SELECT * FROM daily_health_logs WHERE date=?',logicalDate(now));
  if(record) return record;
  const previous=await one(env,'SELECT medicine_target_count FROM daily_health_logs WHERE date<? ORDER BY date DESC LIMIT 1',logicalDate(now));
  return {date:logicalDate(now),sleep_hours:null,energy_score:null,is_sick:+!!await setting(env,'sickness_started_at'),medicine_target_count:previous?.medicine_target_count||0,medicine_taken_count:0};
}
export async function inRest(env, now=Date.now()) {
  const config=await setting(env,'preferences',{}), minutes=new Date(now+10800000).getUTCHours()*60+new Date(now+10800000).getUTCMinutes();
  return (config.rest_windows||[]).some(w=> {const toMin=s=>Number(s.slice(0,2))*60+Number(s.slice(3));const a=toMin(w.start),b=toMin(w.end); return a<b?minutes>=a&&minutes<b:minutes>=a||minutes<b;});
}

export async function ensureHealthDay(env) {
  const h=await healthToday(env);
  await run(env,'INSERT OR IGNORE INTO daily_health_logs(date,is_sick,medicine_target_count) VALUES(?,?,?)',h.date,h.is_sick,h.medicine_target_count);
}
