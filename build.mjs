import {mkdir,copyFile,readFile,writeFile,readdir,rm} from 'node:fs/promises';
// Explicit allowlist: the Pages directory never contains Worker code, SQL, docs sources or secrets.
const pages=['index','taskitator','curry','subject','health','health-medicine','health-sick','locations','ideas','diary','budget','leisure','settings'];
const scripts=['dashboard','taskitator','curry','subject','health','locations','ideas','diary','budget','leisure','settings','shared','config'];
await rm('dist',{recursive:true,force:true});await mkdir('dist');
for(const file of [...pages.map(x=>x+'.html'),...scripts.map(x=>x+'.js'),'shared.css','favicon.svg','_headers','MACRODROID.html'])await copyFile(file,'dist/'+file);
if(process.env.MAZENOS_API_URL) {
 const url=new URL(process.env.MAZENOS_API_URL);if(url.protocol!=='https:')throw Error('MAZENOS_API_URL must use HTTPS.');
 await writeFile('dist/config.js','export const API_BASE = '+JSON.stringify(url.origin)+';\n');
}
console.log('Pages files prepared in dist/.');
