import {all,one,run,stmt,setting,setSetting,uid,iso,logicalDate,dateAST,weekdayAST,healthToday,inRest,fail,text,number,timestamp,bool,validDate,randomToken,hash,ensureHealthDay} from './worker-lib.js';
import {setSickness,activeFocus,promoteObjectives} from './worker-tasks.js';
export function parseBankSMS(sms,receivedAt=iso()) {
  text(sms,'bank message',5000,true);
  const normalize=s=>s.replace(/[٠-٩]/g,c=>String('٠١٢٣٤٥٦٧٨٩'.indexOf(c))).replace(/[٬,]/g,'').replace(/٫/g,'.');
  const s=normalize(sms);
  if(/OTP|verification code|رمز التحقق|كلمة المرور/i.test(s)) fail(422,'This is a verification message, not a transaction.');
  const amount=s.match(/(?:SAR|ر\.?س\.?|ريال)\s*([\d]+(?:\.\d{1,2})?)/i) || s.match(/(?:amount|مبلغ|بقيمة)\s*[:：]?\s*([\d]+(?:\.\d{1,2})?)/i);
  const card=s.match(/(?:card|بطاقة|حساب|\*{2,})\s*[:：#*Xx -]*([\d]{4})(?!\d)/i);
  const balance=s.match(/(?:available\s+balance|balance|الرصيد(?:\s+المتاح)?|رصيد)\s*[:：]?\s*(?:SAR|ر\.?س\.?|ريال)?\s*([\d]+(?:\.\d{1,2})?)/i);
  const credit=/credited|deposit|received|إيداع|ايداع|حوالة واردة|تحويل وارد|استرداد|refund/i.test(s);
  const debit=/purchase|payment|paid|debit|withdraw|شراء|مدفوع|سحب|حوالة صادرة|تحويل صادر/i.test(s);
  if(!amount || (!credit&&!debit) || (credit&&debit) || !card) fail(422,'Bank message format was not recognized. Add the transaction manually.');
  const merchant=s.match(/(?:merchant|at|لدى|من|إلى)\s*[:：]?\s*([^\n;]+?)(?=\s+(?:balance|الرصيد|رصيد|on|بتاريخ|date)\b|[\n;]|$)/i)?.[1]?.trim() || 'Bank transaction';
  const time=s.match(/\b(20\d{2}-\d{2}-\d{2})[ T](\d{2}:\d{2}(?::\d{2})?)(Z|[+-]\d{2}:\d{2})?/);
  return {wallet_source:'Card '+card[1],amount_sar:number(amount[1],'amount',0.01,10000000)*(credit?1:-1),balance_after_sar:balance?number(balance[1],'balance',0,100000000):null,merchant:merchant.slice(0,200),transaction_timestamp:time?timestamp(time[1]+'T'+time[2]+(time[3]||'+03:00'),true):timestamp(receivedAt,true)};
}
export async function walletBalances(env) {
  const wallets=await all(env,'SELECT DISTINCT wallet_source FROM budget_entries'); const results=[];
  for(const {wallet_source} of wallets) {
    const anchor=await one(env,'SELECT * FROM budget_entries WHERE wallet_source=? AND balance_after_sar IS NOT NULL ORDER BY transaction_timestamp DESC,created_at DESC,rowid DESC LIMIT 1',wallet_source);
    const entries=await one(env,anchor?'SELECT COALESCE(SUM(amount_sar),0) AS total FROM budget_entries WHERE wallet_source=? AND (transaction_timestamp > ? OR (transaction_timestamp=? AND rowid > (SELECT rowid FROM budget_entries WHERE id=?)))':'SELECT COALESCE(SUM(amount_sar),0) AS total FROM budget_entries WHERE wallet_source=?',...anchor?[wallet_source,anchor.transaction_timestamp,anchor.transaction_timestamp,anchor.id]:[wallet_source]);
    results.push({wallet_source,balance_sar:Math.round(((anchor?.balance_after_sar||0)+entries.total)*100)/100});
  }
  return results;
}
async function healthRoute(env,path,method,data) {
  if(path==='/api/health' && method==='GET') return {today:await healthToday(env),history:await all(env,'SELECT * FROM daily_health_logs ORDER BY date DESC LIMIT 30')};
  if(path==='/api/health' && method==='PUT') {
    const old=await healthToday(env), row={...old};
    for(const key of ['sleep_hours','energy_score','medicine_target_count','medicine_taken_count','workout_type','workout_completed']) if(Object.hasOwn(data,key)) row[key]=data[key];
    const sleep=row.sleep_hours==null||row.sleep_hours===''?null:number(row.sleep_hours,'sleep hours',0,24);
    const energy=row.energy_score==null||row.energy_score===''?null:number(row.energy_score,'energy',0,100,true);
    const target=number(row.medicine_target_count??0,'daily dose target',0,100,true), taken=number(row.medicine_taken_count??0,'doses taken',0,100,true);
    await ensureHealthDay(env);
    await run(env,'INSERT INTO daily_health_logs(date,sleep_hours,energy_score,medicine_target_count,medicine_taken_count,workout_type,workout_completed) VALUES(?,?,?,?,?,?,?) ON CONFLICT(date) DO UPDATE SET sleep_hours=excluded.sleep_hours,energy_score=excluded.energy_score,medicine_target_count=excluded.medicine_target_count,medicine_taken_count=excluded.medicine_taken_count,workout_type=excluded.workout_type,workout_completed=excluded.workout_completed,updated_at=CURRENT_TIMESTAMP',logicalDate(),sleep,energy,target,taken,text(row.workout_type||'','workout type',100),+bool(row.workout_completed));
    return {ok:true};
  }
  if(path==='/api/health/medicine' && method==='POST') {
    const delta=number(data.delta,'dose change',-1,1,true); if(!delta) fail(400,'Choose add or undo.');
    await ensureHealthDay(env);
    await run(env,'UPDATE daily_health_logs SET medicine_taken_count=MIN(100,MAX(0,medicine_taken_count+?)),updated_at=CURRENT_TIMESTAMP WHERE date=?',delta,logicalDate());
    return {today:await healthToday(env)};
  }
  if(path==='/api/health/sick' && method==='POST') return setSickness(env,bool(data.is_sick),data.notes||'');
  return null;
}
async function locationRoute(env,path,method,data) {
  if(path==='/api/locations' && method==='GET') return {locations:await all(env,'SELECT * FROM study_locations ORDER BY name'),items:await all(env,'SELECT * FROM location_items ORDER BY item_name')};
  if(path==='/api/locations' && method==='POST') {
    const url=text(data.google_maps_url||'','map link',2000); if(url) {try{if(new URL(url).protocol!=='https:') throw Error();}catch{fail(400,'Use an HTTPS map link.');}}
    const id=uid(); await run(env,'INSERT INTO study_locations(id,name,google_maps_url,service_type,quietness_rating,commute_minutes_one_way,average_cost_sar,notes) VALUES(?,?,?,?,?,?,?,?)',id,text(data.name,'name',200,true),url,text(data.service_type||'','category',100),number(data.quietness_rating,'quietness',1,5,true),number(data.commute_minutes_one_way,'commute',0,720,true),data.average_cost_sar==null||data.average_cost_sar===''?null:number(data.average_cost_sar,'average cost',0,100000),text(data.notes||'','notes',3000)); return {id};
  }
  const match=path.match(/^\/api\/locations\/([\w-]+)(?:\/(items|commute))?$/); if(!match) return null;
  const [,id,action]=match, location=await one(env,'SELECT * FROM study_locations WHERE id=?',id); if(!location) fail(404,'Location not found.');
  if(method==='DELETE' && !action) { await run(env,'DELETE FROM study_locations WHERE id=?',id); return {ok:true}; }
  if(method==='POST' && action==='items') {await run(env,'INSERT INTO location_items(id,location_id,item_name,price_sar) VALUES(?,?,?,?)',uid(),id,text(data.item_name,'item',200,true),number(data.price_sar,'price',0,100000)); return {ok:true};}
  if(method==='POST' && action==='commute') {
    const minutes=number(data.focus_minutes,'focus time',1,1440,true), travel=location.commute_minutes_one_way*2;
    return {round_trip_minutes:travel,remaining_focus_minutes:Math.max(0,minutes-travel),recommended:travel<=minutes*0.25,message:travel>minutes*0.25?'Travel uses more than a quarter of this focus block. Choose somewhere closer or stay where you are.':'This commute fits within your focus block.'};
  }
  return null;
}
export async function sealExpiredIdeas(env,now=Date.now()) {
  const rows=await all(env,'SELECT * FROM idea_captures WHERE expires_at <= ? AND submitted=0',now);
  if(!rows.length) return;
  const commands=[];
  for(const row of rows) {
    if(row.content.trim()) commands.push(stmt(env,'INSERT OR IGNORE INTO idea_vault(id,content,domain_tag,created_at) VALUES(?,?,?,?)',row.token_hash,row.content,row.domain_tag,iso(row.created_at)));
    commands.push(stmt(env,'UPDATE idea_captures SET submitted=1,content=? WHERE token_hash=?','',row.token_hash));
  }
  await env.DB.batch(commands);
}
async function ideaRoute(env,path,method,data) {
  if(!path.startsWith('/api/ideas')) return null;
  await sealExpiredIdeas(env);
  if(path==='/api/ideas' && method==='GET') {
    const focus=await activeFocus(env); if(focus && focus.session_type!=='break') fail(423,'The vault is closed during focus. You can still capture a new idea.');
    return {ideas:await all(env,'SELECT * FROM idea_vault ORDER BY created_at DESC LIMIT 500')};
  }
  if(path==='/api/ideas/capture' && method==='POST') {
    const open=await one(env,'SELECT expires_at FROM idea_captures WHERE submitted=0 AND expires_at>? LIMIT 1',Date.now());
    if(open) fail(409,'A capture is already open. Finish it or wait for it to close.');
    const token=randomToken(), now=Date.now(); await run(env,'INSERT INTO idea_captures(token_hash,expires_at,created_at) VALUES(?,?,?)',await hash(token),now+180000,now); return {token,expires_at:now+180000};
  }
  if(['/api/ideas/draft','/api/ideas/seal'].includes(path) && method==='POST') {
    const key=await hash(text(data.token,'capture',100,true)), row=await one(env,'SELECT * FROM idea_captures WHERE token_hash=?',key);
    if(!row) fail(404,'Capture not found.'); if(row.submitted) return {sealed:true};
    const content=text(data.content||'','idea',10000), tag=text(data.domain_tag||'general','tag',50);
    const result=await run(env,'UPDATE idea_captures SET content=?,domain_tag=? WHERE token_hash=? AND submitted=0 AND expires_at>?',content,tag,key,Date.now());
    if(!result.meta.changes) {await sealExpiredIdeas(env); return {sealed:true};}
    if(path.endsWith('/seal')) {
      await env.DB.batch([stmt(env,"INSERT OR IGNORE INTO idea_vault(id,content,domain_tag,created_at) SELECT token_hash,content,domain_tag,? FROM idea_captures WHERE token_hash=? AND submitted=0 AND length(trim(content))>0",iso(row.created_at),key),stmt(env,"UPDATE idea_captures SET submitted=1,content='' WHERE token_hash=?",key)]);
      return {sealed:true};
    }
    return {saved:true};
  }
  const match=path.match(/^\/api\/ideas\/([\w-]+)$/);
  if(match && method==='PUT') {
    const focus=await activeFocus(env);if(focus && focus.session_type!=='break') fail(423,'The vault is closed during focus.');
    const result=await run(env,'UPDATE idea_vault SET content=?,domain_tag=?,is_synthesized=0 WHERE id=?',text(data.content,'idea',10000,true),text(data.domain_tag||'general','tag',50),match[1]);if(!result.meta.changes) fail(404,'Idea not found.');return {ok:true};
  }
  if(match && method==='DELETE') {const focus=await activeFocus(env);if(focus && focus.session_type!=='break') fail(423,'The vault is closed during focus.'); await run(env,'DELETE FROM idea_vault WHERE id=?',match[1]); return {ok:true};}
  return null;
}
async function curriculumRoute(env,path,method,data) {
  if(path==='/api/curry' && method==='GET') {
    await promoteObjectives(env);
    const units=await all(env,'SELECT * FROM curriculum_units ORDER BY is_main_objective DESC,exam_name,unit_number');
    const pendingDrills=await all(env,"SELECT curriculum_unit_id FROM tasks WHERE is_retrieval_drill=1 AND status IN ('pending','in_progress')");
    const due=units.filter(u=>!pendingDrills.some(t=>t.curriculum_unit_id===u.id) && u.status!=='not_started' && (!u.last_reviewed_date||Date.parse(dateAST())-Date.parse(u.last_reviewed_date)>=3*86400000));
    const prefs=await setting(env,'preferences',{}), ratio=prefs.main_focus_percent||70;
    const minutes=prefs.daily_focus_minutes||180;
    return {units,drill_suggestions:due.slice(0,3),allocation:{main_minutes:Math.round(minutes*ratio/100),sub_minutes:minutes-Math.round(minutes*ratio/100)}};
  }
  if(path==='/api/curry/import' && method==='POST') {
    if(!Array.isArray(data.units)||!data.units.length||data.units.length>200) fail(400,'Paste between 1 and 200 units.');
    const commands=[];
    for(const row of data.units) {
      const target=row.target_completion_date?validDate(row.target_completion_date):null, exam=row.exam_date?validDate(row.exam_date):null;
      const subject=text(row.subject_slug||'','subject link',80); if(subject&&!/^[a-z0-9-]+$/.test(subject)) fail(400,'Use letters, digits and dashes for subject links.');
      commands.push(stmt(env,'INSERT INTO curriculum_units(id,exam_name,unit_number,topic_title,difficulty_level,estimated_hours,is_main_objective,target_completion_date,exam_date,subject_slug) VALUES(?,?,?,?,?,?,?,?,?,?)',uid(),text(row.exam_name,'exam name',150,true),number(row.unit_number,'unit number',1,10000,true),text(row.topic_title,'topic',300,true),number(row.difficulty_level??3,'difficulty',1,5,true),number(row.estimated_hours??2,'estimated hours',0.1,1000),+bool(row.is_main_objective),target,exam,subject||null));
    }
    await env.DB.batch(commands); await promoteObjectives(env); return {imported:commands.length};
  }
  if(path==='/api/curry/plan' && method==='POST') {
    const units=await all(env,"SELECT * FROM curriculum_units WHERE status!='completed' ORDER BY is_main_objective DESC,difficulty_level DESC,unit_number");
    if(!units.length) fail(409,'Add a syllabus first.');
    const prefs=await setting(env,'preferences',{}), minutes=prefs.daily_focus_minutes||180, ratio=(prefs.main_focus_percent||70)/100;
    const date=data.date?validDate(data.date):dateAST();
    if(new Date(date+'T12:00:00+03:00').getUTCDay()===5) fail(409,'Friday is reserved for your hobbies. Choose another day.');
    const ids=[];
    for(const main of [true,false]) {
      const unit=units.find(u=>!!u.is_main_objective===main); if(!unit) continue;
      if(await one(env,"SELECT id FROM tasks WHERE curriculum_unit_id=? AND due_timestamp>=? AND due_timestamp<? AND status!='archived'",unit.id,date+'T00:00:00+03:00',date+'T23:59:59+03:00')) continue;
      const id=uid(); ids.push(id); await run(env,'INSERT INTO tasks(id,title,priority,due_timestamp,estimated_duration_minutes,is_academic,curriculum_unit_id,description) VALUES(?,?,?,?,?,1,?,?)',id,unit.topic_title,main?1:2,timestamp(date+(main?'T18:00:00+03:00':'T20:00:00+03:00')),Math.round(minutes*(main?ratio:1-ratio)),unit.id,'Curriculum focus: '+unit.exam_name);
    }
    return {created:ids.length};
  }
  const match=path.match(/^\/api\/curry\/([\w-]+)(?:\/(drill))?$/); if(!match) return null;
  const [,id,action]=match, unit=await one(env,'SELECT * FROM curriculum_units WHERE id=?',id); if(!unit) fail(404,'Unit not found.');
  if(method==='PUT' && !action) {
    if(!['not_started','in_progress','completed'].includes(data.status)) fail(400,'Choose a unit status.');
    await run(env,'UPDATE curriculum_units SET status=?,completed_at=? WHERE id=?',data.status,data.status==='completed'?iso():null,id); await promoteObjectives(env); return {ok:true};
  }
  if(method==='POST' && action==='drill') {
    if(!bool(data.confirmed)) fail(400,'Confirm before adding a retrieval drill.');
    if(await one(env,"SELECT id FROM tasks WHERE curriculum_unit_id=? AND is_retrieval_drill=1 AND status IN ('pending','in_progress')",unit.id)) fail(409,'A retrieval drill for this unit is already queued.');
    const id=uid(); await run(env,'INSERT INTO tasks(id,title,description,priority,estimated_duration_minutes,is_academic,is_retrieval_drill,curriculum_unit_id) VALUES(?,?,?,?,15,1,1,?)',id,'Recall: '+unit.topic_title,'Retrieve the main ideas without notes, then check your answer.',unit.is_main_objective?1:2,unit.id);
    return {id};
  }
  return null;
}
async function diaryRoute(env,path,method,data) {
  if(path==='/api/diary' && method==='GET') return {entries:await all(env,'SELECT * FROM diary_entries ORDER BY created_at DESC LIMIT 200')};
  const match=path.match(/^\/api\/diary\/([\w-]+)$/);
  if(path==='/api/diary' && method==='POST' || match && method==='PUT') {
    const align=data.alignment||'left'; if(!['left','center','right'].includes(align)) fail(400,'Choose text alignment.');
    const values=[text(data.entry_text,'entry',30000,true),text(data.mood_tag||'','mood',40),align,number(data.font_size??18,'font size',12,32,true)];
    if(match) {const result=await run(env,'UPDATE diary_entries SET entry_text=?,mood_tag=?,alignment=?,font_size=? WHERE id=?',...values,match[1]); if(!result.meta.changes) fail(404,'Entry not found.'); return {ok:true};}
    const id=uid(); await run(env,'INSERT INTO diary_entries(entry_text,mood_tag,alignment,font_size,id,created_at) VALUES(?,?,?,?,?,?)',...values,id,iso()); return {id};
  }
  if(match && method==='DELETE') {await run(env,'DELETE FROM diary_entries WHERE id=?',match[1]); return {ok:true};} return null;
}
async function budgetRoute(env,path,method,data) {
  if(path==='/api/budget' && method==='GET') return {balances:await walletBalances(env),entries:await all(env,'SELECT * FROM budget_entries ORDER BY transaction_timestamp DESC,created_at DESC LIMIT 300')};
  if(path==='/api/budget/sms' && method==='POST') {
    const parsed=parseBankSMS(data.sms,data.received_at||iso()), key=await hash(data.message_id?text(data.message_id,'message ID',200,true):data.sms);
    const result=await run(env,'INSERT OR IGNORE INTO budget_entries(id,wallet_source,merchant,amount_sar,balance_after_sar,transaction_timestamp,sms_hash) VALUES(?,?,?,?,?,?,?)',uid(),parsed.wallet_source,parsed.merchant,parsed.amount_sar,parsed.balance_after_sar,parsed.transaction_timestamp,key);
    return {ok:true,duplicate:!result.meta.changes};
  }
  if(path==='/api/budget' && method==='POST') {
    const id=uid(); await run(env,'INSERT INTO budget_entries(id,wallet_source,merchant,amount_sar,balance_after_sar,transaction_timestamp) VALUES(?,?,?,?,?,?)',id,text(data.wallet_source,'wallet',100,true),text(data.merchant||'','merchant',200),number(data.amount_sar,'amount',-10000000,10000000),data.balance_after_sar==null||data.balance_after_sar===''?null:number(data.balance_after_sar,'balance',-100000000,100000000),timestamp(data.transaction_timestamp||iso(),true)); return {id};
  }
  const match=path.match(/^\/api\/budget\/([\w-]+)$/);
  if(match && method==='DELETE') {await run(env,'DELETE FROM budget_entries WHERE id=?',match[1]); return {ok:true};} return null;
}
export async function leisureState(env,now=Date.now()) {
  const completed=await one(env,"SELECT COUNT(*) AS count FROM tasks WHERE status='completed' AND completed_at>=?",iso(now-7*86400000));
  const focus=await activeFocus(env,now);
  const windows=await all(env,'SELECT * FROM leisure_windows WHERE ends_at>=? ORDER BY starts_at',iso(now));
  return {friday:weekdayAST(now)===5,completed_this_week:completed.count,suggested_minutes:Math.min(180,30+completed.count*10),windows,can_synthesize:weekdayAST(now)===5 && (!focus || focus.session_type==='break')};
}
async function leisureRoute(env,path,method,data) {
  if(path==='/api/leisure' && method==='GET') return leisureState(env);
  if(path==='/api/leisure' && method==='POST') {
    const start=timestamp(data.starts_at,true),end=timestamp(data.ends_at,true); if(end<=start) fail(400,'End time must follow start time.');
    const id=uid(); await run(env,'INSERT INTO leisure_windows(id,title,starts_at,ends_at) VALUES(?,?,?,?)',id,text(data.title,'title',200,true),start,end); return {id};
  }
  const match=path.match(/^\/api\/leisure\/([\w-]+)$/);
  if(match && method==='DELETE') {await run(env,'DELETE FROM leisure_windows WHERE id=?',match[1]); return {ok:true};} return null;
}
export async function toolsRoute(env,path,method,data) {
  for(const route of [healthRoute,locationRoute,ideaRoute,curriculumRoute,diaryRoute,budgetRoute,leisureRoute]) { const result=await route(env,path,method,data); if(result!==null) return result; }
  return null;
}
