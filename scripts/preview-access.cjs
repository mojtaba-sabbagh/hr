// Disposable browser QA environment: no application accounts or settings are changed.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const net = require('node:net');
const {spawn, execFileSync} = require('node:child_process');
require('@next/env').loadEnvConfig(process.cwd());
const {PrismaClient} = require('@prisma/client');
const sourceUrl = process.env.DATABASE_URL;
const schema = `access_preview_${process.pid}_${Date.now()}`;
const url = new URL(sourceUrl);
url.searchParams.set('schema', schema);
const env = {...process.env, DATABASE_URL: url.toString(), AUTH_SECRET: 'isolated-browser-qa-only-secret', SUPER_ADMIN_EMAIL: 'root@access-test.invalid', SUPER_ADMIN_PASSWORD: 'Access-preview-123', SUPER_ADMIN_NAME: 'ابرادمین آزمایشی', NODE_ENV: 'development'};
const control = new PrismaClient({datasources: {db: {url: sourceUrl}}});
let child;
let stopping = false;
async function cleanup() {
  if (stopping) return;
  stopping = true;
  if (child && child.exitCode === null) child.kill();
  if (!/^access_preview_\d+_\d+$/.test(schema)) throw new Error('Unexpected preview schema');
  await control.$executeRawUnsafe(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
  await control.$disconnect();
  console.log('Preview schema removed.');
  process.exit();
}
(async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'hr-access-preview-'));
  for (const name of ['app', 'public', 'package.json', 'tsconfig.json', 'next-env.d.ts', 'next.config.js', 'postcss.config.js', 'tailwind.config.js']) fs.cpSync(path.join(process.cwd(), name), path.join(directory, name), {recursive: true});
  fs.symlinkSync(path.join(process.cwd(), 'node_modules'), path.join(directory, 'node_modules'), 'junction');
  await control.$executeRawUnsafe(`CREATE SCHEMA "${schema}"`);
  execFileSync(process.execPath, [require.resolve('prisma/build/index.js'), 'migrate', 'deploy'], {env, stdio: 'pipe'});
  const server = net.createServer();
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port;
  await new Promise(resolve => server.close(resolve));
  console.log(`QA_URL=http://localhost:${port}`);
  console.log(`QA_DIRECTORY=${directory}`);
  child = spawn(process.execPath, [require.resolve('next/dist/bin/next'), 'dev', directory, '--hostname', '127.0.0.1', '--port', String(port)], {env, stdio: 'inherit', windowsHide: true});
  child.on('exit', cleanup);
  process.on('SIGINT', cleanup);
  process.on('SIGTERM', cleanup);
  process.stdin.on('data', data => {if (String(data).trim() === 'stop') void cleanup();});
})().catch(async error => {console.error(error.name, error.message.replace(sourceUrl, '[database]')); await cleanup();});
