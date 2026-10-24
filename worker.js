import {HttpError,fail,bodyJSON,one,all,run,setting,setSetting,stmt,hash,seal,randomToken,verifyPassword,authenticate,authRoute,text,number,bool,rate,iso,healthToday,dateAST,logicalDate,ensureHealthDay} from './worker-lib.js';
import {taskRoute,focusRoute,status,dailyCron,focusState,rebalance} from './worker-tasks.js';
import {toolsRoute,walletBalances} from './worker-tools.js';
import {aiRoute,MODELS} from './worker-ai.js';
function response(data,statusCode=200,origin='') {
  return new Response(JSON.stringify(data),{status:statusCode,headers:{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff',...(origin?{'Access-Control-Allow-Origin':origin,'Vary':'Origin'}:{})}});
}
function allowOrigin(request,env) {
  const origin=request.headers.get('Origin'), allowed=(env.ALLOWED_ORIGINS||'').split(',').map(s=>s.trim()).filter(Boolean);
  if(!origin) return '';
  if(!allowed.includes(origin) && origin!==new URL(request.url).origin) fail(403,'This website is not allowed to connect to MazenOS.');
  return origin;
}
function method(request,allowed) { if(!allowed.includes(request.method)) fail(405,'This request method is not supported.'); }
async function settingsRoute(request,env,path,data,identity) {
  if(path==='/api/settings' && request.method==='GET') return {preferences:await setting(env,'preferences',{}),has_gemini_key:!!await setting(env,'key_gemini'),has_claude_key:!!await setting(env,'key_claude'),phone_connected:!!await setting(env,'phone_token_hash'),models:MODELS};
  if(path==='/api/settings' && request.method==='PUT') {
    const old=await setting(env,'preferences',{}), p=data.preferences;
    if(!p || typeof p!=='object'||Array.isArray(p)) fail(400,'Enter your settings.');
    const next={...old};
    if(Object.hasOwn(p,'ai_provider')) {if(!['gemini','claude'].includes(p.ai_provider)) fail(400,'Choose Gemini or Claude.');next.ai_provider=p.ai_provider;}
    if(Object.hasOwn(p,'model_tier')) {if(!['light','smart'].includes(p.model_tier)) fail(400,'Choose Light or Smart.');next.model_tier=p.model_tier;}
    for(const [key,min,max] of [['main_focus_percent',65,75],['daily_focus_minutes',30,480],['focus_minutes',1,360]]) if(Object.hasOwn(p,key)) next[key]=number(p[key],key.replaceAll('_',' '),min,max,true);
    if(Object.hasOwn(p,'location_filter')) next.location_filter=text(p.location_filter,'location filter',100);
    if(Object.hasOwn(p,'rest_windows')) {
      if(!Array.isArray(p.rest_windows)||p.rest_windows.length>8||p.rest_windows.some(w=>!/^([01]\d|2[0-3]):[0-5]\d$/.test(w.start)||!/^([01]\d|2[0-3]):[0-5]\d$/.test(w.end)||w.start===w.end)) fail(400,'Enter up to eight valid rest windows, with different start and end times.');
      next.rest_windows=p.rest_windows.map(w=>({start:w.start,end:w.end}));
    }
    await setSetting(env,'preferences',next);return {ok:true};
  }
  if(path==='/api/settings/keys' && request.method==='PUT') {
    await rate(env,'key-change',6,600);
    if(!await verifyPassword(env,data.password)) fail(403,'Enter your password to change saved keys.');
    const commands=[];
    for(const provider of ['gemini','claude']) if(Object.hasOwn(data,provider)) {
      const value=text(data[provider],'API key',500);
      if(value) commands.push(stmt(env,'INSERT INTO system_settings(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value,updated_at=CURRENT_TIMESTAMP','key_'+provider,JSON.stringify(await seal(env,value))));
      else commands.push(stmt(env,'DELETE FROM system_settings WHERE key=?','key_'+provider));
    }
    if(!commands.length) fail(400,'Enter a key to save.');await env.DB.batch(commands);return {ok:true};
  }
  if(path==='/api/settings/phone' && request.method==='POST') {
    await rate(env,'phone-change',6,600);
    if(!await verifyPassword(env,data.password)) fail(403,'Enter your password to change phone access.');
    const token=randomToken();await setSetting(env,'phone_token_hash',await hash(token));return {token};
  }
  if(path==='/api/settings/phone' && request.method==='DELETE') {
    if(!await verifyPassword(env,data.password)) fail(403,'Enter your password to remove phone access.');await run(env,'DELETE FROM system_settings WHERE key=?','phone_token_hash');await env.TEMP.delete('media_lock');return {ok:true};
  }
  return null;
}
const EXPORT_TABLES=['tasks','subtasks','audit_receipts','daily_health_logs','study_locations','location_items','idea_vault','curriculum_units','budget_entries','diary_entries','focus_sessions','chat_messages','leisure_windows'];
export default {
  async fetch(request,env) {
    let origin='';
    try {
      origin=allowOrigin(request,env);
      if(request.method==='OPTIONS') return new Response(null,{status:204,headers:{'Access-Control-Allow-Origin':origin,'Access-Control-Allow-Methods':'GET,POST,PUT,DELETE,OPTIONS','Access-Control-Allow-Headers':'Authorization,Content-Type','Access-Control-Max-Age':'600','Vary':'Origin'}});
      const path=new URL(request.url).pathname.replace(/\/$/,'')||'/', methodName=request.method;
      if(path==='/api/ready') {method(request,['GET']);return response({ready:!!await setting(env,'auth_password')},200,origin);}
      if(path==='/api/auth/setup'||path==='/api/auth/login') {method(request,['POST']);const data=await bodyJSON(request);return response(await authRoute(request,env,path,data),200,origin);}
      const identity=await authenticate(request,env);
      const phoneAllowed=['GET /status','POST /api/budget/sms','POST /api/audit/media','POST /api/health/sync'];
      if(identity.kind==='phone' && !phoneAllowed.includes(methodName+' '+path)) fail(403,'Phone access is limited to device integrations.');
      await rate(env,identity.kind==='phone'?'phone':'owner',identity.kind==='phone'?90:240,60);
      if(path==='/status') {method(request,['GET']);await rebalance(env);return response(await status(env),200,origin);}
      const data=['POST','PUT','DELETE'].includes(methodName)?await bodyJSON(request,path==='/api/audit/proof'?7100000:250000):{};
      if(path==='/api/health/sync') {
        method(request,['POST']);const energy=number(data.energy_score,'energy score',0,100,true);
        await ensureHealthDay(env);
        await run(env,'INSERT INTO daily_health_logs(date,energy_score) VALUES(?,?) ON CONFLICT(date) DO UPDATE SET energy_score=excluded.energy_score,updated_at=CURRENT_TIMESTAMP',logicalDate(),energy);return response({ok:true},200,origin);
      }
      if(path.startsWith('/api/auth/')) {method(request,['POST']);const result=await authRoute(request,env,path,data,identity);if(result) return response(result,200,origin);}
      const allowedWrite=new Set(['/api/focus/stop','/api/focus/reminder','/api/health/sick','/api/health/medicine','/api/ideas/synthesize','/api/ideas/synthesized']);
      if(allowedWrite.has(path)) method(request,['POST']);
      if(path==='/api/summary') {
        method(request,['GET']);await rebalance(env);
        return response({date:dateAST(),health:await healthToday(env),device:await status(env),focus:await focusState(env),tasks:await all(env,"SELECT * FROM tasks WHERE status IN ('pending','in_progress') ORDER BY priority,due_timestamp IS NULL,due_timestamp LIMIT 5"),balances:await walletBalances(env)},200,origin);
      }
      if(path==='/api/export') {
        method(request,['GET']); const exported={format:'mazenos-v1',exported_at:iso(),preferences:await setting(env,'preferences',{}),tables:{}};
        for(const table of EXPORT_TABLES) exported.tables[table]=await all(env,'SELECT * FROM '+table);
        return response(exported,200,origin);
      }
      if(path==='/api/settings/rebalance') {method(request,['POST']);return response({changes:await rebalance(env)},200,origin);}
      for(const handler of [()=>settingsRoute(request,env,path,data,identity),()=>taskRoute(env,path,methodName,data),()=>focusRoute(env,path,methodName,data),()=>toolsRoute(env,path,methodName,data),()=>aiRoute(env,path,methodName,data,identity)]) {
        const result=await handler();if(result!==null) return response(result,200,origin);
      }
      fail(404,'Page or action not found.');
    } catch(error) {
      if(!(error instanceof HttpError)) console.error('MazenOS request failed:',error?.name||'Error');
      return response({error:error instanceof HttpError?error.message:'The server could not complete this request.',code:error.code||''},error.status||500,origin);
    }
  },
  async scheduled(event,env,ctx) {ctx.waitUntil(dailyCron(env,event.scheduledTime));}
};
