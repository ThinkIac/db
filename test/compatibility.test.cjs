const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const modern = require('..');
const original = require('./reference/index.cjs');
const vault = require('../private-vault.cjs');
const oldVault = require('./reference/private-vault.cjs');
const composer = require('../schema-composer.cjs');
const oldComposer = require('./reference/schema-composer.cjs');
const temp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'db-compat-'));
function fake(root, extra={}) { return {applicationRoot:()=>root,dataDir:()=>null,composeSchema:()=>null,appendLog(){},currentAuthority:()=>({}),createVault:()=>({}),openPrivateDatabase(){},log(){},...extra}; }
function scriba(root) {
 const dir=path.join(root,'node_modules/scriba');fs.mkdirSync(dir,{recursive:true});fs.writeFileSync(path.join(dir,'package.json'),JSON.stringify({name:'scriba',main:'index.js'}));
 fs.writeFileSync(path.join(dir,'index.js'),`module.exports=class Scriba { constructor(){this.ids=[];this.calls=[]} addTenant(x){this.ids.push(x.id);this.calls.push(x)} tenants(){return this.ids} entity(name,tenant){return {name,tenant}} documents(tenant){return {tenant}} reloadTenantSchema(id,schema){this.reload=[id,schema]} }`);
}
for(const [name, Type] of [['original',original],['type',modern]]) {
 test(name+': tenant, documents, caching and authority',async()=>{
  const root=temp();try {scriba(root);fs.writeFileSync(path.join(root,'package.json'),'{}');let checks=0;const db=Type.createDatabase(fake(root,{currentAuthority:()=>({access:{enforce(){checks++}}})}));
  db.addTenant({packageName:'alpha',dir:root});assert.deepEqual(db.getProxy('alpha').User,{name:'User',tenant:'alpha'});assert.equal(db.getProxy('alpha')[Symbol.iterator],undefined);
  const states=new Map();const container={state(n){if(!states.has(n))states.set(n,new Map());return states.get(n)},registry:{getPackage(){return {dir:root}}}};
  const a=await db.getDocuments(container,'alpha');assert.equal(a,await db.getDocuments(container,'alpha'));assert.deepEqual(a,{tenant:'alpha'});await assert.rejects(db.getDocuments(container,'../bad'),/INVALID_DATABASE_TENANT/);assert.equal(checks,5);
  }finally{fs.rmSync(root,{recursive:true,force:true})}
 });
 test(name+': schema wiring and reload events',async()=>{
  const root=temp();try{scriba(root);const composed={outputPath:path.join(root,'generated.prisma'),sources:[path.join(root,'model.schema')]};const db=Type.createDatabase(fake(root,{composeSchema:()=>composed}));const states=new Map(),listeners=new Map(),events=[];
  const c={state(n){if(!states.has(n))states.set(n,new Map());return states.get(n)},bus:{on(n,f){listeners.set(n,f)},once(n,f){listeners.set(n,f)},async emit(n,p){events.push([n,p])}},registry:{getPackage(){return {dir:root}}}};
  db.install(c);await listeners.get('package:wiring')({pkg:{folder:'p',dir:root}});await listeners.get('package:wiring')({pkg:{folder:'p',dir:root}});assert.equal(db.getScriba().calls.length,1);await listeners.get('db:schema_changed')({pkg:'p'});assert.deepEqual(db.getScriba().reload,['p',composed.outputPath]);assert.equal(events.length,2);
  }finally{fs.rmSync(root,{recursive:true,force:true})}
 });
}
for(const [label, sources] of [
 ['aliases and model extension',{'base.schema':'model User {\n id Int @id\n}\n','more.scriba':'model User {\n name String\n}\n'}],
 ['primary field precedence',{'schema.prisma':'model User {\n id Int @id\n name String\n}\n','more.schema':'model User {\n name Int\n}\n'}],
 ['enum merge',{'a.schema':'enum Role {\n ADMIN\n}\n','b.scriba':'enum Role {\n USER\n}\n'}],
 ['conflicting fragments',{'a.schema':'model User {\n id Int\n}\n','b.schema':'model User {\n id String\n}\n'}],
 ['unclosed declaration',{'a.schema':'model User {\n id Int\n'}],
 ['nested package boundary',{'a.schema':'model User {\n id Int\n}\n','nested/package.json':'{}','nested/b.schema':'model Hidden {\n id Int\n}\n'}],
 ['no schema',{}]
]) test('composer compatibility: '+label,()=>{
 const root=temp();try {for(const [file,body] of Object.entries(sources)){fs.mkdirSync(path.dirname(path.join(root,file)),{recursive:true});fs.writeFileSync(path.join(root,file),body)}
 function run(api){try{return {value:api.composePackageSchema(root)}}catch(e){return {error:e.message}}}
 assert.deepEqual(run(composer),run(oldComposer));
 }finally{fs.rmSync(root,{recursive:true,force:true})}
});
test('vault derived keys match the original and remain tenant-specific',async()=>{
 const options={keyring:null,masterKeyProvider:()=>Buffer.alloc(32,7)};const a=new vault.PrivateVault(options),b=new oldVault.PrivateVault(options);
 for(const name of ['alpha','beta','a.b-c_1']) assert.deepEqual(await a.keyFor(name),await b.keyFor(name));
 assert.notDeepEqual(await a.keyFor('alpha'),await a.keyFor('beta'));
 await assert.rejects(a.keyFor('../bad'),/package name is invalid/);
});
test('vault fails closed and erases generated key when keyring fails',async()=>{
 for(const api of [vault,oldVault]) {await assert.rejects(new api.PrivateVault({keyring:null}).unlock(),{code:'PRIVATE_VAULT_UNAVAILABLE'});await assert.rejects(new api.PrivateVault({masterKeyProvider:()=>Buffer.alloc(1)}).unlock(),/at least 32/);const bytes=Buffer.alloc(32,9);await assert.rejects(new api.PrivateVault({randomBytes:()=>bytes,keyring:{get:()=>null,set(){throw Error('locked')}}}).unlock(),/locked/);assert.ok(bytes.every(v=>v===0));}
});
test('SQLCipher opens encrypted files, verifies keys and wipes input',()=>{
 const root=temp();try{const file=path.join(root,'private.db'),key=Buffer.alloc(32,5);const db=vault.openSqlCipherDatabase(file,key);assert.ok(key.every(v=>v===0));db.exec('CREATE TABLE t (id INTEGER); INSERT INTO t VALUES (42)');db.close();assert.notEqual(fs.readFileSync(file).subarray(0,15).toString(),'SQLite format 3');const reopened=oldVault.openSqlCipherDatabase(file,Buffer.alloc(32,5));assert.equal(reopened.prepare('SELECT id FROM t').get().id,42);reopened.close();const wrong=Buffer.alloc(32,8);assert.throws(()=>vault.openSqlCipherDatabase(file,wrong));assert.ok(wrong.every(v=>v===0));}finally{fs.rmSync(root,{recursive:true,force:true})}
});
test('isolated capability only exposes own records and validates requests',()=>{
 const root=temp();try {scriba(root);const module=modern.provideDb({applicationRoot:()=>root,dataDir:()=>null,appendLog(){},currentAuthority:()=>({}),log(){}});
 const instance=module.api.getScriba();instance.entity=()=>({_fields:[{name:'id'},{name:'name'}],'1':{id:1,name:'Ana',hidden:'secret',toJSON(){return this}},run:(x)=>x+1});
 const call=module.capabilities.database,ctx={package:'p'};
 assert.throws(()=>call({tenant:'other'},ctx),/own database/);
 assert.deepEqual(call({tenant:'p',operation:'index',entity:'User',key:'1'},ctx),{id:1,name:'Ana'});
 assert.equal(call({tenant:'p',operation:'index',entity:'User',key:'missing'},ctx),undefined);
 assert.throws(()=>call({tenant:'p',operation:'index',entity:'User',key:'run'},ctx),/did not resolve a record/);
 assert.equal(call({tenant:'p',entity:'User',method:'run',args:[2]},ctx),3);
 assert.throws(()=>call({tenant:'p',entity:'User',method:'missing',args:[]},ctx),/Unknown database operation/);
 assert.throws(()=>call({tenant:'p',entity:'User',method:'run',args:{}},ctx),/Invalid database capability/);
 }finally{fs.rmSync(root,{recursive:true,force:true})}
});
