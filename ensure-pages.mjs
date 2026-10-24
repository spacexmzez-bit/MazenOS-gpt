// GitHub Actions helper. Creates a direct-upload Pages project only if it is absent.
const {CLOUDFLARE_API_TOKEN:token,CLOUDFLARE_ACCOUNT_ID:account,MAZENOS_PAGES_PROJECT:project}=process.env;
if(!token||!account||!/^[a-z0-9][a-z0-9-]*$/.test(project||''))throw Error('Set the Cloudflare credentials and a valid Pages project name.');
const base='https://api.cloudflare.com/client/v4/accounts/'+encodeURIComponent(account)+'/pages/projects';
const headers={Authorization:'Bearer '+token,'Content-Type':'application/json'};
const existing=await fetch(base+'/'+encodeURIComponent(project),{headers,signal:AbortSignal.timeout(30000)});
if(existing.ok)console.log('Pages project is ready.');
else if(existing.status===404){
 const created=await fetch(base,{method:'POST',headers,body:JSON.stringify({name:project,production_branch:'main'}),signal:AbortSignal.timeout(30000)});
 const result=await created.json();if(!created.ok||!result.success)throw Error('Could not create the Pages project. Check the project name and Cloudflare Pages permissions.');
 console.log('Pages project created.');
}else throw Error('Could not check the Pages project. Check Cloudflare account and Pages permissions.');
