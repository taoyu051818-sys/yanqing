import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdirSync, mkdtempSync, openSync, closeSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import net from 'node:net';
import { fileURLToPath } from 'node:url';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const output = path.join(root, 'output/ui-acceptance');
mkdirSync(output, { recursive: true });
// Own a fresh port and mock-data server; never reuse an unknown local service.
const probe = net.createServer();
probe.listen(0, '127.0.0.1'); await once(probe, 'listening');
const port = probe.address().port; await new Promise(resolve => probe.close(resolve));
const build = mkdtempSync(path.join(tmpdir(), 'yanqing-ui-'));
const log = openSync(path.join(output, 'server.log'), 'w');
const env = { ...process.env, VITE_DATA_MODE:'mock', VITE_API_BASE_URL:`http://127.0.0.1:${port}/api/v1`, VITE_ENABLE_REMOTE_DEV_LOGIN:'false', UNI_OUTPUT_DIR:build, OPS_UI_BASE_URL:`http://127.0.0.1:${port}`, OPS_UI_OUTPUT_DIR:output };
const server = spawn('pnpm', ['--dir', 'apps/miniapp', 'dev:h5', '--host', '127.0.0.1', '--port', String(port), '--strictPort'], {cwd:root, env, detached:process.platform !== 'win32', stdio:['ignore',log,log]});
let serverError;
server.on('error', error => { serverError = error; });
let current;
function stop(child) {
  if (!child?.pid || child.exitCode !== null) return;
  try { if (process.platform !== 'win32') process.kill(-child.pid, 'SIGTERM'); else child.kill(); } catch {}
}
for (const signal of ['SIGINT','SIGTERM']) process.on(signal, () => { stop(current); stop(server); process.exit(1); });
try {
  const deadline=Date.now()+90000;
  for (;;) {
    if (serverError) throw serverError;
    if (server.exitCode !== null) throw new Error('Mock UI server exited; see output/ui-acceptance/server.log');
    try { const response=await fetch(env.OPS_UI_BASE_URL, {signal:AbortSignal.timeout(1000)}); if (response.ok) break; } catch {}
    if (Date.now()>deadline) throw new Error('Mock UI server did not become ready in 90 seconds');
    await new Promise(resolve=>setTimeout(resolve,250));
  }
  for (const script of ['h5-training-prerequisite-acceptance.cjs','h5-training-pagination-acceptance.cjs','h5-booking-refund-delivery-acceptance.cjs']) {
    console.log(`Running ${script}`);
    current=spawn(process.execPath,[path.join(root,'scripts',script)], {cwd:root,env,detached:process.platform !== 'win32',stdio:'inherit'});
    const timer=setTimeout(()=>stop(current),180000);
    try { const [code]=await once(current,'exit'); if(code!==0) throw new Error(`${script} failed (${code})`); }
    finally { clearTimeout(timer); }
  }
  console.log('PASS: isolated mock UI journeys; screenshots in output/ui-acceptance');
} finally { stop(current); stop(server); closeSync(log); rmSync(build, {recursive:true,force:true}); }
