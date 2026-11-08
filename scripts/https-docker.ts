import assert from 'node:assert/strict';
import { execFile, spawn } from 'node:child_process';
import { generateKeyPairSync, randomBytes, randomUUID, sign } from 'node:crypto';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { promisify } from 'node:util';
import { inside } from '../apps/worker/src/config';

// Optional fixture-only Docker test. No .env loading, public DNS/ACME, or live DB.
const execute = promisify(execFile),
  suffix = randomUUID().replaceAll('-', ''),
  network = `card-https-test-${suffix}`,
  database = `card-https-db-${suffix}`,
  web = `card-https-web-${suffix}`,
  proxy = `card-https-proxy-${suffix}`,
  password = randomBytes(24).toString('hex'),
  dbPassword = randomBytes(24).toString('hex'),
  origin = 'https://engine.test',
  keys = generateKeyPairSync('ed25519'),
  publicKey = keys.publicKey.export({ format: 'der', type: 'spki' }).subarray(-32).toString('hex');
let root: string | undefined,
  phase = 'setup';
const docker = async (args: string[], env: NodeJS.ProcessEnv = process.env) =>
  (
    await execute('docker', args, { env, windowsHide: true, maxBuffer: 2 * 1024 * 1024 })
  ).stdout.trim();
try {
  const image = await docker([
      'image',
      'inspect',
      '--format',
      '{{.Id}}',
      process.env.BACKUP_TEST_IMAGE ?? 'card-engine-web:latest',
    ]),
    caddy = 'caddy:2.11-alpine';
  await docker(['image', 'inspect', '--format', '{{.Id}}', caddy]);
  root = await mkdtemp(join(tmpdir(), 'card-engine-https-'));
  const fixtureConfig = join(root, 'test.Caddyfile'),
    rootCertificate = join(root, 'root.crt'),
    caddyDirectory = resolve('infra/docker/caddy');
  await writeFile(
    fixtureConfig,
    '{\n local_certs\n skip_install_trust\n import /etc/caddy/options.caddy\n}\nimport /etc/caddy/site.caddy\n',
    { flag: 'wx', mode: 0o600 },
  );
  const env = {
    ...process.env,
    DATABASE_URL: `postgresql://fixture:${dbPassword}@${database}:5432/fixture`,
    FIXTURE_PASSWORD: password,
    APP_ORIGIN: origin,
    COOKIE_SECURE: 'true',
    PUBLIC_HOSTNAME: 'engine.test',
    POSTGRES_PASSWORD: dbPassword,
    DISCORD_CLIENT_ID: '900000000000000001',
    DISCORD_CLIENT_SECRET: randomBytes(24).toString('hex'),
    DISCORD_PUBLIC_KEY: publicKey,
  };
  // Inspect the actual overlay without consuming the operator's private environment file.
  const merged = JSON.parse(
    (
      await execute(
        'docker',
        [
          'compose',
          '--env-file',
          '.env.example',
          '-f',
          'compose.yaml',
          '-f',
          'infra/docker/compose.https.yaml',
          'config',
          '--format',
          'json',
        ],
        { env, windowsHide: true },
      )
    ).stdout,
  );
  assert.equal(
    merged.services.proxy.depends_on['https-check'].condition,
    'service_completed_successfully',
  );
  assert.equal(merged.services.proxy.depends_on.web.condition, 'service_healthy');
  assert.equal(merged.services.web.ports[0].host_ip, '127.0.0.1');
  assert.equal(merged.services.db.ports, undefined);
  const preflight = async (flag: string) =>
    docker(
      [
        'run',
        '--rm',
        '--pull=never',
        '--network',
        'none',
        '--env',
        'PUBLIC_HOSTNAME',
        '--env',
        'APP_ORIGIN',
        '--env',
        `COOKIE_SECURE=${flag}`,
        image,
        'node',
        '--import',
        'tsx',
        'scripts/deployment-check.ts',
      ],
      env,
    );
  await preflight('true');
  await assert.rejects(() => preflight('false'));
  await docker(['network', 'create', '--internal', network]);
  await docker(
    [
      'run',
      '-d',
      '--pull=never',
      '--name',
      database,
      '--network',
      network,
      '--env',
      'POSTGRES_PASSWORD',
      '--env',
      'POSTGRES_USER=fixture',
      '--env',
      'POSTGRES_DB=fixture',
      'postgres:18-bookworm',
    ],
    env,
  );
  let dbReady = false;
  for (let i = 0; i < 60; i++) {
    try {
      await docker([
        'exec',
        database,
        'pg_isready',
        '-h',
        '127.0.0.1',
        '-U',
        'fixture',
        '-d',
        'fixture',
      ]);
      dbReady = true;
      break;
    } catch {
      await delay(500);
    }
  }
  assert.ok(dbReady, 'Fixture database startup.');
  phase = 'fixture seed';
  const child = spawn(
    'docker',
    [
      'run',
      '--rm',
      '-i',
      '--pull=never',
      '--network',
      network,
      '--env',
      'DATABASE_URL',
      '--env',
      'FIXTURE_PASSWORD',
      image,
      'node',
      '--import',
      'tsx',
      '--input-type=module',
    ],
    { env, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] },
  );
  let output = '';
  child.stdout.on('data', (chunk) => {
    output += chunk.toString();
  });
  child.stderr.resume();
  const ended = new Promise<void>((resolve, reject) => {
    child.once('error', reject);
    child.once('exit', (code) =>
      code === 0 ? resolve() : reject(new Error('Fixture seed failed.')),
    );
  });
  child.stdin.on('error', () => {});
  child.stdin.end(
    `import {createDatabase,bootstrap,createRealm} from './packages/db/src/index.ts'; import {migrate} from './packages/db/src/migrate.ts'; const db=createDatabase(process.env.DATABASE_URL);try{await migrate(db);const actor=await bootstrap(db,'https-fixture@example.test',process.env.FIXTURE_PASSWORD);console.log(JSON.stringify({realm:await createRealm(db,actor,'HTTPS fixture')}));}finally{await db.end();}`,
  );
  await ended;
  const { realm } = JSON.parse(output.trim());
  const appEnvironment = [
    'DATABASE_URL',
    'APP_ORIGIN',
    'COOKIE_SECURE',
    'DISCORD_CLIENT_ID',
    'DISCORD_CLIENT_SECRET',
    'DISCORD_PUBLIC_KEY',
  ].flatMap((name) => ['--env', name]);
  phase = 'application startup';
  await docker(
    [
      'run',
      '-d',
      '--pull=never',
      '--name',
      web,
      '--network',
      network,
      '--network-alias',
      'web',
      ...appEnvironment,
      image,
    ],
    env,
  );
  phase = 'proxy startup';
  await docker(
    [
      'run',
      '-d',
      '--pull=never',
      '--name',
      proxy,
      '--network',
      network,
      '--env',
      'PUBLIC_HOSTNAME',
      '--network-alias',
      'engine.test',
      '--mount',
      `type=bind,source=${caddyDirectory},target=/etc/caddy,readonly`,
      '--mount',
      `type=bind,source=${fixtureConfig},target=/test.Caddyfile,readonly`,
      caddy,
      'caddy',
      'run',
      '--config',
      '/test.Caddyfile',
      '--adapter',
      'caddyfile',
    ],
    env,
  );
  phase = 'local CA';
  let certificateReady = false;
  for (let i = 0; i < 60; i++) {
    try {
      await docker(['cp', `${proxy}:/data/caddy/pki/authorities/local/root.crt`, rootCertificate]);
      certificateReady = true;
      break;
    } catch {
      await delay(500);
    }
  }
  assert.ok(certificateReady, 'Local certificate authority.');
  const clientPreamble = `
    import assert from 'node:assert/strict';
    import http from 'node:http'; import https from 'node:https';
    import {readFileSync} from 'node:fs'; import {setTimeout as delay} from 'node:timers/promises';
    const origin='https://engine.test',ca=readFileSync('/fixture-root.crt');
    function request(path,options={}) {
      return new Promise((resolve,reject)=>{
        const settings={hostname:'engine.test',port:options.plain?80:443,path,method:options.method??'GET',headers:{Host:'engine.test',...options.headers},...(options.plain?{}:{servername:'engine.test',ca:options.trust===false?undefined:ca})};
        const req=(options.plain?http:https).request(settings,res=>{let body='';res.setEncoding('utf8');res.on('data',chunk=>{body+=chunk;});res.on('end',()=>resolve({status:res.statusCode,headers:res.headers,body}));});
        req.on('error',reject);req.setTimeout(5000,()=>req.destroy(new Error('Fixture HTTPS timeout.')));req.end(options.body);
      });
    }
  `;
  async function client(source: string) {
    const process = spawn(
      'docker',
      [
        'run',
        '--rm',
        '-i',
        '--pull=never',
        '--network',
        network,
        '--env',
        'FIXTURE_PASSWORD',
        '--mount',
        `type=bind,source=${rootCertificate},target=/fixture-root.crt,readonly`,
        image,
        'node',
        '--input-type=module',
      ],
      { env, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] },
    );
    let stderr = '';
    process.stderr.on('data', (chunk) => {
      stderr += chunk.toString();
    });
    process.stdout.resume();
    const end = new Promise<void>((resolve, reject) => {
      process.once('error', reject);
      process.once('exit', (code) =>
        code === 0
          ? resolve()
          : reject(
              new Error(
                stderr
                  .replaceAll(password, '[fixture secret]')
                  .replaceAll(dbPassword, '[fixture secret]'),
              ),
            ),
      );
    });
    process.stdin.on('error', () => {});
    process.stdin.end(clientPreamble + source);
    await end;
  }
  phase = 'trusted TLS';
  await client(`
    let ready=false; for(let i=0;i<60;i++){try{if((await request('/api/health/ready')).status===200){ready=true;break;}}catch{} await delay(500);} assert.ok(ready,'Proxied readiness.');
    await assert.rejects(()=>request('/api/health/live',{trust:false}));
    assert.equal((await request('/',{plain:true})).headers.location,origin+'/');
    const live=await request('/api/health/live');assert.deepEqual(JSON.parse(live.body),{ok:true});assert.equal(live.headers['strict-transport-security'],'max-age=86400');assert.equal(live.headers.server,undefined);
  `);
  phase = 'secure login and OAuth';
  await client(`
    const login=await request('/api/login',{method:'POST',headers:{Origin:origin,'Content-Type':'application/json'},body:JSON.stringify({email:'https-fixture@example.test',password:process.env.FIXTURE_PASSWORD})});assert.equal(login.status,200);
    const session=login.headers['set-cookie'].find(value=>value.startsWith('card_engine_session='));
    for(const attribute of ['Secure','HttpOnly','SameSite=lax'])assert.ok(session.toLowerCase().includes(attribute.toLowerCase()));
    const cookie=session.split(';')[0],path='/api/export?realmId='+${JSON.stringify(realm)},exported=await request(path,{headers:{Cookie:cookie}});
    assert.equal(exported.status,200);assert.equal(JSON.parse(exported.body).schemaVersion,12);assert.match(exported.headers['cache-control'],/no-store/);assert.equal((await request(path)).status,401);
    assert.equal((await request('/api/admission',{method:'POST',headers:{Cookie:cookie,Origin:'https://untrusted.test','Content-Type':'application/json'},body:'{}'})).status,403);
    const oauth=await request('/api/auth/discord/start',{method:'POST',headers:{Origin:origin,'Content-Type':'application/json'},body:'{}'});assert.equal(oauth.status,200);assert.equal(new URL(JSON.parse(oauth.body).url).searchParams.get('redirect_uri'),origin+'/api/auth/discord/callback');
  `);
  phase = 'signed interactions';
  const ping = JSON.stringify({
      id: '700000000000000001',
      application_id: env.DISCORD_CLIENT_ID,
      type: 1,
    }),
    timestamp = String(Math.floor(Date.now() / 1000)),
    signature = sign(null, Buffer.from(timestamp + ping), keys.privateKey).toString('hex'),
    canary = 'FICTIONAL-OAUTH-CANARY',
    callback = '/api/auth/discord/callback?code=' + canary + '&state=' + canary;
  await client(`
    const interaction=await request('/api/discord/interactions',{method:'POST',headers:{'Content-Type':'application/json','x-signature-timestamp':${JSON.stringify(timestamp)},'x-signature-ed25519':${JSON.stringify(signature)}},body:${JSON.stringify(ping)}});assert.equal(interaction.status,200);assert.deepEqual(JSON.parse(interaction.body),{type:1});
    const redirect=await request(${JSON.stringify(callback)},{headers:{'X-Forwarded-Host':'untrusted.test','X-Forwarded-Proto':'http'}});assert.equal(redirect.status,303);assert.equal(new URL(redirect.headers.location).origin,origin);assert.equal(redirect.headers['referrer-policy'],'no-referrer');
  `);
  phase = 'database outage';
  await docker(['stop', '--time', '5', database]);
  await client(
    `assert.equal((await request('/api/health/live')).status,200);const result=await request('/api/health/ready');assert.equal(result.status,503);assert.deepEqual(JSON.parse(result.body),{ok:false});`,
  );
  await docker(['start', database]);
  await client(
    `let ready=false;for(let i=0;i<40;i++){if((await request('/api/health/ready')).status===200){ready=true;break;}await delay(500);}assert.ok(ready,'Database recovery.');
    const login=await request('/api/login',{method:'POST',headers:{Origin:origin,'Content-Type':'application/json'},body:JSON.stringify({email:'https-fixture@example.test',password:process.env.FIXTURE_PASSWORD})});assert.equal(login.status,200,'Gameplay database pool reconnects.');`,
  );
  phase = 'proxy error privacy';
  await docker(['stop', '--time', '5', web]);
  await client(
    `assert.equal((await request(${JSON.stringify(callback)},{headers:{Authorization:'Bearer ${canary}',Cookie:'fixture=${canary}'}})).status,502);`,
  );
  const logs = await execute('docker', ['logs', proxy], {
    windowsHide: true,
    maxBuffer: 2 * 1024 * 1024,
  });
  assert.ok(
    !(logs.stdout + logs.stderr).includes(canary),
    'Request canary must not enter proxy error logs.',
  );
  console.log(
    'HTTPS Docker checks passed: trusted local TLS, redirect, secure login/export, Origin enforcement, OAuth callback origin, signed raw PING, readiness outage/recovery, and proxy error privacy. Live deployment untouched.',
  );
} catch (error) {
  const detail = ((error as { stderr?: string }).stderr ?? (error as Error).message)
    .replaceAll(password, '[fixture secret]')
    .replaceAll(dbPassword, '[fixture secret]')
    .replace(/card_engine_session=[^;\s]+/g, 'card_engine_session=[redacted]');
  console.error(detail.slice(-1800));
  console.error(
    `HTTPS Docker verification failed during ${phase}. Build the web image and have caddy:2.11-alpine and postgres:18-bookworm available locally. Fixture resources are being removed.`,
  );
  process.exitCode = 1;
} finally {
  for (const name of [proxy, web, database]) await docker(['rm', '-f', '-v', name]).catch(() => {});
  await docker(['network', 'rm', network]).catch(() => {});
  if (root && inside(tmpdir(), root) && root !== tmpdir())
    await rm(root, { recursive: true, force: true });
}
