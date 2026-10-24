import {API_BASE} from './config.js';
export const $=(selector,root=document)=>root.querySelector(selector);
export const $$=(selector,root=document)=>[...root.querySelectorAll(selector)];
export const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
export const today=()=>new Date(Date.now()+10800000).toISOString().slice(0,10);
export const money=value=>new Intl.NumberFormat('en-SA',{style:'currency',currency:'SAR',maximumFractionDigits:2}).format(value||0);
export const date=value=>value?new Intl.DateTimeFormat('en-GB',{timeZone:'Asia/Riyadh',dateStyle:'medium',timeStyle:'short'}).format(new Date(value)):'No due date';
export const empty=(title,subtitle='')=>`<div class="empty"><strong>${esc(title)}</strong>${esc(subtitle)}</div>`;
export function toast(message,error=false) { $('.toast')?.remove();const node=document.createElement('div');node.className='toast'+(error?' error':'');node.role=error?'alert':'status';node.textContent=message;document.body.append(node);setTimeout(()=>node.remove(),error?10000:4000); }
export const on=(selector,event,fn,root=document)=>{for(const node of $$(selector,root))node.addEventListener(event,e=>{try{Promise.resolve(fn(e,node)).catch(error=>toast(error.message,true));}catch(error){toast(error.message,true);}});};
export function values(form) { const result=Object.fromEntries(new FormData(form));for(const check of $$('input[type=checkbox]',form))result[check.name]=check.checked;return result; }
export function connection() {return (localStorage.getItem('mazenos_api')||API_BASE||location.origin).replace(/\/$/,'');}
let token=sessionStorage.getItem('mazenos_session')||'';
export function saveToken(value) {token=value||'';if(token)sessionStorage.setItem('mazenos_session',token);else sessionStorage.removeItem('mazenos_session');}
export async function api(path,{method='GET',data,retry=true}={}) {
  const result=await fetch(connection()+path,{method,headers:{...(token?{Authorization:'Bearer '+token}:{}),...(data!==undefined?{'Content-Type':'application/json'}:{})},...(data!==undefined?{body:JSON.stringify(data)}:{})});
  let body;try{body=await result.json();}catch{throw Error('The server returned an unexpected response. Check the connection address.');}
  if(!result.ok) {
    if(body.code==='PROVIDER_EXHAUSTED'&&retry) {
      const config=await api('/api/settings'),next=config.preferences.ai_provider==='claude'?'gemini':'claude';
      if(await choose('Provider limit reached',body.error,'Switch to '+(next==='claude'?'Claude':'Gemini'))) {
        await api('/api/settings',{method:'PUT',data:{preferences:{ai_provider:next}}});return api(path,{method,data,retry:false});
      }
    }
    if(result.status===401 && !path.startsWith('/api/auth/')) {saveToken('');setTimeout(()=>location.reload(),1000);}
    const error=Error(body.error||'This request could not be completed.');error.status=result.status;error.code=body.code;throw error;
  }
  return body;
}
export function modal(title,content,{submit,label='Save',wide=false}={}) {
  const dialog=document.createElement('dialog'); if(wide)dialog.style.width='min(800px,calc(100% - 28px))';
  dialog.innerHTML=`<form><header><h2>${esc(title)}</h2><button type="button" class="icon-button ghost" data-close aria-label="Close">×</button></header>${content}<p class="dialog-error" role="alert" hidden></p>${submit?`<div class="form-actions"><button type="button" class="ghost" data-close>Cancel</button><button class="primary" type="submit">${esc(label)}</button></div>`:''}</form>`;
  document.body.append(dialog);dialog.showModal();
  on('[data-close]','click',()=>dialog.close(),dialog);
  dialog.addEventListener('click',e=>{if(e.target===dialog){const r=dialog.getBoundingClientRect();if(e.clientX<r.left||e.clientX>r.right||e.clientY<r.top||e.clientY>r.bottom)dialog.close();}});
  dialog.addEventListener('close',()=>dialog.remove(),{once:true});
  if(submit)$('form',dialog).addEventListener('submit',async e=>{
    e.preventDefault();const button=$('[type=submit]',dialog);button.disabled=true;$('.dialog-error',dialog).hidden=true;
    try{await submit(values(e.target),e.target,dialog);dialog.close();}catch(error){$('.dialog-error',dialog).textContent=error.message;$('.dialog-error',dialog).hidden=false;}finally{button.disabled=false;}
  });
  return dialog;
}
export function choose(title,message,label='Confirm') {
  return new Promise(resolve=>{const dialog=modal(title,`<p>${esc(message)}</p><div class="form-actions"><button type="button" data-close>Cancel</button><button type="button" class="primary" data-yes>${esc(label)}</button></div>`);let yes=false;$('[data-yes]',dialog).onclick=()=>{yes=true;dialog.close();};dialog.addEventListener('close',()=>resolve(yes),{once:true});});
}
export function download(filename,content,type='application/json') {const url=URL.createObjectURL(new Blob([content],{type})),a=document.createElement('a');a.href=url;a.download=filename;a.click();setTimeout(()=>URL.revokeObjectURL(url),10000);}
export const toISO=value=>value?new Date(value+':00+03:00').toISOString():null;
export const toInput=value=>value?new Date(Date.parse(value)+10800000).toISOString().slice(0,16):'';
export const input=(name,label,value='',type='text',extra='')=>`<label>${esc(label)}<input name="${name}" type="${type}" value="${esc(value)}" ${extra}></label>`;
export const area=(name,label,value='',extra='')=>`<label>${esc(label)}<textarea name="${name}" ${extra}>${esc(value)}</textarea></label>`;
export const check=(name,label,checked=false)=>`<label class="check"><input type="checkbox" name="${name}" ${checked?'checked':''}>${esc(label)}</label>`;
export const select=(name,label,items,value)=>`<label>${esc(label)}<select name="${name}">${items.map(([v,l])=>`<option value="${esc(v)}" ${String(value)===String(v)?'selected':''}>${esc(l)}</option>`).join('')}</select></label>`;
export function header(title,subtitle='',actions='') {return `<div class="page-head"><div><p class="eyebrow">Your space, in order</p><h1>${esc(title)}</h1><p class="muted">${esc(subtitle)}</p></div>${actions}</div>`;}
export function shell(name) {
  const current=location.pathname.split('/').pop()||'index.html';
  document.body.innerHTML=`<header class="topbar"><a class="brand" href="index.html"><span class="brand-mark">M</span>MazenOS</a><div class="top-actions"><span class="date">${esc(new Intl.DateTimeFormat('en-GB',{timeZone:'Asia/Riyadh',weekday:'long',day:'numeric',month:'long'}).format(new Date()))}</span>${name!=='Dashboard'?'<a class="small button ghost" href="index.html">Dashboard</a>':''}<a class="icon-button button ghost" href="settings.html?from=${encodeURIComponent(current)}" aria-label="Settings"><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" aria-hidden="true"><circle cx="12" cy="12" r="3"/><path d="m9 3-1 3-3 1-2 3 2 2-1 3 3 2 2 3 3-1 3 1 2-3 3-2-1-3 2-2-2-3-3-1-1-3Z"/></svg></a></div></header><main class="container" id="main"><div class="loading">Opening your space…</div></main><div id="global-notice" aria-live="polite"></div>`;
}
async function login() {
  document.body.innerHTML=`<main class="login-screen"><div class="panel login-card"><a class="brand" href="index.html"><span class="brand-mark">M</span>MazenOS</a><h1>Welcome to your space.</h1><p class="muted">Sign in to continue.</p><form class="fields" id="login-form">${input('url','Server address',connection(),'url','required autocomplete="url"')}${input('password','Master password','','password','required minlength="12" maxlength="256" autocomplete="current-password"')}<details><summary class="muted">First-time setup</summary><p class="help-text">Enter the setup code you created for your server.</p>${input('setup_token','Setup code','','password','autocomplete="off"')}</details><p class="dialog-error" id="login-error" hidden></p><button class="primary" type="submit">Continue</button></form></div></main>`;
  return new Promise(resolve=>{$('#login-form').addEventListener('submit',async e=>{e.preventDefault();const button=$('[type=submit]');button.disabled=true;$('#login-error').hidden=true;
    try{const v=values(e.target),url=new URL(v.url);if(url.protocol!=='https:' && !(url.protocol==='http:'&&['localhost','127.0.0.1'].includes(url.hostname)))throw Error('Use an HTTPS server address.');localStorage.setItem('mazenos_api',url.origin);const result=await api(v.setup_token?'/api/auth/setup':'/api/auth/login',{method:'POST',data:v});saveToken(result.token);resolve();}catch(error){$('#login-error').textContent=error.message;$('#login-error').hidden=false;}finally{button.disabled=false;}
  });});
}
export async function ready(name) {
  if(!token) await login();
  let config;try{config=await api('/api/settings');}catch(error){if(error.status===401){await login();config=await api('/api/settings');}else{document.body.innerHTML=`<main class="login-screen"><div class="panel"><h1>Could not connect.</h1><p>${esc(error.message)}</p><button id="reconnect">Connection settings</button></div></main>`;$('#reconnect').onclick=()=>{saveToken('');location.reload();};throw error;}}
  shell(name);
  if(!window.mazenosReminderTimer)window.mazenosReminderTimer=setInterval(()=>focusBanner().catch(()=>{}),60000);
  document.title=name==='Dashboard'?'MazenOS':name+' · MazenOS';
  return config;
}
export async function focusBanner() {
  const state=await api('/api/focus');
  if(state.needs_break) {$('#global-notice').innerHTML='<div class="toast"><span>Time for water and something to eat. Take a short break.</span> <button class="small" id="dismiss-break">Got it</button></div>';on('#dismiss-break','click',async()=>{await api('/api/focus/reminder',{method:'POST',data:{}});$('#global-notice').replaceChildren();});}
}
