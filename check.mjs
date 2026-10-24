import {readdir,readFile,access} from 'node:fs/promises';
import {spawnSync} from 'node:child_process';
const files=await readdir('.');let count=0;
for(const file of files.filter(f=>/\.(?:js|mjs)$/.test(f))) {
 const source=await readFile(file,'utf8');
 if(source.split('\n').length>5000)throw Error(file+' exceeds the 5,000-line limit.');
 const result=spawnSync(process.execPath,['--check',file],{encoding:'utf8'});if(result.status!==0)throw Error(result.stderr);
 for(const match of source.matchAll(/(?:from\s*|import\s*)['"](\.\/[^'"]+)['"]/g))await access(match[1]);count++;
}
for(const file of files.filter(f=>f.endsWith('.html'))) {
 const source=await readFile(file,'utf8');
 if(!source.includes('<meta name="viewport"'))throw Error(file+' is missing a viewport.');
 for(const match of source.matchAll(/(?:src|href)="([^"?#]+)(?:[^"#]*)"/g))if(!/^(?:https?:|#|data:)/.test(match[1]))await access(match[1]);
}
const forbidden=files.filter(f=>f==='node_modules'||f==='dist');
console.log(`${count} JavaScript files passed syntax, imports and size checks. HTML assets resolved.`);
