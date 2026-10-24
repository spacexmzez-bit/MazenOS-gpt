import {all,one,run,stmt,setting,setSetting,uid,iso,dateAST,logicalDate,weekdayAST,healthToday,inRest,fail,text,number,timestamp,bool,validDate} from './worker-lib.js';
const active = task => ['pending','in_progress'].includes(task.status);
export function validateChain(tasks, id, parentId) {
  const seen=new Set([id]); let parent=parentId;
  while(parent) { if(seen.has(parent)) fail(400,'A task cannot depend on itself or form a loop.'); seen.add(parent); const node=tasks.find(t=>t.id===parent); if(!node) fail(400,'Choose an existing prerequisite.'); parent=node.depends_on_task_id; }
}
export function cascadePlan(tasks, now=Date.now()) {
  const map=new Map(tasks.map(t=>[t.id,{...t}])), visiting=new Set(), done=new Set(), changed=new Map();
  function visit(task) {
    if(done.has(task.id)) return;
    if(visiting.has(task.id)) fail(409,'A task chain contains a loop. Fix its prerequisite.');
    visiting.add(task.id);
    const parent=map.get(task.depends_on_task_id);
    if(parent) {
      visit(parent);
      if(task.is_consecutive && active(task) && active(parent) && !task.paused_by_sickness && !parent.paused_by_sickness && parent.due_timestamp && task.due_timestamp) {
        const parentDue=Date.parse(parent.due_timestamp), childDue=Date.parse(task.due_timestamp);
        const earliest=Math.max(now,parentDue)+(task.dependency_lag_minutes??task.estimated_duration_minutes)*60000;
        if(parentDue<now || childDue<earliest) {
          task.due_timestamp=iso(Math.max(childDue,earliest)); changed.set(task.id,task.due_timestamp);
        }
      }
    }
    visiting.delete(task.id); done.add(task.id);
  }
  for(const task of map.values()) visit(task);
  return [...changed].map(([id,due])=>({id,due_timestamp:due,version:map.get(id).version}));
}
export async function rebalance(env,now=Date.now()) {
  const tasks=await all(env,'SELECT * FROM tasks WHERE status IN (?,?)','pending','in_progress');
  const changes=cascadePlan(tasks,now);
  if(changes.length) await env.DB.batch(changes.map(t=>stmt(env,'UPDATE tasks SET due_timestamp=?,version=version+1 WHERE id=? AND version=?',t.due_timestamp,t.id,t.version)));
  return changes;
}
export async function status(env,now=Date.now()) {
  const health=await healthToday(env,now), sick=health.is_sick===1;
  const overdue=await one(env,"SELECT id,title FROM tasks WHERE priority=1 AND status IN ('pending','in_progress') AND is_bonus=0 AND paused_by_sickness=0 AND due_timestamp < ? ORDER BY due_timestamp LIMIT 1",iso(now));
  const media=await env.TEMP.get('media_lock','json');
  const rest=await inRest(env,now);
  const leisure=weekdayAST(now)===5 || !!await one(env,'SELECT id FROM leisure_windows WHERE starts_at<=? AND ends_at>? LIMIT 1',iso(now),iso(now));
  const unlocked=sick || rest || leisure || (!overdue && !media);
  return {device_unlocked:unlocked,reason:sick?'recovery':rest?'rest':leisure?'leisure':media?'unrelated_media':overdue?'overdue_task':'clear'};
}
export async function saveTask(env,data,id) {
  const old=id?await one(env,'SELECT * FROM tasks WHERE id=?',id):null;
  if(id && !old) fail(404,'Task not found.');
  if(old && !active(old)) fail(409,'Completed and archived tasks cannot be edited.');
  const tasks=await all(env,'SELECT id,depends_on_task_id,due_timestamp FROM tasks');
  if(!id && tasks.length>=10000) fail(409,'Archive or export old tasks before adding more.');
  const task={...old,...data}; id ||= uid();
  const title=text(task.title,'title',200,true), description=text(task.description||'','description',5000), priority=number(task.priority,'priority',1,4,true);
  const due=timestamp(task.due_timestamp), duration=number(task.estimated_duration_minutes??45,'duration',1,1440,true);
  const parent=task.depends_on_task_id || null, consecutive=bool(task.is_consecutive);
  if(consecutive && !parent) fail(400,'Choose a prerequisite for a consecutive task.');
  validateChain(tasks,id,parent);
  const criteria=text(task.ai_audit_criteria||'','proof criteria',3000), video=bool(task.requires_video);
  if(video && !criteria) fail(400,'Enter proof criteria for a video task.');
  if(old && (task.version !== old.version)) fail(409,'This task changed on another device. Refresh and try again.');
  if(bool(data.is_bonus) && !old?.is_bonus && (!due || dateAST(Date.parse(due))<=dateAST())) fail(400,'Choose a future due date for a bonus task.');
  const parentTask=tasks.find(t=>t.id===parent);
  const lag=old && old.depends_on_task_id===parent && old.due_timestamp===due ? old.dependency_lag_minutes : consecutive && due && parentTask?.due_timestamp ? Math.max(duration,(Date.parse(due)-Date.parse(parentTask.due_timestamp))/60000) : null;
  const base=[title,description,priority,+consecutive,parent,due,duration,criteria,+video,+bool(task.is_academic),lag];
  if(old) {
    const result=await run(env,'UPDATE tasks SET title=?,description=?,priority=?,is_consecutive=?,depends_on_task_id=?,due_timestamp=?,estimated_duration_minutes=?,ai_audit_criteria=?,requires_video=?,is_academic=?,dependency_lag_minutes=?,version=version+1 WHERE id=? AND version=?',...base,id,old.version);
    if(!result.meta.changes) fail(409,'This task changed. Refresh before saving.');
  } else {
    await run(env,'INSERT INTO tasks(title,description,priority,is_consecutive,depends_on_task_id,due_timestamp,estimated_duration_minutes,ai_audit_criteria,requires_video,is_academic,dependency_lag_minutes,id,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)',...base,id,iso());
  }
  if(bool(data.is_bonus) && !old?.is_bonus) await pullBonus(env,id);
  const health=await healthToday(env);if(health.is_sick) await setSickness(env,true,health.sickness_notes||'');
  await rebalance(env);
  return one(env,'SELECT * FROM tasks WHERE id=?',id);
}
export async function assertTaskReady(env,task) {
  if(!task || !active(task)) fail(409,'This task is no longer active.');
  if(task.paused_by_sickness) fail(409,'This task is paused during recovery.');
  if(task.depends_on_task_id) { const parent=await one(env,'SELECT status FROM tasks WHERE id=?',task.depends_on_task_id); if(parent && parent.status!=='completed') fail(409,'Complete the prerequisite first.'); }
}
export async function assertCompletable(env,task) {
  await assertTaskReady(env,task);
  if(await one(env,'SELECT id FROM subtasks WHERE task_id=? AND is_completed=0 LIMIT 1',task.id)) fail(409,'Complete all subtasks first.');
}
export async function completeTask(env,task,audit=null) {
  await assertCompletable(env,task);
  if((task.ai_audit_criteria || task.requires_video) && !audit) fail(409,'Upload proof to complete this task.');
  const commands=[];
  if(audit) commands.push(stmt(env,"INSERT INTO audit_receipts(id,task_id,verdict,score,critique,evaluated_at) SELECT ?,id,'passed',?,?,? FROM tasks WHERE id=? AND version=? AND status IN ('pending','in_progress')",uid(),audit.score,audit.critique,iso(),task.id,task.version));
  commands.push(stmt(env,"UPDATE tasks SET status='completed',completed_at=?,version=version+1 WHERE id=? AND version=? AND status IN ('pending','in_progress')",iso(),task.id,task.version));
  const results=await env.DB.batch(commands);
  if(!results.at(-1).meta.changes) fail(409,'The task changed while it was being checked. Submit fresh proof.');
  if(task.curriculum_unit_id && task.is_retrieval_drill) await run(env,'UPDATE curriculum_units SET last_reviewed_date=? WHERE id=?',dateAST(),task.curriculum_unit_id);
  await env.TEMP.delete('video_ok:'+task.id);
  const media=await env.TEMP.get('media_lock','json');if(media?.task_id===task.id) await env.TEMP.delete('media_lock');
  return {ok:true};
}
export async function pullBonus(env,id,now=Date.now()) {
  const task=await one(env,'SELECT * FROM tasks WHERE id=?',id);
  if(!task || !active(task) || task.is_bonus || !task.due_timestamp || dateAST(Date.parse(task.due_timestamp))<=dateAST(now)) fail(409,'Choose an upcoming task to pull into today.');
  await run(env,'UPDATE tasks SET is_bonus=1,original_due_timestamp=due_timestamp,original_scheduled_date=?,due_timestamp=?,version=version+1 WHERE id=? AND version=?',dateAST(Date.parse(task.due_timestamp)),dateAST(now)+'T20:59:00.000Z',id,task.version);
  return {ok:true};
}
export async function setSickness(env,sick,notes='') {
  const key=logicalDate(), health=await healthToday(env), started=await setting(env,'sickness_started_at');
  const commands=[stmt(env,'INSERT INTO daily_health_logs(date,is_sick,sickness_notes,medicine_target_count) VALUES(?,?,?,?) ON CONFLICT(date) DO UPDATE SET is_sick=excluded.is_sick,sickness_notes=excluded.sickness_notes,updated_at=CURRENT_TIMESTAMP',key,+sick,text(notes,'notes',3000),health.medicine_target_count)];
  if(sick) {
    commands.push(stmt(env,"WITH RECURSIVE chain(id) AS (SELECT id FROM tasks WHERE status IN ('pending','in_progress') AND ((is_academic=1 AND priority=1) OR estimated_duration_minutes>=60 OR paused_by_sickness=1) UNION SELECT t.id FROM tasks t JOIN chain c ON t.depends_on_task_id=c.id WHERE t.status IN ('pending','in_progress')) UPDATE tasks SET previous_priority=priority,priority=4,paused_by_sickness=1,pause_started_at=?,version=version+1 WHERE id IN (SELECT id FROM chain) AND paused_by_sickness=0",iso()));
    commands.push(stmt(env,"UPDATE focus_sessions SET cancelled_at=? WHERE completed_at IS NULL AND cancelled_at IS NULL AND task_id IN (SELECT id FROM tasks WHERE paused_by_sickness=1)",iso()));
  } else {
    const delay=started ? Math.max(0,Date.now()-Date.parse(started)) : 0;
    const paused=await all(env,'SELECT * FROM tasks WHERE paused_by_sickness=1');
    for(const t of paused) commands.push(stmt(env,'UPDATE tasks SET priority=COALESCE(previous_priority,priority),previous_priority=NULL,paused_by_sickness=0,pause_started_at=NULL,due_timestamp=?,version=version+1 WHERE id=?',t.due_timestamp?iso(Date.parse(t.due_timestamp)+(t.pause_started_at?Math.max(0,Date.now()-Date.parse(t.pause_started_at)):delay)):null,t.id));
  }
  commands.push(stmt(env,'INSERT INTO system_settings(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value','sickness_started_at',JSON.stringify(sick?(started||iso()):null)));
  await env.DB.batch(commands);
  if(sick) await env.TEMP.delete('media_lock');
  return {ok:true};
}
export async function activeFocus(env,now=Date.now()) {
  return one(env,'SELECT * FROM focus_sessions WHERE completed_at IS NULL AND cancelled_at IS NULL AND julianday(started_at)+duration_minutes/1440.0 > julianday(?) LIMIT 1',iso(now));
}
export async function finishExpiredFocus(env,now=Date.now()) {
  await run(env,"UPDATE focus_sessions SET completed_at=strftime('%Y-%m-%dT%H:%M:%fZ',julianday(started_at)+duration_minutes/1440.0) WHERE completed_at IS NULL AND cancelled_at IS NULL AND julianday(started_at)+duration_minutes/1440.0 <= julianday(?)",iso(now));
}
export async function focusState(env,now=Date.now()) {
  await finishExpiredFocus(env,now);
  const current=await activeFocus(env,now), recent=await all(env,"SELECT * FROM focus_sessions WHERE cancelled_at IS NULL AND session_type!='break' AND started_at>=? ORDER BY started_at DESC LIMIT 100",iso(now-24*3600000));
  let end=now, continuous=0;
  for(const s of recent) { const start=Date.parse(s.started_at), stop=Math.min(now,Date.parse(s.completed_at||iso(start+s.duration_minutes*60000))); if(end-stop>10*60000) break; continuous+=Math.max(0,stop-start); end=start; }
  const reminder=continuous>=150*60000 && (!current?.last_reminder_at || now-Date.parse(current.last_reminder_at)>=150*60000);
  return {current,continuous_minutes:Math.floor(continuous/60000),needs_break:reminder};
}
export async function focusRoute(env,path,method,data) {
  if(path==='/api/focus' && method==='GET') return focusState(env);
  if(path==='/api/focus' && method==='POST') {
    await finishExpiredFocus(env);
    if(await activeFocus(env)) fail(409,'A focus timer is already running.');
    const type=data.session_type||'pomodoro'; if(!['pomodoro','deep_work','break'].includes(type)) fail(400,'Choose a timer type.');
    const task=data.task_id?await one(env,'SELECT * FROM tasks WHERE id=?',data.task_id):null;
    if(data.task_id && !task) fail(404,'Task not found.');
    if(task) await assertTaskReady(env, task);
    const id=uid(); await run(env,'INSERT INTO focus_sessions(id,task_id,duration_minutes,session_type,started_at) VALUES(?,?,?,?,?)',id,task?.id||null,number(data.duration_minutes,'duration',1,360,true),type,iso());
    return {id};
  }
  if(path==='/api/focus/stop') {
    const current=await activeFocus(env); if(current) await run(env,'UPDATE focus_sessions SET cancelled_at=? WHERE id=?',iso(),current.id); return {ok:true};
  }
  if(path==='/api/focus/reminder') {await run(env,'UPDATE focus_sessions SET last_reminder_at=? WHERE completed_at IS NULL AND cancelled_at IS NULL',iso()); return {ok:true};}
  return null;
}
export async function dailyCron(env,now=Date.now()) {
  await finishExpiredFocus(env,now);
  const previous=await one(env,'SELECT * FROM daily_health_logs WHERE date < ? ORDER BY date DESC LIMIT 1',logicalDate(now));
  const sick=!!await setting(env,'sickness_started_at');
  await env.DB.batch([
    stmt(env,'INSERT OR IGNORE INTO daily_health_logs(date,is_sick,medicine_target_count,medicine_taken_count) VALUES(?,?,?,0)',logicalDate(now),+sick,previous?.medicine_target_count||0),
    stmt(env,"UPDATE tasks SET due_timestamp=original_due_timestamp,is_bonus=0,original_scheduled_date=NULL,original_due_timestamp=NULL,version=version+1 WHERE is_bonus=1 AND status IN ('pending','in_progress') AND due_timestamp < ?",iso(now)),
    stmt(env,'DELETE FROM auth_sessions WHERE expires_at < ?',now),stmt(env,'DELETE FROM rate_limits WHERE expires_at < ?',now),
    stmt(env,'DELETE FROM idea_captures WHERE expires_at < ?',now-86400000)
  ]);
  await rebalance(env,now);
  await promoteObjectives(env,now);
}
export async function promoteObjectives(env,now=Date.now()) {
  // The nearest exam within seven days takes precedence. Otherwise keep a current main subject.
  const rows=await all(env,"SELECT * FROM curriculum_units WHERE status!='completed' ORDER BY exam_date IS NULL,exam_date,target_completion_date IS NULL,target_completion_date,unit_number");
  if(!rows.length) return;
  const near=rows.find(r=>r.exam_date && r.exam_date>=dateAST(now) && Date.parse(r.exam_date+'T00:00:00+03:00')-now<=7*86400000);
  const selected=near || rows.find(r=>r.is_main_objective) || rows[0];
  await env.DB.batch([
    stmt(env,"UPDATE curriculum_units SET is_main_objective=CASE WHEN exam_name=? THEN 1 ELSE 0 END WHERE status!='completed'",selected.exam_name),
    stmt(env,"UPDATE tasks SET priority=CASE WHEN curriculum_unit_id IN (SELECT id FROM curriculum_units WHERE is_main_objective=1) THEN 1 ELSE 2 END,version=version+1 WHERE curriculum_unit_id IS NOT NULL AND paused_by_sickness=0 AND status IN ('pending','in_progress')")
  ]);
}
export async function taskRoute(env,path,method,data) {
  if(path==='/api/tasks' && method==='GET') { await rebalance(env); return {tasks:await all(env,'SELECT * FROM tasks ORDER BY priority,due_timestamp IS NULL,due_timestamp,created_at'),subtasks:await all(env,'SELECT * FROM subtasks ORDER BY created_at')}; }
  if(path==='/api/tasks' && method==='POST') return saveTask(env,data);
  const match=path.match(/^\/api\/tasks\/([\w-]+)(?:\/(complete|bonus|archive|subtasks))?$/);
  if(!match) return null;
  const [,id,action]=match, task=await one(env,'SELECT * FROM tasks WHERE id=?',id); if(!task) fail(404,'Task not found.');
  if(!action && method==='PUT') return saveTask(env,data,id);
  if(method!=='POST') fail(405,'This action needs POST.');
  if(action==='complete') return completeTask(env,task);
  if(action==='bonus') return pullBonus(env,id);
  if(action==='archive') { if(await one(env,"SELECT id FROM tasks WHERE depends_on_task_id=? AND status IN ('pending','in_progress') LIMIT 1",id)) fail(409,'Move dependent tasks before archiving their prerequisite.'); await run(env,"UPDATE tasks SET status='archived',version=version+1 WHERE id=?",id); return {ok:true}; }
  if(action==='subtasks') {
    if(!active(task)) fail(409,'Only active tasks can have subtasks changed.');
    if(data.id) {const result=await run(env,'UPDATE subtasks SET is_completed=? WHERE id=? AND task_id=?',+bool(data.is_completed),data.id,id); if(!result.meta.changes) fail(404,'Subtask not found.');}
    else await run(env,'INSERT INTO subtasks(id,task_id,title) VALUES(?,?,?)',uid(),id,text(data.title,'subtask',200,true));
    await run(env,'UPDATE tasks SET version=version+1 WHERE id=?',id); return {ok:true};
  }
  return null;
}
