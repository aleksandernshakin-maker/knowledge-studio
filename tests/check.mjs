import fs from 'node:fs';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import assert from 'node:assert/strict';
import {fileURLToPath} from 'node:url';
process.chdir(fileURLToPath(new URL('..',import.meta.url)));
const modules=['app.js','boot.js','db.js','backup.js','pdf-basic.js','zip-lite.js','search-worker.js','sw.js','vendor/pdfjs/pdf.mjs','vendor/pdfjs/pdf.worker.mjs'];
modules.push(...fs.readdirSync('tests').filter(n=>n.endsWith('.js')).map(n=>'tests/'+n));
for(const file of modules){
 const result=spawnSync(process.execPath,['--input-type=module','--check'],{input:fs.readFileSync(file),encoding:'utf8'});
 assert.equal(result.status,0,file+'\n'+result.stderr);
 const text=fs.readFileSync(file,'utf8');
 if(!file.startsWith('vendor'))for(const match of text.matchAll(/(?:from\s*|import\s*\()\s*['"](\.\.?\/[^'"]+)['"]/g))assert.ok(fs.existsSync(path.resolve(path.dirname(file),match[1])),match[1]);
}
const manifest=JSON.parse(fs.readFileSync('manifest.webmanifest','utf8'));
assert.equal(manifest.scope,'./');assert.equal(manifest.start_url,'./#/library');assert.equal(manifest.display,'standalone');
for(const icon of manifest.icons){const bytes=fs.readFileSync(icon.src);assert.equal(bytes.toString('hex',0,8),'89504e470d0a1a0a');assert.equal(`${bytes.readUInt32BE(16)}x${bytes.readUInt32BE(20)}`,icon.sizes);}
const sw=fs.readFileSync('sw.js','utf8'),core=sw.match(/const CORE=(\[[^;]+\]);/)[1];
const resources=[...core.matchAll(/'([^']+)'/g)].map(match=>match[1]);
for(const file of resources)assert.ok(fs.existsSync(file),file);
for(const folder of ['cmaps','standard_fonts','wasm'])for(const file of fs.readdirSync('vendor/pdfjs/'+folder))assert.ok(resources.includes('./vendor/pdfjs/'+folder+'/'+file),file);
assert.ok(!/import\s+.*from\s+['"].*pdf\.mjs/.test(fs.readFileSync('pdf-basic.js','utf8')),'PDF must lazy load');
const {makeZip,readZip}=await import('../zip-lite.js');
const zip=await makeZip([{name:'data/library.json',data:new Blob(['{"text":"Проверка"}'])}]);
assert.equal(new TextDecoder().decode((await readZip(zip))['data/library.json']),'{"text":"Проверка"}');
const damaged=new Uint8Array(await zip.arrayBuffer());damaged[48]^=1;
await assert.rejects(readZip(new Blob([damaged])));
await assert.rejects(readZip(zip.slice(0,zip.size-1)));
await assert.rejects(readZip(await makeZip([{name:'../escape',data:new Blob(['x'])}])));
await assert.rejects(readZip(await makeZip([{name:'same',data:new Blob(['a'])},{name:'same',data:new Blob(['b'])}])));
console.log(`PASS: ${modules.length} ESM modules, imports, manifest/icons, ${resources.length} SW paths, complete PDF resources, ZIP roundtrip and rejection tests.`);
