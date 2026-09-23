// One-off, bounded additive migration release. Credentials stay in process environment.
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, copyFileSync, mkdirSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { createRequire } from 'node:module';
const [candidate, previous, receipt, base] = process.argv.slice(2);
process.chdir(candidate);
const require = createRequire(candidate + '/apps/api/package.json');
const { Client } = require('pg');
const common = await import(pathToFileURL(candidate + '/apps/api/scripts/ops/common.mjs'));
const { localDatabase, auditMigrations, apiDependencyFingerprint, sha256 } = common;
const current = JSON.parse(readFileSync(candidate + '/RELEASE.json'));
const old = JSON.parse(readFileSync(previous + '/RELEASE.json'));
const expected = ['20260922103000_training_all_audience'];
assert.deepEqual(Object.keys(current.migrations).filter(k => !(k in old.migrations)), expected);
for (const [k,v] of Object.entries(old.migrations)) assert.equal(current.migrations[k],v);
for (const f of ['apps/api/package.json','packages/shared/package.json']) assert.equal(sha256(readFileSync(candidate+'/'+f)),sha256(readFileSync(previous+'/'+f)));
// Candidate dependencies were freshly installed from its frozen lockfile; do not reuse the old node_modules.
assert.equal(sha256(readFileSync(candidate+'/pnpm-lock.yaml')), current.lockSha256);
const { url, env } = localDatabase();
const isolated = 'yanqing_restore_ops_' + randomBytes(8).toString('hex') + '_test';
const restored = new URL(url); restored.pathname = '/' + isolated;
let created = false;
function run(bin,args,{cwd=candidate,env:customEnv=process.env,log,timeout=240000}={}) {
  const r=spawnSync(bin,args,{cwd,env:customEnv,encoding:'utf8',timeout,maxBuffer:8*1024*1024});
  if(log)writeFileSync(receipt+'/'+log,(r.stdout||'')+(r.stderr||''),{mode:0o600});
  assert(!r.error&&r.status===0, 'Step failed: '+(log||bin));
  return r.stdout;
}
async function withDb(connection,fn){const db=new Client({connectionString:connection,connectionTimeoutMillis:10000});try{await db.connect();return await fn(db);}finally{await db.end();}}
async function fingerprint(connection){return withDb(connection,async db=>{
 const tables=(await db.query(`SELECT tablename FROM pg_tables WHERE schemaname='public' AND tablename != '_prisma_migrations' ORDER BY tablename`)).rows;
 const values={};
 for(const {tablename} of tables){
   assert(/^[a-zA-Z0-9_]+$/.test(tablename));
   values[tablename]=(await db.query(`SELECT count(*)::int AS count, md5(COALESCE(string_agg(to_jsonb(t)::text, '' ORDER BY to_jsonb(t)::text),'')) AS hash FROM "${tablename}" t`)).rows[0];
 }
 return values;
});}
async function audienceCheck(connection){return withDb(connection,async db=>{
 const values=(await db.query(`SELECT e.enumlabel FROM pg_enum e JOIN pg_type t ON t.oid=e.enumtypid WHERE t.typname='TrainingAudience' ORDER BY e.enumsortorder`)).rows.map(row=>row.enumlabel);
 assert.deepEqual(values,['ADULT','YOUTH','ALL']);return values;
});}
function migrate(connection,log){run(process.execPath,[candidate+'/apps/api/node_modules/prisma/build/index.js','migrate','deploy'],{cwd:candidate+'/apps/api',env:{...process.env,DATABASE_URL:connection},log});}
try{
 await auditMigrations(url.href,old);
 console.log('PASS old manifest and dependency compatibility; only the planned ALL enum migration pending');
 run(process.execPath,['--env-file='+base+'/.env.api',previous+'/apps/api/scripts/ops/backup.mjs'],{env:{...process.env,OPS_BACKUP_ROOT:base+'/backups/verified'},log:'pre-migration-backup.log'});
 copyFileSync(base+'/backups/verified/latest-verified.json',receipt+'/pre-migration-backup.json');
 const backup=JSON.parse(readFileSync(receipt+'/pre-migration-backup.json'));
 assert(backup.restored&&backup.commit===old.commit);
 console.log('PASS pre-migration backup and restore verification');
 run('sudo',['-n','-u','postgres','createdb','--owner',env.PGUSER,isolated],{env});created=true;
 run('pg_restore',['--exit-on-error','--no-owner','--no-acl','--dbname',isolated,backup.directory+'/database.dump'],{env:{...env,PGDATABASE:isolated},log:'migration-restore.log'});
 const before=await fingerprint(restored.href);
 migrate(restored.href,'isolated-migrate.log');
 await auditMigrations(restored.href,current);
 assert.deepEqual(await fingerprint(restored.href),before,'Migration changed existing business data');
 writeFileSync(receipt+'/isolated-data-integrity.json',JSON.stringify({unchanged:true,tables:before,audiences:await audienceCheck(restored.href)},null,2)+'\n');
 console.log('PASS exact production backup migrates; all existing business rows unchanged');
 run(process.execPath,['apps/api/scripts/ops/rehearse.mjs'],{env:{...process.env,RELEASE_TEST_DATABASE:isolated,RELEASE_BACKUP:receipt,RELEASE_COMMIT:current.commit},log:'isolated-rehearsal.log'});
 console.log('PASS new compiled application payment, refund, permissions and database outage rehearsal');
 run('sudo',['-n','-u','postgres','dropdb','--force',isolated],{env});created=false;
 // All new structures are additive. Rollback retains them and all new orders.
 migrate(url.href,'production-migrate.log');
 await auditMigrations(url.href,current);
 writeFileSync(receipt+'/production-audiences.json',JSON.stringify(await audienceCheck(url.href),null,2)+'\n');
 console.log('PASS production migration and audience enum');
 run(process.execPath,['--env-file='+base+'/.env.api','apps/api/scripts/ops/backup.mjs','--rehearse'],{env:{...process.env,OPS_BACKUP_ROOT:base+'/backups/verified'},log:'backup.log'});
 copyFileSync(base+'/backups/verified/latest-verified.json',receipt+'/backup.json');
 const verified=JSON.parse(readFileSync(receipt+'/backup.json'));
 assert(verified.restored&&verified.rehearsal&&verified.commit===current.commit);
 writeFileSync(receipt+'/rehearsed',new Date().toISOString()+'\n');
 console.log('PREPARED: migrated backup restored and new API rehearsed; standard release activation is ready');
}catch(error){console.error('MIGRATION_RELEASE_FAILED:',error.message);process.exitCode=1;}
finally{if(created)run('sudo',['-n','-u','postgres','dropdb','--force',isolated],{env});}
