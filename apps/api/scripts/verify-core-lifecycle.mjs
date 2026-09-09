import { readFileSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import pg from 'pg';

const cwd = fileURLToPath(new URL('../', import.meta.url));
const matrix = JSON.parse(readFileSync(new URL('./core-lifecycle-matrix.json', import.meta.url), 'utf8'));
const args = process.argv.slice(2);
if (args.length === 1 && args[0] === '--list') {
  for (const [name, group] of Object.entries(matrix)) console.log(`${name}: ${group.purpose}\n  ${group.files.join('\n  ')}`);
} else {
  try {
    if (args.length && !(args.length === 2 && args[0] === '--group' && matrix[args[1]])) throw new Error('用法：test:core-lifecycle [--list | --group 分组名]');
    // No DATABASE_URL fallback: never silently skip tests or touch a live database.
    const raw = process.env.TEST_DATABASE_URL;
    if (!raw) throw new Error('必须明确提供 TEST_DATABASE_URL，不能以跳过数据库测试代替验收通过');
    const base = new URL(raw);
    if (!['postgres:', 'postgresql:'].includes(base.protocol) || !['localhost', '127.0.0.1'].includes(base.hostname) || !/^\/[a-zA-Z0-9_]+_test$/.test(base.pathname)) throw new Error('只允许本地、名称以 _test 结尾的隔离 PostgreSQL 数据库');
    if (base.hostname === 'localhost') base.hostname = '127.0.0.1';
    const run = (command, databaseUrl) => {
      const child = spawnSync('pnpm', command, { cwd, stdio: 'inherit', env: { ...process.env, DATABASE_URL: databaseUrl, TEST_DATABASE_URL: databaseUrl } });
      if (child.error || child.status !== 0) throw new Error(`核心验收命令失败：pnpm ${command.join(' ')}`);
    };
    const groups = args.length ? [[args[1], matrix[args[1]]]] : Object.entries(matrix);
    for (const [name, group] of groups) {
      console.log(`\n[核心验收 ${name}] ${group.purpose}`);
      const database = `yanqing_core_${name}_${randomBytes(6).toString('hex')}_test`;
      const target = new URL(base);
      let admin;
      let created = false;
      try {
        if (group.isolated) {
          admin = new pg.Client({ connectionString: raw });
          await admin.connect();
          await admin.query(`CREATE DATABASE "${database}"`);
          created = true;
          target.pathname = `/${database}`;
        }
        run(['db:deploy'], target.href);
        run(['exec', 'vitest', 'run', '--no-file-parallelism', '--testTimeout=30000', '--hookTimeout=60000', ...group.files], target.href);
      } finally {
        try { if (created) await admin.query(`DROP DATABASE "${database}"`); }
        finally { if (admin) await admin.end(); }
      }
    }
    console.log(`\n所选核心验收分组全部通过：${groups.map(([name]) => name).join(', ')}。微信外部接口使用测试替身，真机与真实支付仍须现场验收。`);
  } catch (error) {
    // Connection errors can carry connection strings; do not print raw provider errors.
    console.error(error instanceof Error && !('code' in error) ? error.message : '隔离验收数据库连接或清理失败');
    process.exitCode = 1;
  }
}
